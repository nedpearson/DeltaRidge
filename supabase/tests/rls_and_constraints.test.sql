\set ON_ERROR_STOP on
set client_min_messages to notice;

-- Two orgs, two users, to prove isolation is real rather than aspirational.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','rep.a@delta-ridge.com'),
  ('22222222-2222-2222-2222-222222222222','rep.b@othercompany.com');

insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Delta Ridge Roofing','delta-ridge'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Rival Roofing','rival');

insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','salesperson'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','salesperson');

insert into properties (id, organization_id, address_line1, city, parish, postal_code, location) values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
   '14235 Airline Hwy','Gonzales','Ascension','70737',
   ST_SetSRID(ST_MakePoint(-90.9201, 30.2388),4326)::geography),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',
   '900 Rival Road','Baton Rouge','East Baton Rouge','70802',
   ST_SetSRID(ST_MakePoint(-91.1871, 30.4515),4326)::geography);

grant usage on schema public, app to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;

\echo '--- TEST 1: RLS org isolation ---'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select case when count(*)=1 then 'PASS rep A sees exactly their 1 property'
            else 'FAIL rep A sees '||count(*) end from properties;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select case when count(*)=1 and min(address_line1)='900 Rival Road'
            then 'PASS rep B sees only their own, not Delta Ridge''s'
            else 'FAIL cross-org leak: '||coalesce(string_agg(address_line1,', '),'none') end from properties;
reset role;

\echo '--- TEST 2: duplicate address protection ---'
do $$
begin
  insert into properties (organization_id, address_line1, postal_code)
  values ('aaaaaaaa-0000-0000-0000-000000000001','14235 Airline Hwy.','70737');
  raise notice 'FAIL duplicate address was accepted';
exception when unique_violation then
  raise notice 'PASS duplicate blocked (punctuation-insensitive match)';
end $$;

\echo '--- TEST 3: HailTrace geometry licence trigger ---'
insert into storm_events (provider, external_id, event_type, occurred_at, hail_size_inches, location)
values ('noaa','spc-2026-0417-a','hail','2026-04-17 18:20-05',1.75,
        ST_SetSRID(ST_MakePoint(-90.92,30.24),4326)::geography);
do $$
begin
  insert into storm_events (provider, external_id, event_type, occurred_at, affected_area)
  values ('hailtrace','ht-1','hail', now(),
          ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-91 30,-91 31,-90 31,-90 30,-91 30)))'),4326)::geography);
  raise notice 'FAIL licensed geometry was persisted';
exception when check_violation then
  raise notice 'PASS licensed geometry rejected at the database layer';
end $$;

\echo '--- TEST 4: checklist auto-satisfies when a photo is taken ---'
insert into inspections (id, organization_id, property_id, inspector_id)
values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
insert into inspection_checklist_items (organization_id, inspection_id, category, label, is_required) values
  ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','slope_rear','Rear slope overview',true),
  ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','gutter','Gutters',true);
insert into photos (organization_id, inspection_id, property_id, storage_path, client_id, category)
values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001','o/a/p/1.jpg', gen_random_uuid(), 'slope_rear');
select case when count(*)=1 and min(category::text)='gutter'
       then 'PASS only the un-photographed item remains outstanding'
       else 'FAIL outstanding='||coalesce(string_agg(category::text,','),'none') end
from inspection_checklist_items
where inspection_id='dddddddd-0000-0000-0000-000000000001' and satisfied_at is null;

\echo '--- TEST 5: a blurry photo does NOT satisfy the checklist ---'
insert into photos (organization_id, inspection_id, property_id, storage_path, client_id, category, retake_recommended, quality_flag)
values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001','o/a/p/2.jpg', gen_random_uuid(), 'gutter', true, 'blurry');
select case when count(*)=1 then 'PASS blurry gutter photo left the item outstanding'
            else 'FAIL blurry photo wrongly satisfied the requirement' end
from inspection_checklist_items
where inspection_id='dddddddd-0000-0000-0000-000000000001' and satisfied_at is null;

\echo '--- TEST 6: handoff idempotency (double-tap Send) ---'
do $$
begin
  insert into external_records (organization_id, provider, record_type, local_table, local_id, external_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','companycam','project','inspections',
          'dddddddd-0000-0000-0000-000000000001','cc-proj-9001');
  insert into external_records (organization_id, provider, record_type, local_table, local_id, external_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','companycam','project','inspections',
          'dddddddd-0000-0000-0000-000000000001','cc-proj-9002');
  raise notice 'FAIL second push created a duplicate CompanyCam/Roofr job';
exception when unique_violation then
  raise notice 'PASS second push blocked - no duplicate Roofr job';
end $$;

\echo '--- TEST 7: only one live handoff per inspection ---'
do $$
begin
  insert into office_handoffs (organization_id, inspection_id, property_id, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','ready');
  insert into office_handoffs (organization_id, inspection_id, property_id, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','ready');
  raise notice 'FAIL two live handoffs coexist';
exception when unique_violation then
  raise notice 'PASS one live handoff enforced';
end $$;

\echo '--- TEST 8: audit log is not client-writable ---'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  insert into audit_log (organization_id, action) values ('aaaaaaaa-0000-0000-0000-000000000001','tamper');
  raise notice 'FAIL client wrote to the audit log';
exception when insufficient_privilege then
  raise notice 'PASS audit log insert denied to client role';
end $$;
reset role;

\echo '--- TEST 9: proximity query (PostGIS) ---'
select 'PASS storm within 5km of property: '||count(*)::text
from storm_events s join properties p on ST_DWithin(s.location, p.location, 5000)
where p.id='cccccccc-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- 10-12. Invite-based provisioning (migration 0007).
--
-- The site is publicly reachable, so the guarantee under test is two-sided: an
-- invited address must come out with exactly the granted role, and an
-- uninvited address must come out with no organisation access at all.
-- -----------------------------------------------------------------------------
-- The real Delta Ridge organisation row lives in production only; it was seeded
-- by hand rather than by a migration. Cases 10-12 exercise the invite trigger
-- against that specific id, so the fixture has to create it here or the whole
-- block fails on a foreign key and the suite cannot be run locally at all.
insert into organizations (id, name, slug) values
  ('d17a0000-0000-4000-8000-000000000001','Delta Ridge Roofing (production id)','delta-ridge-prod')
on conflict (id) do nothing;

insert into organization_invites (organization_id, email, role)
values ('d17a0000-0000-4000-8000-000000000001', 'Owner.Test@Example.COM', 'admin');

-- Deliberately different capitalisation: the match must be case-insensitive,
-- because the address a rep types on a phone is not the address we seeded.
insert into auth.users (id, email) values
  ('aaaa0000-0000-4000-8000-00000000000a', 'owner.test@example.com'),
  ('bbbb0000-0000-4000-8000-00000000000b', 'never.invited@example.com');

do $$
declare
  granted_role text;
  uninvited_rows integer;
  invite_open integer;
  org_default uuid;
begin
  select role::text into granted_role
    from organization_members
   where user_id = 'aaaa0000-0000-4000-8000-00000000000a';
  if granted_role is distinct from 'admin' then
    raise exception 'FAIL 10: invited address got role %, expected admin', coalesce(granted_role, 'none');
  end if;

  select count(*) into uninvited_rows
    from organization_members
   where user_id = 'bbbb0000-0000-4000-8000-00000000000b';
  if uninvited_rows <> 0 then
    raise exception 'FAIL 11: uninvited signup received % membership row(s)', uninvited_rows;
  end if;

  select count(*) into invite_open
    from organization_invites
   where lower(email) = 'owner.test@example.com' and accepted_at is null;
  if invite_open <> 0 then
    raise exception 'FAIL 12: invite was not marked accepted after redemption';
  end if;

  select default_org_id into org_default
    from profiles where id = 'aaaa0000-0000-4000-8000-00000000000a';
  if org_default is distinct from 'd17a0000-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL 12b: default_org_id was not set on the invited profile';
  end if;

  raise notice 'PASS 10-12: invite grants admin, uninvited signup gets nothing';
end;
$$;

-- -----------------------------------------------------------------------------
-- TEST 13-15: idempotent field sync.
--
-- The field app pushes from a phone that regularly loses signal between the
-- write and the acknowledgement. Every one of those pushes is an UPSERT keyed on
-- (organization_id, client_id), and these cases assert the two properties that
-- depends on: a repeated push updates instead of duplicating, and a later push
-- carries the rep's edits through rather than being ignored.
-- -----------------------------------------------------------------------------
\echo '--- TEST 13-15: idempotent field sync ---'
do $$
declare
  org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  prop uuid := 'cccccccc-0000-0000-0000-000000000001';
  cid uuid := '5eed0000-0000-4000-8000-00000000001d';
  obs_cid uuid := '5eed0000-0000-4000-8000-00000000002d';
  n integer;
  final_status text;
  final_note text;
  obs_count integer;
begin
  -- First push from the field: inspection created, still in progress.
  insert into inspections (organization_id, client_id, property_id, status)
  values (org, cid, prop, 'in_progress')
  on conflict (organization_id, client_id)
    do update set status = excluded.status, inspector_recommendation = excluded.inspector_recommendation;

  -- The acknowledgement was lost, so the phone retries the identical push.
  insert into inspections (organization_id, client_id, property_id, status)
  values (org, cid, prop, 'in_progress')
  on conflict (organization_id, client_id)
    do update set status = excluded.status, inspector_recommendation = excluded.inspector_recommendation;

  select count(*) into n from inspections where organization_id = org and client_id = cid;
  if n <> 1 then
    raise exception 'FAIL 13: retried push created % inspections, expected 1', n;
  end if;

  -- The rep finishes and sends. The same client_id must UPDATE, not insert, and
  -- the edits must actually land — this is the bug where an inspection reached
  -- the office once at creation and then stopped receiving changes forever.
  insert into inspections (organization_id, client_id, property_id, status, inspector_recommendation)
  values (org, cid, prop, 'sent_to_office', 'Full replacement.')
  on conflict (organization_id, client_id)
    do update set status = excluded.status, inspector_recommendation = excluded.inspector_recommendation;

  select count(*), max(status::text), max(inspector_recommendation)
    into n, final_status, final_note
    from inspections where organization_id = org and client_id = cid;

  if n <> 1 then
    raise exception 'FAIL 14: completing created % inspections, expected 1', n;
  end if;
  if final_status is distinct from 'sent_to_office' then
    raise exception 'FAIL 14: status stuck at %, the rep''s edit never landed', final_status;
  end if;
  if final_note is distinct from 'Full replacement.' then
    raise exception 'FAIL 14: recommendation was not carried through on update';
  end if;

  -- Observations carry the same guarantee.
  insert into inspection_observations (organization_id, client_id, inspection_id, finding)
  select org, obs_cid, id, 'Possible hail impacts, rear slope'
    from inspections where organization_id = org and client_id = cid
  on conflict (organization_id, client_id) do update set finding = excluded.finding;

  insert into inspection_observations (organization_id, client_id, inspection_id, finding)
  select org, obs_cid, id, 'Possible hail impacts, rear slope'
    from inspections where organization_id = org and client_id = cid
  on conflict (organization_id, client_id) do update set finding = excluded.finding;

  select count(*) into obs_count
    from inspection_observations where organization_id = org and client_id = obs_cid;
  if obs_count <> 1 then
    raise exception 'FAIL 15: retried observation push created % rows, expected 1', obs_count;
  end if;

  raise notice 'PASS 13-15: retried pushes update one row, and rep edits reach the server';
end;
$$;

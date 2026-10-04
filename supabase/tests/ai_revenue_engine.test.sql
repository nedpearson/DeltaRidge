begin;
\set ON_ERROR_STOP on
set client_min_messages to notice;

select plan(5);

-- Ensure users and orgs
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333','rep.c@delta-ridge.com'),
  ('44444444-4444-4444-4444-444444444444','manager.c@delta-ridge.com') on conflict (id) do nothing;

insert into organizations (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000003','Test Org C','test-org-c') on conflict (id) do nothing;

insert into organization_members (organization_id, user_id, role) values
  ('cccccccc-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','salesperson'),
  ('cccccccc-0000-0000-0000-000000000003','44444444-4444-4444-4444-444444444444','manager') on conflict do nothing;

-- Ensure property and leads
insert into properties (id, organization_id, address_line1, city, postal_code) values
  ('dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','123 Test St','Baton Rouge','70802') on conflict do nothing;

insert into leads (id, organization_id, property_id, assigned_to) values
  ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333') on conflict do nothing;

-- Add a conversation and message
insert into conversations (id, organization_id, lead_id, status) values
  ('ffffffff-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000001','active') on conflict do nothing;

insert into messages (id, organization_id, conversation_id, channel, direction, status, content) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-000000000001','sms','inbound','received','Hello test') on conflict do nothing;

grant usage on schema public, app to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;

-- Test Rep can see assigned messages
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select is(
  (select count(*) from messages where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Rep sees messages for their assigned lead'
);

-- Reassign lead away from rep
reset role;
update leads set assigned_to = null where id = 'eeeeeeee-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select is(
  (select count(*) from messages where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0::bigint,
  'Rep cannot see messages after lead is reassigned'
);

-- Test Manager can see all messages
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select is(
  (select count(*) from messages where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'Manager sees messages regardless of assignment'
);

reset role;

-- Test contact_consents duplicate constraint
do $$
begin
  insert into contact_consents (organization_id, contact_kind, contact_value, channel, source)
  values ('cccccccc-0000-0000-0000-000000000003', 'phone', '5551234', 'sms', 'web_form');
  
  begin
    insert into contact_consents (organization_id, contact_kind, contact_value, channel, source)
    values ('cccccccc-0000-0000-0000-000000000003', 'phone', '5551234', 'sms', 'verbal');
    raise notice 'FAIL: duplicate contact consent allowed';
  exception when unique_violation then
    -- expected
  end;
end $$;
select pass('Duplicate contact_consent on same channel is prevented');

-- Test insurance constraints
do $$
begin
  insert into insurance_carriers (name, organization_id)
  values ('State Farm', 'cccccccc-0000-0000-0000-000000000003');

  begin
    insert into insurance_profiles (organization_id)
    values ('cccccccc-0000-0000-0000-000000000003');
    raise notice 'FAIL: insurance profile requires lead or property';
  exception when check_violation then
    -- expected
  end;
end $$;
select pass('Insurance profile requires lead_id or property_id check constraint');

select * from finish();
rollback;

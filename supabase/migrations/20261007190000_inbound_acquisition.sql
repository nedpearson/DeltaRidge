-- Public submissions cross the trust boundary only through the Edge Function.
-- RPCs below are service-role only; manager reads are organization scoped.
create table public.inspection_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  request_key uuid not null,
  lead_id uuid not null references public.leads(id),
  name text not null,
  address text not null,
  phone text,
  email text,
  preferred_day date,
  notes text,
  contact_disclosure text not null,
  contact_requested_at timestamptz not null default now(),
  attribution jsonb not null default '{}'::jsonb,
  status text not null default 'requested' check (status in ('requested','confirmed','cancelled')),
  appointment_id uuid references public.appointments(id),
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, request_key)
);
create index on public.inspection_requests(organization_id, created_at desc);
alter table public.inspection_requests enable row level security;
create policy inspection_requests_manager_read on public.inspection_requests for select to authenticated
  using (app.has_org_role(organization_id, array['admin','manager','office']::public.app_role[]));
grant select on public.inspection_requests to authenticated;
revoke insert, update, delete on public.inspection_requests from anon, authenticated;

create table public.acquisition_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table public.acquisition_rate_limits enable row level security;
revoke all on public.acquisition_rate_limits from anon, authenticated;
create function public.consume_acquisition_limit(p_bucket text)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer;
begin
  insert into acquisition_rate_limits(bucket, window_start, attempts)
  values (p_bucket, date_trunc('hour', now()), 1)
  on conflict (bucket) do update set
    attempts = case when acquisition_rate_limits.window_start < date_trunc('hour', now()) then 1 else acquisition_rate_limits.attempts + 1 end,
    window_start = date_trunc('hour', now())
  returning attempts into n;
  return n <= 20;
end $$;
revoke all on function public.consume_acquisition_limit(text) from public, anon, authenticated;
grant execute on function public.consume_acquisition_limit(text) to service_role;

create function public.submit_inspection_request(p_org uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_request uuid;
  v_property uuid;
  v_customer uuid;
  v_lead uuid;
  v_source uuid;
  v_name text := trim(p_payload->>'name');
  v_address text := trim(p_payload->>'address');
begin
  if p_org is null or length(v_name) not between 2 and 120 or length(v_address) not between 8 and 300
     or coalesce((p_payload->>'contactConsent')::boolean, false) is not true
     or coalesce(nullif(p_payload->>'phone',''),nullif(p_payload->>'email','')) is null then
    raise exception 'invalid inspection request';
  end if;
  -- Serialize retries and multiple submissions for the same property.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));
  select id into v_request from inspection_requests where organization_id = p_org and request_key = (p_payload->>'requestKey')::uuid;
  if v_request is not null then return v_request; end if;

  select id into v_property from properties where organization_id = p_org
    and deleted_at is null and normalized_address = app.normalize_address(v_address);
  if v_property is null then
    insert into properties(organization_id,address_line1) values(p_org,v_address) returning id into v_property;
  end if;
  select id, customer_id into v_lead, v_customer from leads where organization_id=p_org and property_id=v_property
    and deleted_at is null and status not in ('sold','lost','not_interested') limit 1;
  -- Do not re-open suppressed properties or overwrite another resident's contact.
  if exists(select 1 from leads where id=v_lead and status='do_not_contact') then
    raise exception 'This property requires office review. Please contact the office directly.';
  end if;
  if v_lead is null then
    insert into customers(organization_id,first_name,primary_phone,email)
    values(p_org,v_name,nullif(p_payload->>'phone',''),nullif(lower(p_payload->>'email'),'')) returning id into v_customer;
    insert into lead_sources(organization_id,name,category) values(p_org,'Homeowner inspection request','web')
      on conflict(organization_id,name) do update set is_active=true returning id into v_source;
    insert into leads(organization_id,property_id,customer_id,lead_source_id,status,next_action_at,next_action_note,utm_campaign,utm_medium,utm_content)
    values(p_org,v_property,v_customer,v_source,'inspection_requested',now(),'Confirm homeowner inspection request',
      p_payload->'attribution'->>'utm_campaign',p_payload->'attribution'->>'utm_medium',p_payload->'attribution'->>'utm_content') returning id into v_lead;
  end if;
  insert into inspection_requests(organization_id,request_key,lead_id,name,address,phone,email,preferred_day,notes,contact_disclosure,attribution)
  values(p_org,(p_payload->>'requestKey')::uuid,v_lead,v_name,v_address,nullif(p_payload->>'phone',''),nullif(lower(p_payload->>'email'),''),
    nullif(p_payload->>'preferredDay','')::date,p_payload->>'notes',p_payload->>'contactDisclosure',coalesce(p_payload->'attribution','{}')) returning id into v_request;
  insert into activities(organization_id,lead_id,property_id,customer_id,activity_type,body)
    values(p_org,v_lead,v_property,v_customer,'inspection_request','Homeowner requested an inspection. Confirm date and contact details in Acquisition.');
  return v_request;
end $$;
revoke all on function public.submit_inspection_request(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.submit_inspection_request(uuid,jsonb) to service_role;

create function public.confirm_inspection_request(p_request uuid, p_start timestamptz, p_actor uuid)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare r inspection_requests%rowtype; l leads%rowtype; a uuid;
begin
  select * into r from inspection_requests where id=p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if not exists(select 1 from organization_members where organization_id=r.organization_id and user_id=p_actor
    and is_active and role in ('admin','manager','office')) then raise exception 'Manager access required'; end if;
  if r.status='confirmed' then return r.appointment_id; end if;
  if r.status<>'requested' then raise exception 'Request is not awaiting confirmation'; end if;
  if p_start is null or p_start <= now() then raise exception 'Choose a future appointment time'; end if;
  select * into l from leads where id=r.lead_id and organization_id=r.organization_id and deleted_at is null;
  if not found or l.status in ('do_not_contact','sold','lost','not_interested') then raise exception 'Lead is unavailable for booking'; end if;
  select appointment_id into a from public.book_available_rep_appointment(r.organization_id,l.id,l.property_id,l.customer_id,
    p_start,p_start+interval '1 hour','Homeowner inspection request; contact details must be verified before visit.');
  update inspection_requests set status='confirmed',appointment_id=a,confirmed_by=p_actor where id=r.id;
  insert into activities(organization_id,lead_id,property_id,customer_id,user_id,activity_type,body)
    values(r.organization_id,l.id,l.property_id,l.customer_id,p_actor,'appointment','Inspection booked from acquisition queue.');
  return a;
end $$;
revoke all on function public.confirm_inspection_request(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.confirm_inspection_request(uuid,timestamptz,uuid) to service_role;

-- Repair generated-column writes; no inquiry mutates properties during exposure lookup.
create or replace function public.check_storm_exposure_for_address(org_id uuid, search_address text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog,extensions as $$
declare v_location geography; v_storm record;
begin
  select location into v_location from properties where organization_id=org_id and deleted_at is null
    and normalized_address=app.normalize_address(search_address) limit 1;
  if v_location is null then return jsonb_build_object('status','unable_to_determine'); end if;
  select id,event_type,occurred_at into v_storm from storm_events
    where affected_area is not null and ST_Intersects(affected_area,v_location)
    and occurred_at between now()-interval '2 years' and now() order by occurred_at desc limit 1;
  if found then return jsonb_build_object('status','exposed','occurred_at',v_storm.occurred_at,'event_type',v_storm.event_type); end if;
  -- Absence of a polygon match is not proof of a storm-free roof.
  return jsonb_build_object('status','unable_to_determine');
end $$;
revoke all on function public.check_storm_exposure_for_address(uuid,text) from public,anon,authenticated;
grant execute on function public.check_storm_exposure_for_address(uuid,text) to service_role;

create table public.acquisition_spend (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source text not null check(length(source) between 1 and 200),
  amount_cents integer not null check(amount_cents > 0),
  spend_date date not null,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.acquisition_spend enable row level security;
create policy acquisition_spend_manager on public.acquisition_spend for all to authenticated
  using(app.has_org_role(organization_id,array['admin','manager']::public.app_role[]))
  with check(app.has_org_role(organization_id,array['admin','manager']::public.app_role[]));
grant select,insert,update on public.acquisition_spend to authenticated;
revoke delete on public.acquisition_spend from anon,authenticated;

create table public.acquisition_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid not null references leads(id),
  kind text not null check(kind in ('review','referral')),
  status text not null default 'queued' check(status in ('queued','completed','cancelled')),
  created_at timestamptz not null default now(),
  unique(lead_id,kind)
);
alter table public.acquisition_followups enable row level security;
create policy acquisition_followups_manager on public.acquisition_followups for all to authenticated
  using(app.has_org_role(organization_id,array['admin','manager','office']::public.app_role[]))
  with check(app.has_org_role(organization_id,array['admin','manager','office']::public.app_role[]));
grant select,update on public.acquisition_followups to authenticated;
create function public.queue_review_followup(p_org uuid,p_lead uuid)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if not exists(select 1 from leads where id=p_lead and organization_id=p_org and status='sold' and deleted_at is null) then
    raise exception 'Sold lead not found';
  end if;
  insert into acquisition_followups(organization_id,lead_id,kind) values(p_org,p_lead,'review'),(p_org,p_lead,'referral')
    on conflict(lead_id,kind) do nothing;
end $$;
revoke all on function public.queue_review_followup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.queue_review_followup(uuid,uuid) to service_role;

create or replace function public.promote_neighbors_of_sale(sold_lead_id uuid)
returns void language plpgsql security definer set search_path=public,pg_catalog,extensions as $$
declare l leads%rowtype; origin geography;
begin
  select * into l from leads where id=sold_lead_id and status='sold' and deleted_at is null;
  if not found then return; end if;
  if coalesce(auth.role(),'')<>'service_role' and not app.has_org_role(l.organization_id,array['admin','manager']::public.app_role[]) then
    raise exception 'Manager access required';
  end if;
  select location into origin from properties where id=l.property_id and organization_id=l.organization_id;
  if origin is null then return; end if;
  insert into leads(organization_id,property_id,status,next_action_note)
    select p.organization_id,p.id,'target','Near a completed sale. No homeowner interest or roof damage established.'
    from properties p where p.organization_id=l.organization_id and p.deleted_at is null and p.id<>l.property_id
      and ST_DWithin(p.location,origin,100)
      and not exists(select 1 from leads existing where existing.property_id=p.id)
    order by ST_Distance(p.location,origin),p.id limit 8
    on conflict do nothing;
end $$;
revoke all on function public.promote_neighbors_of_sale(uuid) from public,anon;
grant execute on function public.promote_neighbors_of_sale(uuid) to authenticated,service_role;

-- Queue internally rather than making a broken local-network HTTP request.
create or replace function public.trigger_review_acquisition()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  if new.status='sold' and old.status is distinct from new.status then
    perform public.queue_review_followup(new.organization_id,new.id);
  end if;
  return new;
end $$;

create table public.acquisition_campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  storm_event_id uuid not null references storm_events(id),
  name text not null,
  copy text not null,
  status text not null default 'draft' check(status in ('draft','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  unique(organization_id,storm_event_id)
);
alter table public.acquisition_campaign_drafts enable row level security;
create policy acquisition_drafts_manager on public.acquisition_campaign_drafts for all to authenticated
  using(app.has_org_role(organization_id,array['admin','manager']::public.app_role[]))
  with check(app.has_org_role(organization_id,array['admin','manager']::public.app_role[]));
grant select,update on public.acquisition_campaign_drafts to authenticated;
create function public.draft_storm_acquisition_campaigns(p_storm uuid)
returns integer language plpgsql security definer set search_path=public,pg_catalog,extensions as $$
declare n integer;
begin
  insert into acquisition_campaign_drafts(organization_id,storm_event_id,name,copy)
  select distinct p.organization_id,s.id,'Storm inspection outreach '||s.occurred_at::date,
    'Storm activity was recorded in this area on '||s.occurred_at::date||'. Request a roof inspection to assess your property. Storm records do not establish damage or insurance coverage.'
  from storm_events s join properties p on p.deleted_at is null and p.location is not null
  join social_autonomy_config c on c.organization_id=p.organization_id
  where s.id=p_storm and s.occurred_at between now()-interval '30 days' and now()
    and not c.master_kill_switch and c.auto_launch_storm_campaigns
    and ((s.event_type='hail' and s.hail_size_inches>=1.5) or (s.event_type='wind' and s.wind_speed_mph>=60))
    and (ST_DWithin(p.location,s.location,8046.72) or (s.affected_area is not null and ST_Intersects(p.location,s.affected_area)))
  on conflict(organization_id,storm_event_id) do nothing;
  get diagnostics n=row_count;
  return n;
end $$;
revoke all on function public.draft_storm_acquisition_campaigns(uuid) from public,anon,authenticated;
grant execute on function public.draft_storm_acquisition_campaigns(uuid) to service_role;

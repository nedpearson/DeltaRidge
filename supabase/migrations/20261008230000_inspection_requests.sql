-- Inbound inspection requests: the in-house replacement for bought storm leads.
--
-- A homeowner fills in /free-roof-check (from a mailer QR code, an ad, the
-- website or a yard sign). The `storm-inspection-request` edge function writes
-- the property, customer, lead, consent, insurance answer and requested
-- appointment, then one row here that carries the qualification answers, the
-- storm evidence and the heat score the rep sorts by.
--
-- Writes come only from the edge function (service role). Org members can read
-- and update status. anon gets nothing.

create table if not exists public.inspection_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  answers jsonb not null,
  storm jsonb not null default '{}'::jsonb,
  heat_score smallint not null check (heat_score between 0 and 100),
  heat_tier text not null check (heat_tier in ('hot', 'warm', 'cool', 'not_eligible')),
  heat_reasons text[] not null default '{}',
  contact_name text not null,
  contact_phone text,
  contact_email text,
  address_text text not null,
  latitude double precision,
  longitude double precision,
  consent_given boolean not null default false,
  consent_text_version text,
  preferred_start timestamptz,
  ref_code text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'dismissed')),
  first_response_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inspection_requests_org_status_idx
  on public.inspection_requests (organization_id, status, heat_score desc, created_at desc);
create index if not exists inspection_requests_ref_idx
  on public.inspection_requests (organization_id, ref_code) where ref_code is not null;
create index if not exists inspection_requests_phone_recent_idx
  on public.inspection_requests (contact_phone, created_at desc);

alter table public.inspection_requests enable row level security;

drop policy if exists inspection_requests_read on public.inspection_requests;
create policy inspection_requests_read on public.inspection_requests
  for select to authenticated
  using (organization_id in (select app.current_org_ids()));

drop policy if exists inspection_requests_update on public.inspection_requests;
create policy inspection_requests_update on public.inspection_requests
  for update to authenticated
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

revoke all on public.inspection_requests from anon;
revoke all on public.inspection_requests from authenticated;
grant select on public.inspection_requests to authenticated;
grant update (status, first_response_at, responded_by, updated_at) on public.inspection_requests to authenticated;
grant all on public.inspection_requests to service_role;

-- First response is stamped once, by the database, so the speed-to-lead
-- number cannot be edited after the fact.
create or replace function app.inspection_request_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if old.status = 'new' and new.status <> 'new' and old.first_response_at is null then
    new.first_response_at := now();
    new.responded_by := coalesce(new.responded_by, auth.uid());
  else
    new.first_response_at := old.first_response_at;
  end if;
  return new;
end;
$$;

drop trigger if exists inspection_request_touch on public.inspection_requests;
create trigger inspection_request_touch
  before update on public.inspection_requests
  for each row execute function app.inspection_request_touch();

-- The old /free-roof-check RPC let anon insert property rows into any org by
-- passing an org id. The new page goes through the edge function instead.
-- Guarded: the function exists in a fresh install but was never applied in
-- production, where this is a no-op.
do $$
begin
  if to_regprocedure('public.check_storm_exposure_for_address(uuid, text)') is not null then
    revoke execute on function public.check_storm_exposure_for_address(uuid, text) from public, anon;
    grant execute on function public.check_storm_exposure_for_address(uuid, text) to authenticated, service_role;
  end if;
end;
$$;

-- `ingest-lead` has called this since 2026-09-29 and it never existed, so every
-- inbound webhook lead failed before writing anything. The funnel uses it too.
-- Service role only: it is an address lookup across an org's properties.
-- Plain-SQL normalisation rather than app.normalize_address: service_role
-- has no USAGE on schema app, and making this SECURITY DEFINER to reach it
-- would widen what it can do. Matches the street line only.
create or replace function public.resolve_property_from_address(org_id uuid, address_query text)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id
  from public.properties p
  where p.organization_id = org_id
    and p.deleted_at is null
    and btrim(regexp_replace(lower(p.address_line1), '[^a-z0-9]+', ' ', 'g'))
      = btrim(regexp_replace(lower(split_part(address_query, ',', 1)), '[^a-z0-9]+', ' ', 'g'))
  order by p.created_at
  limit 1
$$;

revoke execute on function public.resolve_property_from_address(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_property_from_address(uuid, text) to service_role;

comment on table public.inspection_requests is
  'Homeowner-submitted inspection requests from the public storm-check funnel. Written only by the storm-inspection-request edge function.';

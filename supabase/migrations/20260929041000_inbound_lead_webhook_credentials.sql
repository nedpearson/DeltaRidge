-- Per-organization credential for generic inbound lead webhooks.
-- The raw token is returned exactly once by the rotation RPC; only its SHA-256
-- hash is stored. The ingest Edge Function derives organization identity from
-- this credential instead of trusting org_id from an external payload.

create table if not exists inbound_lead_webhook_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  secret_hash text not null unique,
  secret_hint text not null,
  rotated_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists touch_inbound_lead_webhook_settings on inbound_lead_webhook_settings;
create trigger touch_inbound_lead_webhook_settings
  before update on inbound_lead_webhook_settings
  for each row execute function app.touch_updated_at();

alter table inbound_lead_webhook_settings enable row level security;

drop policy if exists inbound_lead_webhook_settings_read on inbound_lead_webhook_settings;
create policy inbound_lead_webhook_settings_read on inbound_lead_webhook_settings
  for select using (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

create or replace function public.rotate_inbound_lead_webhook_secret(target_org uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  raw_secret text;
  hashed text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not app.has_org_role(target_org, array['admin', 'manager']::app_role[]) then
    raise exception 'insufficient permission';
  end if;

  raw_secret := 'drwh_' || encode(gen_random_bytes(24), 'hex');
  hashed := encode(digest(raw_secret, 'sha256'), 'hex');

  insert into inbound_lead_webhook_settings (
    organization_id, secret_hash, secret_hint, rotated_at
  )
  values (
    target_org, hashed, right(raw_secret, 6), now()
  )
  on conflict (organization_id) do update
    set secret_hash = excluded.secret_hash,
        secret_hint = excluded.secret_hint,
        rotated_at = excluded.rotated_at,
        last_used_at = null,
        updated_at = now();

  return raw_secret;
end;
$$;

revoke all on function public.rotate_inbound_lead_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_inbound_lead_webhook_secret(uuid) to authenticated;


-- Serialize automated bookings per organization so two concurrent requests
-- cannot select the same rep before either appointment is visible.
create or replace function public.book_available_rep_appointment(
  p_org uuid,
  p_lead uuid,
  p_property uuid,
  p_customer uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text default null
)
returns table (appointment_id uuid, assigned_rep_id uuid)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  rep_id uuid;
  appt_id uuid;
begin
  if p_end <= p_start then
    raise exception 'appointment end must be after start';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));

  select om.user_id
    into rep_id
    from organization_members om
   where om.organization_id = p_org
     and om.is_active
     and om.role in ('salesperson'::app_role, 'inspector'::app_role)
     and not exists (
       select 1
         from appointments a
        where a.organization_id = p_org
          and a.assigned_to = om.user_id
          and a.status in ('scheduled', 'confirmed')
          and a.scheduled_start < p_end
          and coalesce(a.scheduled_end, a.scheduled_start + interval '1 hour') > p_start
     )
   order by om.user_id
   limit 1;

  if rep_id is null then
    raise exception 'no eligible rep is available at this time';
  end if;

  update leads
     set assigned_to = rep_id,
         status = 'appointment',
         updated_at = now()
   where id = p_lead
     and organization_id = p_org;

  if not found then
    raise exception 'lead does not belong to organization';
  end if;

  insert into appointments (
    organization_id,
    lead_id,
    property_id,
    customer_id,
    assigned_to,
    scheduled_start,
    scheduled_end,
    status,
    notes
  )
  values (
    p_org,
    p_lead,
    p_property,
    p_customer,
    rep_id,
    p_start,
    p_end,
    'scheduled',
    p_notes
  )
  returning id into appt_id;

  return query select appt_id, rep_id;
end;
$$;

revoke all on function public.book_available_rep_appointment(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.book_available_rep_appointment(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, text
) to service_role;

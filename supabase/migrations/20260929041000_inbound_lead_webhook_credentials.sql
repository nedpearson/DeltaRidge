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

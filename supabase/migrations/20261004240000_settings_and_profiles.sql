-- =============================================================================
-- Migration: Settings Control Plane & Profile Fix
-- =============================================================================

-- TASK 1: Fix Profile Trigger & Schema

-- 1a. Extend the profiles table with required columns
alter table profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists display_name text,
  add column if not exists mobile_phone text,
  add column if not exists job_title text,
  add column if not exists role text,
  add column if not exists timezone text default 'America/Chicago';

-- 1b. Replace the handle_new_user trigger function
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  inv record;
  clean_name text;
begin
  -- Generate a clean fallback name from the email (everything before the @)
  clean_name := split_part(new.email, '@', 1);

  insert into profiles (
    id, 
    full_name, 
    display_name,
    first_name,
    last_name
  )
  values (
    new.id, 
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', clean_name),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  )
  on conflict (id) do nothing;

  if new.email is null then
    return new;
  end if;

  for inv in
    select id, organization_id, role
      from organization_invites
     where lower(email) = lower(new.email)
       and accepted_at is null
     order by created_at
  loop
    insert into organization_members (organization_id, user_id, role)
    values (inv.organization_id, new.id, inv.role)
    on conflict (organization_id, user_id)
      do update set role = excluded.role, is_active = true, updated_at = now();

    update organization_invites
       set accepted_at = now(), accepted_by = new.id
     where id = inv.id;

    update profiles
       set default_org_id = coalesce(default_org_id, inv.organization_id)
     where id = new.id;
  end loop;

  return new;
end;
$$;


-- TASK 2: Create Organization Settings Table

create table if not exists organization_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  
  -- Settings stored as JSONB with strict defaults
  storm_settings jsonb not null default '{"wind_threshold": 45, "hail_threshold": 1.0, "enable_wind": true}'::jsonb,
  gps_settings jsonb not null default '{"enable_tracking": false, "property_geofence_radius": 100}'::jsonb,
  ai_settings jsonb not null default '{"autonomy_level": "none", "enable_sms": false, "enable_voice": false}'::jsonb,
  integration_statuses jsonb not null default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Strict JSONB schema validation constraints
  constraint storm_settings_schema check (
    jsonb_typeof(storm_settings) = 'object'
    and (storm_settings ? 'wind_threshold')
    and (storm_settings ? 'hail_threshold')
    and (storm_settings ? 'enable_wind')
  ),
  constraint gps_settings_schema check (
    jsonb_typeof(gps_settings) = 'object'
    and (gps_settings ? 'enable_tracking')
    and (gps_settings ? 'property_geofence_radius')
  ),
  constraint ai_settings_schema check (
    jsonb_typeof(ai_settings) = 'object'
    and (ai_settings ? 'autonomy_level')
    and (ai_settings ? 'enable_sms')
    and (ai_settings ? 'enable_voice')
  )
);

-- Trigger to auto-update the updated_at timestamp
create trigger touch_organization_settings before update on organization_settings
  for each row execute function app.touch_updated_at();

-- RLS Policies
alter table organization_settings enable row level security;

-- Reps (and above) can SELECT
create policy org_settings_select on organization_settings
  for select using (app.has_org_access(organization_id));

-- Only Admins and Managers can UPDATE
create policy org_settings_update on organization_settings
  for update using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- Admins and Managers can INSERT
create policy org_settings_insert on organization_settings
  for insert with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

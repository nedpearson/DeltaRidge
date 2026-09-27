-- =============================================================================
-- 0002  Organizations, profiles, membership, and the RLS foundation
-- =============================================================================
-- Every business table in this schema carries organization_id and is isolated by
-- RLS. Delta Ridge is one organization today; building the boundary now costs
-- almost nothing and means the platform can be sold to another roofer later
-- without a migration that touches every table.
-- =============================================================================

create type app_role as enum ('admin', 'manager', 'salesperson', 'office', 'inspector');

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  timezone    text not null default 'America/Chicago',
  -- Service area as a polygon. Used to flag leads entered outside the
  -- territory rather than to hard-block them.
  service_area geography(MultiPolygon, 4326),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- One row per authenticated user, mirroring auth.users.
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  phone        text,
  avatar_url   text,
  -- Denormalised for convenience in the field UI; membership is authoritative.
  default_org_id uuid references organizations (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            app_role not null default 'salesperson',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index on organization_members (user_id) where is_active;
create index on organization_members (organization_id) where is_active;

-- -----------------------------------------------------------------------------
-- RLS helpers.
--
-- These are SECURITY DEFINER on purpose. If a policy on `customers` queried
-- `organization_members` directly, that query would itself be subject to the
-- policies on `organization_members`, and Postgres would recurse. Wrapping the
-- lookup in a definer function breaks the cycle. `search_path` is pinned so the
-- definer context cannot be hijacked by a caller-supplied schema.
-- -----------------------------------------------------------------------------
create or replace function app.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select organization_id
  from organization_members
  where user_id = auth.uid()
    and is_active;
$$;

create or replace function app.has_org_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from organization_members
    where user_id = auth.uid()
      and organization_id = target_org
      and is_active
  );
$$;

create or replace function app.has_org_role(target_org uuid, allowed app_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from organization_members
    where user_id = auth.uid()
      and organization_id = target_org
      and is_active
      and role = any (allowed)
  );
$$;

-- Auto-provision a profile row whenever a user signs up.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create trigger touch_organizations before update on organizations
  for each row execute function app.touch_updated_at();
create trigger touch_profiles before update on profiles
  for each row execute function app.touch_updated_at();
create trigger touch_organization_members before update on organization_members
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------
alter table organizations         enable row level security;
alter table profiles              enable row level security;
alter table organization_members  enable row level security;

create policy org_select on organizations
  for select using (app.has_org_access(id));

create policy org_update on organizations
  for update using (app.has_org_role(id, array['admin']::app_role[]))
  with check (app.has_org_role(id, array['admin']::app_role[]));

create policy profile_select_self on profiles
  for select using (id = auth.uid());

-- Teammates are visible to each other: the map needs to attribute a lead to a
-- rep by name, and managers need to see whose activity is whose.
create policy profile_select_teammates on profiles
  for select using (
    exists (
      select 1
      from organization_members me
      join organization_members them
        on them.organization_id = me.organization_id
      where me.user_id = auth.uid()
        and me.is_active
        and them.is_active
        and them.user_id = profiles.id
    )
  );

create policy profile_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy member_select on organization_members
  for select using (organization_id in (select app.current_org_ids()));

create policy member_manage on organization_members
  for all using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

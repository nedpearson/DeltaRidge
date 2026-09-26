-- Compatibility migration for repositories that predate CRM core campaigns.
-- CRM migration 0003 already creates the production campaigns table with
-- organization ownership and a MultiPolygon geography. This migration must
-- therefore be additive/idempotent rather than attempting to recreate the
-- table with a conflicting schema.

create table if not exists campaigns (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references organizations (id) on delete cascade,
    name text not null,
    description text,
    area geography(MultiPolygon, 4326),
    starts_on date,
    ends_on date,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by uuid references auth.users (id) on delete set null
);

create index if not exists campaigns_area_gix on campaigns using gist (area);
create index if not exists campaigns_org_active_compat
  on campaigns (organization_id, is_active, created_at desc);

alter table campaigns enable row level security;

-- Do not create permissive USING(true) policies here. Tenant-scoped policies
-- are installed by the following hardening migration.

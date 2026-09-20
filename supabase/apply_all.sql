-- Delta Ridge - all migrations, concatenated for one-shot application.
-- Generated 2026-09-20T03:04Z from supabase/migrations/.
-- Source of truth is the individual migration files; prefer 'supabase db push'.
-- Postgres runs this as a single implicit transaction: it applies fully or not at all.

-- =================================================================
-- 20260918_0001_extensions_and_helpers.sql
-- =================================================================
-- =============================================================================
-- 0001  Extensions, shared helpers, and conventions
-- =============================================================================
-- Conventions used across every migration:
--   * UUID primary keys (gen_random_uuid) so records can be created offline on
--     a phone and synced later without key collisions.
--   * created_at / updated_at / created_by on anything a human authors.
--   * Soft delete (deleted_at) wherever audit history matters. A lead that was
--     marked "do not contact" must never vanish from the record.
--   * Geography(Point, 4326) for locations so distance math is in metres and
--     correct over a parish-sized area without projection juggling.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "postgis";
create extension if not exists "pg_trgm";      -- fuzzy address matching / dedupe
create extension if not exists "btree_gist";

-- Application-owned schema for helper functions, kept out of `public` so the
-- generated API surface stays clean.
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'BEFORE UPDATE trigger: maintains updated_at. Attach to every mutable table.';

-- -----------------------------------------------------------------------------
-- Address normalisation, used for duplicate detection.
-- Deliberately crude and deterministic: lowercase, strip punctuation, collapse
-- whitespace, and fold the most common Louisiana street-type abbreviations.
-- This is a *matching* aid, not a mailing-address authority.
-- -----------------------------------------------------------------------------
create or replace function app.normalize_address(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(raw, '')), '[.,#]', '', 'g'),
        '\y(street|str)\y', 'st', 'g'
      ),
      '\s+', ' ', 'g'
    ),
    ''
  );
$$;

comment on function app.normalize_address is
  'Deterministic address normaliser for duplicate detection only. Not a USPS-grade normaliser.';

-- =================================================================
-- 20260918_0002_org_and_identity.sql
-- =================================================================
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

-- =================================================================
-- 20260918_0003_crm_core.sql
-- =================================================================
-- =============================================================================
-- 0003  CRM core: customers, properties, leads, activities, appointments
-- =============================================================================
-- CUSTOMER and PROPERTY are deliberately separate entities joined by
-- property_owners. One customer can own several properties; a property changes
-- hands over the years. Collapsing them into one "contact" row is the mistake
-- that makes a roofing CRM useless at year three, when you knock a door you
-- last sold in 2019 and the record says the wrong name.
-- =============================================================================

create type lead_status as enum (
  'untouched', 'target', 'attempted', 'no_answer', 'spoke', 'interested',
  'inspection_requested', 'appointment', 'inspected', 'proposal_pending',
  'sold', 'lost', 'not_interested', 'do_not_contact', 'existing_customer'
);

create type property_type as enum ('residential', 'multi_family', 'commercial', 'other');
create type roof_material as enum (
  'asphalt_shingle', 'architectural_shingle', 'metal', 'tile', 'slate',
  'flat_tpo', 'flat_epdm', 'flat_modified_bitumen', 'wood_shake', 'unknown'
);

create table customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  first_name      text,
  last_name       text,
  company_name    text,
  primary_phone   text,
  secondary_phone text,
  email           text,
  mailing_address text,
  notes           text,
  -- Normalised contact keys for duplicate detection. Digits only for phone so
  -- (225) 573-4442 and 2255734442 collide as they should.
  phone_digits    text generated always as (
                    nullif(regexp_replace(coalesce(primary_phone, ''), '\D', '', 'g'), '')
                  ) stored,
  email_lower     text generated always as (nullif(lower(trim(coalesce(email, ''))), '')) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  deleted_at      timestamptz,
  constraint customers_have_a_name check (
    coalesce(first_name, last_name, company_name) is not null
  )
);

create index on customers (organization_id) where deleted_at is null;
create index on customers (organization_id, phone_digits) where phone_digits is not null;
create index on customers (organization_id, email_lower) where email_lower is not null;
create index customers_name_trgm on customers
  using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

create table properties (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  address_line1    text not null,
  address_line2    text,
  city             text,
  state            text default 'LA',
  postal_code      text,
  parish           text,             -- Louisiana's county equivalent
  location         geography(Point, 4326),
  property_type    property_type not null default 'residential',
  stories          smallint,
  roof_material    roof_material not null default 'unknown',
  -- Only ever set from an authoritative source or a homeowner statement.
  -- roof_age_source records which, so nobody mistakes a guess for a fact.
  roof_age_years   smallint,
  roof_age_source  text,
  square_footage   integer,
  access_notes     text,             -- gate codes, dogs, steep pitch, low wires
  notes            text,
  normalized_address text generated always as (
                     app.normalize_address(
                       address_line1 || ' ' || coalesce(postal_code, '')
                     )
                   ) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  constraint properties_stories_sane check (stories is null or stories between 1 and 10),
  constraint properties_roof_age_sane check (roof_age_years is null or roof_age_years between 0 and 120)
);

create index properties_location_gix on properties using gist (location);
create index on properties (organization_id) where deleted_at is null;
-- Duplicate protection: one normalised address per org.
create unique index properties_unique_address on properties (organization_id, normalized_address)
  where deleted_at is null and normalized_address is not null;
create index properties_address_trgm on properties using gin (address_line1 gin_trgm_ops);

create table property_owners (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  is_current  boolean not null default true,
  owned_from  date,
  owned_until date,
  created_at  timestamptz not null default now(),
  unique (property_id, customer_id)
);

create index on property_owners (customer_id);
create index on property_owners (property_id) where is_current;

create table lead_sources (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  category        text,   -- canvassing | referral | web | storm | import | office
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  description     text,
  -- Canvassing zone, if the campaign is geographic.
  area            geography(MultiPolygon, 4326),
  starts_on       date,
  ends_on         date,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);

create index campaigns_area_gix on campaigns using gist (area);
create index on campaigns (organization_id) where is_active;

create table leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  property_id      uuid not null references properties (id) on delete cascade,
  customer_id      uuid references customers (id) on delete set null,
  assigned_to      uuid references auth.users (id) on delete set null,
  status           lead_status not null default 'untouched',
  lead_source_id   uuid references lead_sources (id) on delete set null,
  campaign_id      uuid references campaigns (id) on delete set null,
  -- Opportunity score is intentionally nullable. A null score means "we have no
  -- basis for one yet", which is honest. It is never defaulted to a number.
  opportunity_score smallint,
  score_computed_at timestamptz,
  first_contacted_at timestamptz,
  last_activity_at timestamptz,
  next_action_at   timestamptz,
  next_action_note text,
  lost_reason      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  deleted_at       timestamptz,
  constraint leads_score_range check (opportunity_score is null or opportunity_score between 0 and 100)
);

create index on leads (organization_id, status) where deleted_at is null;
create index on leads (organization_id, assigned_to) where deleted_at is null;
create index on leads (organization_id, next_action_at) where deleted_at is null and next_action_at is not null;
create index on leads (property_id);
create unique index leads_one_open_per_property on leads (property_id)
  where deleted_at is null and status not in ('sold', 'lost', 'not_interested');

create table activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid references leads (id) on delete cascade,
  property_id     uuid references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  user_id         uuid references auth.users (id) on delete set null,
  activity_type   text not null,  -- door_knock | call | text | email | note | status_change | inspection | handoff
  outcome         text,
  body            text,
  -- Where the rep actually was when this was recorded. Useful for verifying
  -- canvassing coverage; deliberately coarse and never used punitively.
  recorded_at_location geography(Point, 4326),
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb
);

create index on activities (organization_id, occurred_at desc);
create index on activities (lead_id, occurred_at desc);
create index on activities (property_id, occurred_at desc);

create table appointments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid references leads (id) on delete set null,
  property_id     uuid not null references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  assigned_to     uuid references auth.users (id) on delete set null,
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz,
  status          text not null default 'scheduled',  -- scheduled | confirmed | completed | no_show | cancelled
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  constraint appointments_end_after_start check (scheduled_end is null or scheduled_end > scheduled_start)
);

create index on appointments (organization_id, scheduled_start);
create index on appointments (assigned_to, scheduled_start);

-- Keep leads.last_activity_at current without the client having to remember.
create or replace function app.bump_lead_activity()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is not null then
    update leads
       set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
     where id = new.lead_id;
  end if;
  return new;
end;
$$;

create trigger activities_bump_lead
  after insert on activities
  for each row execute function app.bump_lead_activity();

create trigger touch_customers before update on customers for each row execute function app.touch_updated_at();
create trigger touch_properties before update on properties for each row execute function app.touch_updated_at();
create trigger touch_campaigns before update on campaigns for each row execute function app.touch_updated_at();
create trigger touch_leads before update on leads for each row execute function app.touch_updated_at();
create trigger touch_appointments before update on appointments for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Policies: org members read and write within their own organization.
-- Role-based narrowing (e.g. restricting a salesperson to their own leads) is
-- deliberately NOT applied yet â€” Delta Ridge is one rep today and premature
-- row-level narrowing makes the manager dashboard impossible to build. Add it
-- when there is a second rep and a reason.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'properties', 'lead_sources', 'campaigns',
    'leads', 'activities', 'appointments'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- property_owners has no organization_id of its own; it inherits via property.
alter table property_owners enable row level security;
create policy property_owners_org_access on property_owners
  for all
  using (exists (
    select 1 from properties p
    where p.id = property_owners.property_id
      and p.organization_id in (select app.current_org_ids())
  ))
  with check (exists (
    select 1 from properties p
    where p.id = property_owners.property_id
      and p.organization_id in (select app.current_org_ids())
  ));

-- =================================================================
-- 20260918_0004_inspections.sql
-- =================================================================
-- =============================================================================
-- 0004  Field inspection: inspections, observations, photos, AI, voice
-- =============================================================================
-- This is the heart of the product. Two rules shape every table here:
--
--   1. AI output and human judgement are stored in SEPARATE columns, never
--      merged. `ai_suggested_category` and `category` are different fields. The
--      rep's value always wins, and we can always measure how often the AI was
--      right â€” which is the only way to know whether it is earning its cost.
--
--   2. Nothing AI produces is ever phrased as established fact. Severity and
--      damage columns are suggestions requiring confirmation, and the schema
--      records confidence and a confirmation flag so the UI cannot accidentally
--      present a guess as a finding. A roof inspection can end up in an
--      insurance claim; overstating it is a real liability, not a UX nit.
-- =============================================================================

create type inspection_status as enum (
  'in_progress', 'pending_review', 'complete', 'sent_to_office', 'cancelled'
);

create type photo_category as enum (
  -- property
  'front_elevation', 'left_elevation', 'rear_elevation', 'right_elevation', 'address_identifier',
  -- roof
  'roof_overview', 'slope_front', 'slope_rear', 'slope_left', 'slope_right',
  'valley', 'ridge', 'hip', 'eave', 'rake_edge',
  -- penetrations
  'vent', 'pipe_boot', 'hvac_penetration', 'skylight', 'chimney', 'satellite_mount', 'flashing',
  -- damage
  'hail_impact', 'wind_damage', 'missing_shingle', 'lifted_shingle', 'creasing',
  'granule_loss', 'exposed_mat', 'puncture', 'soft_metal_impact', 'flashing_damage',
  -- accessories
  'gutter', 'downspout', 'fascia', 'soffit', 'window_screen', 'siding',
  -- other
  'interior_water_damage', 'attic', 'decking', 'access_concern', 'other'
);

-- Confidence language, not certainty language. There is no 'confirmed_damage'
-- value here by design; confirmation is a separate boolean set by a human.
create type observation_severity as enum ('none_noted', 'minor', 'moderate', 'significant', 'requires_verification');

create table inspections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  property_id       uuid not null references properties (id) on delete cascade,
  customer_id       uuid references customers (id) on delete set null,
  lead_id           uuid references leads (id) on delete set null,
  appointment_id    uuid references appointments (id) on delete set null,
  inspector_id      uuid references auth.users (id) on delete set null,
  status            inspection_status not null default 'in_progress',
  -- Captured automatically at Start Inspection so the rep types nothing.
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  start_location    geography(Point, 4326),
  weather_note      text,
  -- Roof facts as observed on site. These may differ from the property record;
  -- the inspection is the more recent observation.
  roof_material     roof_material not null default 'unknown',
  stories           smallint,
  -- Homeowner-supplied values. Named explicitly so nobody treats them as verified.
  homeowner_stated_roof_age_years smallint,
  homeowner_stated_insurer        text,
  homeowner_stated_claim_filed    boolean,
  overall_condition_note text,
  inspector_recommendation text,
  -- The rep's own summary, and the AI's. Kept apart on purpose.
  summary_note      text,
  ai_summary        text,
  ai_summary_accepted boolean,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint inspections_completed_after_start check (completed_at is null or completed_at >= started_at)
);

create index on inspections (organization_id, status);
create index on inspections (property_id, started_at desc);
create index on inspections (inspector_id, started_at desc);

-- A structured observation: one finding, one place, one severity.
create table inspection_observations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid not null references inspections (id) on delete cascade,
  -- Where on the building. Free text is allowed because real roofs do not fit
  -- an enum ("back right dormer, above the porch").
  area            text,
  component       text,
  finding         text not null,
  severity        observation_severity not null default 'requires_verification',
  -- Provenance: did a human type this, dictate it, or did AI propose it?
  source          text not null default 'inspector',  -- inspector | voice | ai
  -- A human has looked at this and stands behind it.
  confirmed_by    uuid references auth.users (id) on delete set null,
  confirmed_at    timestamptz,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint observations_source_valid check (source in ('inspector', 'voice', 'ai'))
);

create index on inspection_observations (inspection_id, sort_order);

-- Per-inspection checklist state. Rows are created from a template at start,
-- so "what am I missing" is a query rather than a guess.
create table inspection_checklist_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid not null references inspections (id) on delete cascade,
  category        photo_category not null,
  label           text not null,
  is_required     boolean not null default false,
  satisfied_at    timestamptz,
  -- Set when the rep deliberately skips a required item, with a reason. A
  -- documented skip is fine; a silent gap is not.
  waived_reason   text,
  sort_order      integer not null default 0,
  unique (inspection_id, category)
);

create index on inspection_checklist_items (inspection_id) where satisfied_at is null;

create table photos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid references inspections (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  captured_by     uuid references auth.users (id) on delete set null,
  -- Storage paths, not binaries. Postgres holds metadata only.
  -- organization/{org}/jobs/{property}/inspections/{inspection}/photos/{id}.jpg
  storage_path    text not null,
  thumbnail_path  text,
  -- Client-generated UUID so an offline capture has a stable identity before it
  -- ever reaches the server, and a retried upload cannot create a duplicate.
  client_id       uuid not null,
  content_hash    text,
  byte_size       integer,
  width           integer,
  height          integer,
  captured_at     timestamptz not null default now(),
  location        geography(Point, 4326),
  -- The human-authoritative category. Nullable until someone or something sets it.
  category        photo_category,
  area            text,
  caption         text,
  inspector_note  text,
  -- Quality gate. Populated by AI, acted on by the rep before leaving.
  quality_flag    text,          -- blurry | dark | glare | obstructed | too_far | duplicate | ok
  retake_recommended boolean not null default false,
  retake_of       uuid references photos (id) on delete set null,
  -- Whether this photo should appear in the homeowner-facing presentation.
  include_in_report boolean not null default true,
  upload_state    text not null default 'pending',  -- pending | uploading | uploaded | failed
  uploaded_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, client_id)
);

create index on photos (inspection_id, category);
create index on photos (property_id, captured_at desc);
create index on photos (organization_id, upload_state) where upload_state <> 'uploaded';
create index photos_location_gix on photos using gist (location);

-- AI's opinion about a photo, kept entirely separate from the photo's own
-- authoritative fields. One row per analysis run, so re-analysis is additive
-- and we keep the history of what the model said and when.
create table photo_ai_analysis (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  photo_id              uuid not null references photos (id) on delete cascade,
  provider              text not null,
  model                 text not null,
  prompt_version        text,
  suggested_category    photo_category,
  suggested_area        text,
  suggested_component   text,
  -- Hedged language enforced at the application layer; stored verbatim here.
  condition_description text,
  possible_damage_type  text,
  suggested_severity    observation_severity,
  suggested_caption     text,
  quality_assessment    text,
  quality_issues        text[],
  -- 0.000 - 1.000. Never shown to a homeowner.
  confidence            numeric(4, 3),
  office_relevant       boolean,
  raw_response          jsonb,
  -- Did the human keep, edit, or reject the suggestion? This column is the
  -- entire point of the table: it is how we learn whether AI assist works.
  human_action          text,   -- accepted | edited | rejected | untouched
  human_action_at       timestamptz,
  latency_ms            integer,
  created_at            timestamptz not null default now(),
  constraint photo_ai_confidence_range check (confidence is null or confidence between 0 and 1),
  constraint photo_ai_human_action_valid check (
    human_action is null or human_action in ('accepted', 'edited', 'rejected', 'untouched')
  )
);

create index on photo_ai_analysis (photo_id, created_at desc);

create table voice_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid references inspections (id) on delete cascade,
  property_id     uuid references properties (id) on delete cascade,
  recorded_by     uuid references auth.users (id) on delete set null,
  client_id       uuid not null,
  storage_path    text,          -- null if audio was discarded after transcription
  duration_seconds integer,
  -- The original transcript is immutable and always retained. Structured output
  -- derived from it lives in structured_payload. If the AI mis-parses a
  -- dictation, the rep's actual words are still recoverable.
  transcript      text,
  transcript_provider text,
  structured_payload jsonb,
  structured_accepted boolean,
  upload_state    text not null default 'pending',
  recorded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, client_id)
);

create index on voice_notes (inspection_id, recorded_at);

create trigger touch_inspections before update on inspections for each row execute function app.touch_updated_at();
create trigger touch_observations before update on inspection_observations for each row execute function app.touch_updated_at();
create trigger touch_photos before update on photos for each row execute function app.touch_updated_at();
create trigger touch_voice_notes before update on voice_notes for each row execute function app.touch_updated_at();

-- Satisfying a checklist item is a consequence of taking the photo, not a
-- separate action the rep must remember.
create or replace function app.satisfy_checklist_on_photo()
returns trigger
language plpgsql
as $$
begin
  if new.inspection_id is not null and new.category is not null
     and coalesce(new.retake_recommended, false) = false then
    update inspection_checklist_items
       set satisfied_at = coalesce(satisfied_at, now())
     where inspection_id = new.inspection_id
       and category = new.category;
  end if;
  return new;
end;
$$;

create trigger photos_satisfy_checklist
  after insert or update of category, retake_recommended on photos
  for each row execute function app.satisfy_checklist_on_photo();

do $$
declare t text;
begin
  foreach t in array array[
    'inspections', 'inspection_observations', 'inspection_checklist_items',
    'photos', 'photo_ai_analysis', 'voice_notes'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- =================================================================
-- 20260918_0005_storm.sql
-- =================================================================
-- =============================================================================
-- 0005  Storm intelligence
-- =============================================================================
-- Provider-agnostic storm events. The `provider` column and the split between
-- `storm_events` (metadata we may keep) and geometry handling is deliberate:
--
--   * NOAA / SPC storm reports are public domain. We store them freely.
--   * HailTrace data is licensed. Until Delta Ridge has their agreement in hand
--     and it is confirmed in writing that geometry may be persisted, HailTrace
--     polygons are render-only: fetched server-side, sent to the map, never
--     written here. `geometry_storage_allowed` records the decision per provider
--     so the constraint is enforced in data, not in a comment someone forgets.
-- =============================================================================

create table storm_providers (
  id                       text primary key,   -- 'noaa' | 'hailtrace'
  display_name             text not null,
  geometry_storage_allowed boolean not null default false,
  attribution              text not null,
  notes                    text
);

insert into storm_providers (id, display_name, geometry_storage_allowed, attribution, notes) values
  ('noaa', 'NOAA / NWS Storm Prediction Center', true,
   'Source: NOAA National Weather Service Storm Prediction Center (public domain)',
   'Free and public. Default provider. Hail size and wind reports with coordinates and timestamps.'),
  ('hailtrace', 'HailTrace', false,
   'Weather data provided by HailTrace',
   'Licensed. Geometry treated as render-only until the subscription agreement explicitly permits storage. Set geometry_storage_allowed = true only after legal confirmation.')
on conflict (id) do nothing;

create type storm_event_type as enum ('hail', 'wind', 'tornado', 'other');

create table storm_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null references storm_providers (id),
  -- The provider's own identifier, so re-ingesting the same report is a no-op.
  external_id     text,
  event_type      storm_event_type not null,
  occurred_at     timestamptz not null,
  -- Hail size in inches. The single most important prospecting filter: 1.0" is
  -- marginal, 1.75"+ reliably damages asphalt shingle.
  hail_size_inches numeric(4, 2),
  wind_speed_mph  smallint,
  magnitude_note  text,
  -- Point location of the report. Always safe to store for NOAA.
  location        geography(Point, 4326),
  -- Affected area polygon. NULL for providers whose licence forbids storage.
  affected_area   geography(MultiPolygon, 4326),
  city            text,
  county_parish   text,
  state           text,
  raw             jsonb,
  ingested_at     timestamptz not null default now(),
  unique (provider, external_id)
);

create index storm_events_location_gix on storm_events using gist (location);
create index storm_events_area_gix on storm_events using gist (affected_area);
create index on storm_events (occurred_at desc);
create index on storm_events (event_type, occurred_at desc);
create index on storm_events (hail_size_inches desc) where hail_size_inches is not null;

-- Enforce the licence in the database, not in reviewer memory.
create or replace function app.enforce_geometry_licence()
returns trigger
language plpgsql
as $$
declare allowed boolean;
begin
  if new.affected_area is null then
    return new;
  end if;
  select geometry_storage_allowed into allowed
    from storm_providers where id = new.provider;
  if not coalesce(allowed, false) then
    raise exception
      'Provider % is not permitted to store affected_area geometry. Render it from the API response instead.',
      new.provider
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger storm_events_geometry_licence
  before insert or update on storm_events
  for each row execute function app.enforce_geometry_licence();

-- Which properties a storm plausibly touched. Computed by us from our own
-- property locations against provider data, so this table is ours to keep.
create table property_storm_impacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  storm_event_id  uuid not null references storm_events (id) on delete cascade,
  distance_meters numeric(10, 1),
  -- How the association was made, so a loose match is never mistaken for a
  -- confirmed hit on the house.
  match_method    text not null default 'proximity',  -- proximity | polygon | provider_report
  computed_at     timestamptz not null default now(),
  unique (property_id, storm_event_id)
);

create index on property_storm_impacts (organization_id, property_id);
create index on property_storm_impacts (storm_event_id);

-- Storm events referenced by a specific inspection, captured at inspection time
-- so the office handoff can cite what the rep actually saw on the map that day.
create table inspection_storm_references (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid not null references inspections (id) on delete cascade,
  storm_event_id  uuid references storm_events (id) on delete set null,
  -- Denormalised snapshot: if the provider record later changes or is purged,
  -- the handoff document must still say what it said at the time.
  provider        text,
  event_summary   text,
  occurred_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (inspection_id, storm_event_id)
);

-- storm_events and storm_providers are reference data, readable by any
-- authenticated user; only service-role ingestion writes them.
alter table storm_providers enable row level security;
alter table storm_events enable row level security;

create policy storm_providers_read on storm_providers
  for select to authenticated using (true);
create policy storm_events_read on storm_events
  for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['property_storm_impacts', 'inspection_storm_references']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- =================================================================
-- 20260918_0006_handoff_and_sync.sql
-- =================================================================
-- =============================================================================
-- 0006  Office handoff, integration sync, AI runs, audit
-- =============================================================================
-- The handoff is the product's payoff and its highest-risk operation: pushing to
-- CompanyCam creates a Roofr job through the bidirectional sync, so a double-tap
-- must not create a double job. Idempotency is enforced by `payload_hash` plus a
-- unique index on (provider, record_type, external_id), and every attempt is
-- recorded in sync_jobs whether it succeeded or not.
-- =============================================================================

create type handoff_status as enum (
  'draft', 'validating', 'ready', 'sending', 'sent', 'failed', 'superseded'
);

create table office_handoffs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid not null references inspections (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  status          handoff_status not null default 'draft',
  -- Frozen snapshot of everything sent to the office. The handoff must remain
  -- readable exactly as sent even after the underlying records change.
  package_payload jsonb,
  -- Stable hash of package_payload, used to detect a no-op resend.
  payload_hash    text,
  pdf_storage_path text,
  recommended_action text,
  -- Validation results at the moment of sending: what was missing and whether
  -- the rep waived it. This is the audit trail if the office later asks why a
  -- photo is absent.
  validation_result jsonb,
  -- Which route actually carried it: companycam | pdf_email | manual
  delivery_channel text,
  sent_at         timestamptz,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on office_handoffs (organization_id, status);
create index on office_handoffs (inspection_id, created_at desc);
-- One live handoff per inspection; earlier ones become 'superseded'.
create unique index office_handoffs_one_live on office_handoffs (inspection_id)
  where status in ('draft', 'validating', 'ready', 'sending');

create table integration_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,          -- companycam | roofr | hailtrace | mapbox
  display_name    text,
  is_enabled      boolean not null default false,
  -- Credentials are NEVER stored here. They live in Edge Function secrets.
  -- This table holds non-secret configuration and health only.
  config          jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_health_ok  boolean,
  last_health_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider)
);

-- Mapping between our canonical records and a third party's.
create table external_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,
  record_type     text not null,        -- project | photo | document | job | contact
  -- Our side.
  local_table     text not null,
  local_id        uuid not null,
  -- Their side.
  external_id     text,
  external_url    text,
  sync_status     text not null default 'pending',   -- pending | synced | failed | skipped
  payload_hash    text,
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The idempotency guarantee: one external record per local record per provider.
  unique (provider, record_type, local_table, local_id)
);

create unique index external_records_provider_external_id
  on external_records (provider, record_type, external_id)
  where external_id is not null;
create index on external_records (organization_id, sync_status) where sync_status <> 'synced';

create table sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,
  operation       text not null,        -- create_project | upload_photo | upload_document
  local_table     text,
  local_id        uuid,
  handoff_id      uuid references office_handoffs (id) on delete cascade,
  -- Deduplication key: the same logical operation enqueued twice collapses.
  idempotency_key text not null,
  status          text not null default 'queued',  -- queued | running | succeeded | failed | dead
  attempt_count   smallint not null default 0,
  max_attempts    smallint not null default 5,
  next_attempt_at timestamptz not null default now(),
  request_payload jsonb,
  response_payload jsonb,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index on sync_jobs (status, next_attempt_at) where status in ('queued', 'failed');
create index on sync_jobs (handoff_id);

-- Every AI call, for cost visibility and for measuring whether assist helps.
create table ai_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  request_type    text not null,   -- photo_classify | quality_check | voice_structure | summary | handoff_narrative
  provider        text not null,
  model           text not null,
  prompt_version  text,
  subject_table   text,
  subject_id      uuid,
  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,
  estimated_cost_usd numeric(10, 6),
  -- Did the structured output pass Zod validation? A false here is a bug signal.
  schema_valid    boolean,
  error           text,
  created_at      timestamptz not null default now()
);

create index on ai_runs (organization_id, created_at desc);
create index on ai_runs (request_type, created_at desc);

-- Append-only audit log. No update or delete policy is granted to anyone.
create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete set null,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  subject_table   text,
  subject_id      uuid,
  before_state    jsonb,
  after_state     jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index on audit_log (organization_id, created_at desc);
create index on audit_log (subject_table, subject_id, created_at desc);

create trigger touch_office_handoffs before update on office_handoffs for each row execute function app.touch_updated_at();
create trigger touch_integration_connections before update on integration_connections for each row execute function app.touch_updated_at();
create trigger touch_external_records before update on external_records for each row execute function app.touch_updated_at();
create trigger touch_sync_jobs before update on sync_jobs for each row execute function app.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['office_handoffs', 'integration_connections']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- Sync plumbing and AI runs are readable by the org (the rep needs to see "sync
-- problem") but writable only by the service role running Edge Functions.
alter table external_records enable row level security;
alter table sync_jobs enable row level security;
alter table ai_runs enable row level security;
alter table audit_log enable row level security;

create policy external_records_read on external_records
  for select using (organization_id in (select app.current_org_ids()));
create policy sync_jobs_read on sync_jobs
  for select using (organization_id in (select app.current_org_ids()));
create policy ai_runs_read on ai_runs
  for select using (organization_id in (select app.current_org_ids()));
-- Audit log: readable by admins and managers only, and never mutable from the
-- client. Absence of INSERT/UPDATE/DELETE policies is intentional.
create policy audit_log_read on audit_log
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- =================================================================
-- 20260918_0007_invites.sql
-- =================================================================
-- -----------------------------------------------------------------------------
-- 0007 â€” Invite-based membership provisioning.
--
-- The site is publicly reachable, so "first user becomes admin" is not safe: a
-- stranger who signed up before the owner would own the organisation. Instead an
-- admin (or a seed migration) records an invite against an email address, and
-- the existing on_auth_user_created trigger grants membership when, and only
-- when, a user appears with that address.
--
-- Auth is magic-link only (signInWithOtp). There are no passwords anywhere in
-- this system, so there is nothing to provision beyond the membership row.
-- -----------------------------------------------------------------------------

create table if not exists organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  email           text not null,
  role            app_role not null default 'salesperson',
  invited_by      uuid references auth.users (id) on delete set null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_invites_email_shape check (position('@' in email) > 1)
);

-- One open invite per address per org. Accepted rows are kept as an audit trail
-- and do not block re-inviting someone who was removed.
create unique index if not exists organization_invites_open_email_idx
  on organization_invites (organization_id, lower(email))
  where accepted_at is null;

create index if not exists organization_invites_email_idx
  on organization_invites (lower(email)) where accepted_at is null;

drop trigger if exists touch_organization_invites on organization_invites;
create trigger touch_organization_invites before update on organization_invites
  for each row execute function app.touch_updated_at();

alter table organization_invites enable row level security;

-- Only admins and managers of the org can see or manage its invites. The
-- trigger below is SECURITY DEFINER, so provisioning does not depend on these.
drop policy if exists organization_invites_read on organization_invites;
create policy organization_invites_read on organization_invites
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists organization_invites_write on organization_invites;
create policy organization_invites_write on organization_invites
  for all using (app.has_org_role(organization_id, array['admin']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin']::app_role[]));

-- -----------------------------------------------------------------------------
-- Extend the existing signup trigger. It already creates the profile row; now
-- it also redeems any open invite for the new user's address.
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  inv record;
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
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

-- -----------------------------------------------------------------------------
-- Redeem outstanding invites for users who already exist. Signups that happened
-- before this migration never saw the loop above; this makes the migration
-- idempotent with respect to ordering.
-- -----------------------------------------------------------------------------
create or replace function app.redeem_pending_invites()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  redeemed integer := 0;
  rec record;
begin
  for rec in
    select i.id as invite_id, i.organization_id, i.role, u.id as user_id
      from organization_invites i
      join auth.users u on lower(u.email) = lower(i.email)
     where i.accepted_at is null
  loop
    insert into organization_members (organization_id, user_id, role)
    values (rec.organization_id, rec.user_id, rec.role)
    on conflict (organization_id, user_id)
      do update set role = excluded.role, is_active = true, updated_at = now();

    update organization_invites
       set accepted_at = now(), accepted_by = rec.user_id
     where id = rec.invite_id;

    update profiles
       set default_org_id = coalesce(default_org_id, rec.organization_id)
     where id = rec.user_id;

    redeemed := redeemed + 1;
  end loop;

  return redeemed;
end;
$$;

revoke all on function app.redeem_pending_invites() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Seed: the owner is admin of Delta Ridge Roofing on first sign-in.
-- -----------------------------------------------------------------------------
-- Guarded on the organisation existing as well as on the invite not existing.
-- The Delta Ridge org row was seeded by hand in production, not by a migration,
-- so without this guard the file cannot be replayed anywhere else: a fresh
-- database (the local harness in supabase/tests, or a staging project) fails
-- here on a foreign key and leaves the migration half applied.
insert into organization_invites (organization_id, email, role)
select 'd17a0000-0000-4000-8000-000000000001'::uuid, 'nedpearson@gmail.com', 'admin'::app_role
where exists (
  select 1 from organizations where id = 'd17a0000-0000-4000-8000-000000000001'::uuid
)
and not exists (
  select 1 from organization_invites
   where organization_id = 'd17a0000-0000-4000-8000-000000000001'::uuid
     and lower(email) = 'nedpearson@gmail.com'
);

select app.redeem_pending_invites();

-- =================================================================
-- 20260918_0008_pin_function_search_paths.sql
-- =================================================================
-- -----------------------------------------------------------------------------
-- 0008 â€” Pin search_path on the remaining helper functions.
--
-- The SECURITY DEFINER functions already pinned theirs (see 0002). These five
-- are plain trigger/helper functions, so the exposure is smaller, but an
-- unpinned search_path still lets a caller-supplied schema shadow an unqualified
-- name inside the body. Supabase's database linter flags all five
-- (0011_function_search_path_mutable) and it is a one-line fix each.
--
-- ALTER FUNCTION ... SET is used rather than CREATE OR REPLACE on purpose:
-- app.normalize_address backs a generated column on `properties`, and leaving
-- the body untouched keeps that dependency from being revalidated.
-- -----------------------------------------------------------------------------

alter function app.touch_updated_at()           set search_path = public, pg_catalog;
alter function app.normalize_address(text)      set search_path = public, pg_catalog;
alter function app.bump_lead_activity()         set search_path = public, pg_catalog;
alter function app.satisfy_checklist_on_photo() set search_path = public, pg_catalog;
alter function app.enforce_geometry_licence()   set search_path = public, pg_catalog;

-- =================================================================
-- 20260918_0009_handoff_override.sql
-- =================================================================
-- -----------------------------------------------------------------------------
-- 0009 â€” Record deliberate completeness overrides.
--
-- The completeness engine used to hard-gate completion. In the field that is
-- the wrong trade: a rep who cannot get on the roof, or whose homeowner walks
-- off mid-visit, still has to be able to close the visit out. Blocking them
-- does not produce the missing photo, it produces an inspection that never gets
-- recorded at all.
--
-- So nothing is mandatory any more. What replaces the gate is accountability:
-- the rep confirms what is missing, and that decision travels with the
-- inspection so the office sees the gaps before pricing rather than after.
-- -----------------------------------------------------------------------------

alter table inspections
  add column if not exists overridden_issue_codes text[] not null default '{}',
  add column if not exists override_note text;

comment on column inspections.overridden_issue_codes is
  'Completeness issue codes the inspector knowingly finished without. Empty means nothing was skipped.';
comment on column inspections.override_note is
  'Optional reason the inspector gave for finishing with outstanding items.';

-- Cheap partial index: the office view that matters is "show me the ones with
-- gaps", which is the minority of rows.
create index if not exists inspections_with_overrides_idx
  on inspections (organization_id)
  where cardinality(overridden_issue_codes) > 0;

-- =================================================================
-- 20260918_0010_client_ids_for_idempotent_sync.sql
-- =================================================================
-- =============================================================================
-- 0010  Client ids on the remaining field-captured tables
-- =============================================================================
-- `photos` and `voice_notes` already carry a client-generated `client_id` with
-- a unique constraint, which is what makes a retried upload safe. `inspections`
-- and `inspection_observations` did not, so the push layer could only INSERT
-- them â€” and an insert that succeeds on the server but whose acknowledgement
-- never reaches the phone (app killed, signal dropped between the write and the
-- response) is retried and creates a second copy of the same roof inspection.
--
-- The same column also turns the push into an UPSERT, which fixes a quieter and
-- worse bug: an inspection was pushed once, on creation, and every later edit â€”
-- the completion time, the rep's recommendation, the homeowner's stated roof
-- age, the override note â€” stayed on the phone forever. The office saw a
-- permanently in-progress shell.
--
-- `office_handoffs` gets one too, keyed to the local inspection id, so a rep
-- who taps Send twice gets one handoff row, not two.
--
-- Backfill uses the existing primary key, which is unique by definition, so
-- rows written before this migration keep a stable identity.
-- =============================================================================

alter table inspections add column if not exists client_id uuid;
update inspections set client_id = id where client_id is null;
alter table inspections alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table inspections alter column client_id set default gen_random_uuid();
alter table inspections
  add constraint inspections_org_client_unique unique (organization_id, client_id);

comment on column inspections.client_id is
  'UUID generated on the device before the row ever reaches the server. The '
  'conflict target for upserts, so a retried push updates rather than duplicates.';

alter table inspection_observations add column if not exists client_id uuid;
update inspection_observations set client_id = id where client_id is null;
alter table inspection_observations alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table inspection_observations alter column client_id set default gen_random_uuid();
alter table inspection_observations
  add constraint observations_org_client_unique unique (organization_id, client_id);

comment on column inspection_observations.client_id is
  'Device-generated UUID; conflict target for idempotent upserts.';

-- One handoff per local inspection per organization. Note this coexists with
-- office_handoffs_one_live: an upsert on (organization_id, client_id) resolves
-- to an UPDATE of the same row, so the partial "one live handoff per
-- inspection" index is never challenged by a resend.
alter table office_handoffs add column if not exists client_id uuid;
update office_handoffs set client_id = inspection_id where client_id is null;
alter table office_handoffs alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table office_handoffs alter column client_id set default gen_random_uuid();
alter table office_handoffs
  add constraint office_handoffs_org_client_unique unique (organization_id, client_id);

comment on column office_handoffs.client_id is
  'The local inspection id. Tapping Send to office twice updates one row.';

-- =================================================================
-- 20260919_0011_estimating_core.sql
-- =================================================================
-- =============================================================================
-- 0011  Estimating core: price book, cost engine, estimate versions
-- =============================================================================
-- Phase 1 of the estimator. No AI, no competitor data, no insurance comparison
-- yet - those sit on top of this and are worthless without it.
--
-- Two rules drive most of the shape here.
--
-- 1. MONEY IS AN INTEGER. Totals are bigint CENTS. Unit prices are integer
--    TEN-THOUSANDTHS of a dollar, because suppliers quote $0.0425/SF and
--    rounding that to the cent before multiplying by 3,800 SF invents money.
--    numeric would also be exact, but the client is TypeScript and the moment
--    a numeric crosses the wire it becomes a float; keeping integers end to
--    end means the browser and the database agree by construction.
--
-- 2. PRICES ARE APPEND-ONLY. A proposal written in March must reproduce
--    itself in September, so nothing here is ever updated in place. A new row
--    with a later effective_from supersedes an old one, and every estimate
--    version records exactly which book and which date it was priced against.
--
-- Cost and margin are NOT customer data. RLS below restricts them to admin and
-- manager; a salesperson can read the estimate and the selling price and
-- cannot read what the job costs. Hiding those columns in the UI is not a
-- control, it is a decoration.
-- =============================================================================

create type estimate_mode as enum ('retail', 'insurance_restoration', 'fortified');

create type scope_reason as enum (
  'code_required',
  'manufacturer_required',
  'warranty_required',
  'delta_ridge_standard',
  'customer_upgrade',
  'existing_condition',
  'access_condition',
  'allowance'
);

create type evidence_kind as enum (
  'measurement',
  'photo',
  'inspection_finding',
  'code_citation',
  'manufacturer_instruction',
  'supplier_quote',
  'subcontract_quote',
  'customer_request'
);

create type cost_category as enum (
  'material',
  'labor',
  'equipment',
  'subcontract',
  'permit',
  'disposal',
  'delivery',
  'fuel',
  'access',
  'safety',
  'warranty_reserve',
  'contingency',
  'overhead'
);

-- -----------------------------------------------------------------------------
-- Price book
-- -----------------------------------------------------------------------------

create table price_books (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  version          text not null,
  is_active        boolean not null default false,
  synchronised_at  timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, version)
);

-- Exactly one active book per organisation: an estimate priced against an
-- ambiguous book cannot be reproduced.
create unique index price_books_one_active on price_books (organization_id)
  where is_active;

create table material_items (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  price_book_id     uuid not null references price_books (id) on delete cascade,
  category          text not null,
  manufacturer      text,
  product_family    text,
  sku               text,
  description       text not null,
  unit              text not null,
  -- How much roof one purchase unit covers, in the unit the scope is measured
  -- in. Null for items counted directly (one pipe boot per pipe boot).
  coverage_per_unit numeric(12, 4),
  -- Purchase units that must be bought together. 3 bundles to a square.
  sale_increment    integer not null default 1,
  impact_rating     text,
  wind_rating_mph   integer,
  fortified_eligible boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint material_items_coverage_positive
    check (coverage_per_unit is null or coverage_per_unit > 0),
  constraint material_items_increment_positive check (sale_increment > 0)
);

create index on material_items (price_book_id, category) where is_active;
create index on material_items (organization_id, sku) where sku is not null;

create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  account_number  text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- Append-only. A price is never updated; a later effective_from supersedes it.
create table material_prices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  material_item_id uuid not null references material_items (id) on delete cascade,
  supplier_id      uuid references suppliers (id) on delete set null,
  -- Ten-thousandths of a dollar. $0.0425/SF is 425.
  unit_cost_e4     bigint not null,
  effective_from   date not null,
  -- Where the number came from. 'manual' is allowed; inventing one is not.
  source           text not null
    check (source in ('supplier_api', 'supplier_quote', 'invoice', 'manual')),
  source_reference text,
  recorded_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint material_prices_non_negative check (unit_cost_e4 >= 0),
  unique (material_item_id, supplier_id, effective_from)
);

create index on material_prices (material_item_id, effective_from desc);

create table labor_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations (id) on delete cascade,
  price_book_id          uuid not null references price_books (id) on delete cascade,
  description            text not null,
  unit                   text not null,
  production_rate_per_hour numeric(12, 4),
  crew_size              integer,
  -- Cents. A minimum charge, because nobody rolls a truck for 40 LF.
  minimum_charge_cents   bigint,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint labor_items_minimum_non_negative
    check (minimum_charge_cents is null or minimum_charge_cents >= 0)
);

create index on labor_items (price_book_id) where is_active;

create table labor_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  labor_item_id   uuid not null references labor_items (id) on delete cascade,
  unit_cost_e4    bigint not null,
  effective_from  date not null,
  source          text not null
    check (source in ('subcontract_quote', 'internal_burdened', 'manual')),
  source_reference text,
  recorded_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint labor_rates_non_negative check (unit_cost_e4 >= 0),
  unique (labor_item_id, effective_from)
);

create index on labor_rates (labor_item_id, effective_from desc);

-- -----------------------------------------------------------------------------
-- Policy: margin ladder, overhead, waste model
-- -----------------------------------------------------------------------------

-- Basis points throughout. 25% is 2500. Rates are integers for the same reason
-- money is: 0.235 multiplied through a dozen line items does not reproduce
-- itself when the proposal is regenerated.
create table margin_policies (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations (id) on delete cascade,
  version                text not null,
  standard_margin_bps    integer not null,
  target_margin_bps      integer not null,
  floor_margin_bps       integer not null,
  stop_margin_bps        integer not null,
  overhead_rate_bps      integer not null,
  overhead_minimum_cents bigint not null default 0,
  commission_bps         integer not null default 0,
  financing_dealer_fee_bps integer not null default 0,
  card_processing_bps    integer not null default 0,
  is_active              boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, version),
  constraint margin_policies_descend check (
    standard_margin_bps >= target_margin_bps
    and target_margin_bps >= floor_margin_bps
    and floor_margin_bps >= stop_margin_bps
    and stop_margin_bps >= 0
  ),
  -- Margin plus the costs that scale with price must leave something to price
  -- against, or solving for a price diverges.
  constraint margin_policies_solvable check (
    standard_margin_bps + commission_bps + financing_dealer_fee_bps
      + card_processing_bps < 10000
  )
);

create unique index margin_policies_one_active on margin_policies (organization_id)
  where is_active;

-- The waste model is configuration, not a constant, because its coefficients
-- are the first thing that should be calibrated against real job actuals.
create table waste_models (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  version               text not null,
  base_bps              integer not null,
  hip_valley_strip_ft   numeric(6, 3) not null,
  rake_strip_ft         numeric(6, 3) not null,
  steep_surcharge_bps   integer not null,
  steep_pitch_rise      integer not null,
  min_bps               integer not null,
  max_bps               integer not null,
  is_active             boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (organization_id, version),
  constraint waste_models_bounds check (min_bps >= 0 and max_bps > min_bps)
);

create unique index waste_models_one_active on waste_models (organization_id)
  where is_active;

-- -----------------------------------------------------------------------------
-- Estimates
-- -----------------------------------------------------------------------------

create table estimates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  lead_id         uuid references leads (id) on delete set null,
  inspection_id   uuid references inspections (id) on delete set null,
  client_id       uuid not null default gen_random_uuid(),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, client_id)
);

create index on estimates (organization_id, property_id) where deleted_at is null;
create index on estimates (inspection_id) where inspection_id is not null;

-- A version is immutable once written. Revising an estimate appends a new one,
-- so the document a homeowner was shown on the 14th still exists on the 30th.
-- The provenance columns are what make a six-month-old proposal reproducible:
-- without them "recalculate" silently reprices at today's numbers.
create table estimate_versions (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations (id) on delete cascade,
  estimate_id               uuid not null references estimates (id) on delete cascade,
  version_number            integer not null,
  mode                      estimate_mode not null default 'retail',
  price_book_id             uuid not null references price_books (id),
  priced_as_of              date not null,
  margin_policy_id          uuid not null references margin_policies (id),
  waste_model_id            uuid not null references waste_models (id),
  geometry_source           text not null,
  geometry                  jsonb not null default '{}'::jsonb,
  waste_bps                 integer,
  waste_override_bps        integer,
  waste_override_reason     text,
  jurisdiction_rule_version text,
  -- Cents, all of them. Denormalised totals so the office is not recomputing
  -- a hundred line items to sort a list.
  direct_cost_cents         bigint not null default 0,
  overhead_cents            bigint not null default 0,
  job_cost_cents            bigint not null default 0,
  sell_price_cents          bigint,
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  unique (estimate_id, version_number),
  -- An override without a reason is how waste quietly becomes a margin bucket.
  constraint estimate_versions_override_has_reason check (
    waste_override_bps is null
    or (waste_override_reason is not null and length(trim(waste_override_reason)) > 0)
  ),
  constraint estimate_versions_costs_non_negative check (
    direct_cost_cents >= 0 and overhead_cents >= 0 and job_cost_cents >= 0
  )
);

create index on estimate_versions (organization_id, estimate_id, version_number desc);

create table estimate_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  estimate_version_id uuid not null references estimate_versions (id) on delete cascade,
  sort_order          integer not null default 0,
  category            cost_category not null,
  description         text not null,
  -- Thousandths of a unit. 38.2 SQ is 38200.
  quantity_milli      bigint not null,
  unit                text not null,
  -- Ten-thousandths of a dollar, as resolved from the price book on
  -- priced_as_of. Stored on the line so the line survives a price change.
  unit_cost_e4        bigint not null,
  cost_cents          bigint not null,
  -- Why this line exists. Not decoration: it is the difference between a
  -- customer upgrade and something a code or a manufacturer actually requires,
  -- and presenting the first as the second is a misrepresentation.
  reason              scope_reason not null,
  is_optional         boolean not null default false,
  material_item_id    uuid references material_items (id) on delete set null,
  labor_item_id       uuid references labor_items (id) on delete set null,
  -- Purchase rounding, kept visible rather than buried in waste.
  purchase_units      numeric(12, 3),
  overage_quantity    numeric(12, 3),
  created_at          timestamptz not null default now(),
  constraint estimate_items_quantity_non_negative check (quantity_milli >= 0),
  constraint estimate_items_unit_cost_non_negative check (unit_cost_e4 >= 0)
);

create index on estimate_items (estimate_version_id, sort_order);
create index on estimate_items (organization_id, category);

-- Answers "why is this on my estimate?" without anybody guessing.
create table estimate_item_evidence (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  estimate_item_id uuid not null references estimate_items (id) on delete cascade,
  kind             evidence_kind not null,
  photo_id         uuid references photos (id) on delete set null,
  observation_id   uuid references inspection_observations (id) on delete set null,
  reference_id     uuid,
  summary          text not null,
  created_at       timestamptz not null default now()
);

create index on estimate_item_evidence (estimate_item_id);
create index on estimate_item_evidence (photo_id) where photo_id is not null;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger touch_price_books before update on price_books
  for each row execute function app.touch_updated_at();
create trigger touch_material_items before update on material_items
  for each row execute function app.touch_updated_at();
create trigger touch_suppliers before update on suppliers
  for each row execute function app.touch_updated_at();
create trigger touch_labor_items before update on labor_items
  for each row execute function app.touch_updated_at();
create trigger touch_margin_policies before update on margin_policies
  for each row execute function app.touch_updated_at();
create trigger touch_estimates before update on estimates
  for each row execute function app.touch_updated_at();

-- A priced version is a record of what was shown to a homeowner. Editing one
-- in place rewrites history; revisions append a new version instead.
create or replace function app.forbid_estimate_version_rewrite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'estimate versions are immutable; append a new version'
    using errcode = 'restrict_violation';
end;
$$;

create trigger estimate_versions_immutable
  before update or delete on estimate_versions
  for each row execute function app.forbid_estimate_version_rewrite();

create trigger estimate_items_immutable
  before update or delete on estimate_items
  for each row execute function app.forbid_estimate_version_rewrite();

-- Prices are append-only for the same reason.
create trigger material_prices_immutable
  before update or delete on material_prices
  for each row execute function app.forbid_estimate_version_rewrite();

create trigger labor_rates_immutable
  before update or delete on labor_rates
  for each row execute function app.forbid_estimate_version_rewrite();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
-- Cost is not customer data. A salesperson may read an estimate and its
-- selling price; what the job costs, what the crew is paid and what margin the
-- company holds are restricted to admin and manager at the DATABASE, because
-- an anon key plus a REST call ignores whatever the UI chose to render.

alter table price_books            enable row level security;
alter table suppliers              enable row level security;
alter table material_items         enable row level security;
alter table material_prices        enable row level security;
alter table labor_items            enable row level security;
alter table labor_rates            enable row level security;
alter table margin_policies        enable row level security;
alter table waste_models           enable row level security;
alter table estimates              enable row level security;
alter table estimate_versions      enable row level security;
alter table estimate_items         enable row level security;
alter table estimate_item_evidence enable row level security;

-- Cost-bearing tables: admin and manager only.
do $$
declare t text;
begin
  foreach t in array array[
    'price_books', 'suppliers', 'material_items', 'material_prices',
    'labor_items', 'labor_rates', 'margin_policies'
  ]
  loop
    execute format($f$
      create policy %1$s_cost_access on %1$I
        using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
        with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
    $f$, t);
  end loop;
end;
$$;

-- The waste model is an engineering input, not a cost: a rep has to be able to
-- see why 38.2 SQ became 41.1 SQ of material.
create policy waste_models_org_access on waste_models
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

-- Estimates themselves are visible to the whole organisation.
create policy estimates_org_access on estimates
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

create policy estimate_item_evidence_org_access on estimate_item_evidence
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

-- Versions and line items carry cost columns, so reads are split: everyone in
-- the organisation may read through the cost-free view below, and only admin
-- and manager may read the base tables. Writes stay organisation-wide because
-- a rep building an estimate on a driveway is a normal thing to do.
create policy estimate_versions_read on estimate_versions
  for select using (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

create policy estimate_versions_insert on estimate_versions
  for insert with check (organization_id in (select app.current_org_ids()));

create policy estimate_items_read on estimate_items
  for select using (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

create policy estimate_items_insert on estimate_items
  for insert with check (organization_id in (select app.current_org_ids()));

-- What a salesperson sees: scope, quantities, the reason each line exists and
-- the selling price. No unit cost, no margin, no overhead.
-- Deliberately NOT security_invoker. The point of this view is to let someone
-- read rows they may not read from the base table, with the cost columns
-- absent - which is exactly what invoker rights would prevent. Column
-- privileges cannot express it either: every app user is the same database
-- role, so admin and salesperson are indistinguishable at that level.
--
-- The safety of a definer view rests entirely on its own WHERE clause, so the
-- organisation filter below is load-bearing. app.current_org_ids() reads
-- auth.uid() from the request JWT, which does not change with the executing
-- role, so it still scopes to the caller.
create view estimate_versions_sales
with (security_invoker = false)
as
select
  v.id,
  v.organization_id,
  v.estimate_id,
  v.version_number,
  v.mode,
  v.priced_as_of,
  v.geometry_source,
  v.waste_bps,
  v.sell_price_cents,
  v.created_at
from estimate_versions v
where v.organization_id in (select app.current_org_ids());

comment on view estimate_versions_sales is
  'Cost-free projection of estimate_versions for salesperson-facing screens. '
  'security_invoker keeps the caller RLS in force rather than the view owner.';

-- Same projection for the line items: scope and quantity, never unit cost.
create view estimate_items_sales
with (security_invoker = false)
as
select
  i.id,
  i.organization_id,
  i.estimate_version_id,
  i.sort_order,
  i.category,
  i.description,
  i.quantity_milli,
  i.unit,
  i.reason,
  i.is_optional
from estimate_items i
where i.organization_id in (select app.current_org_ids());

comment on view estimate_items_sales is
  'Cost-free projection of estimate_items. See estimate_versions_sales for why '
  'this is a definer view rather than an invoker one.';

grant select on estimate_versions_sales to authenticated;
grant select on estimate_items_sales to authenticated;

comment on column estimate_items.unit_cost_e4 is
  'Ten-thousandths of a dollar, resolved from the price book on the version''s '
  'priced_as_of and frozen here so a later price change cannot alter a '
  'proposal that has already been presented.';

comment on column estimate_items.reason is
  'Why the line exists. A customer upgrade presented as a code requirement is '
  'a misrepresentation, so the distinction is stored, not inferred.';

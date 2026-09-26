-- Delta Ridge - all migrations, concatenated for one-shot application.
-- Generated 2026-09-26 from supabase/migrations/.
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
  'Deliberately a definer view: invoker rights would re-apply the base-table '
  'policy and defeat the purpose, and column privileges cannot express it '
  'because every app user is the same database role. The organisation filter '
  'in the view body is therefore load-bearing.';

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

-- =================================================================
-- 20260919_0012_compliance_rules.sql
-- =================================================================
-- =============================================================================
-- 0012  Compliance rules: sourced, versioned, and allowed to say "I don't know"
-- =============================================================================
-- Nothing in Delta Ridge may assert a legal, code, permit, licensing or
-- programme requirement unless a row here says so, and every row carries where
-- it came from, when it took effect, and when a human last checked it.
--
-- The design point is the third state. A rule can be:
--   verified              - source read, review interval not yet lapsed
--   review_due            - was verified, interval lapsed, still shown WITH its age
--   requires_verification - source is null: we know the question, not the answer
--
-- A rule with no source is not deleted and not trusted. It surfaces as a
-- question, which is the only honest thing to do with a permit fee nobody has
-- looked up. The check constraint below makes that explicit: an unsourced rule
-- must say so in its notes, so it cannot be mistaken for a verified one that
-- merely lost its citation.
--
-- These rows are global rather than per-organisation. Louisiana law does not
-- vary by tenant, and duplicating it per organisation would mean one customer
-- running on a stale copy of a statute.
-- =============================================================================

create type rule_category as enum (
  'licensing',
  'permit',
  'code',
  'contract_notice',
  'conduct',
  'incentive_programme',
  'documentation'
);

create type source_tier as enum (
  'statute',
  'state_agency',
  'ahj',
  'adopted_code',
  'manufacturer',
  'licensed_dataset',
  'quote',
  'secondary'
);

create table compliance_rules (
  id                      text primary key,
  category                rule_category not null,
  state                   text not null,
  -- Empty array means statewide. Otherwise parish or municipality names.
  applies_to              text[] not null default '{}',
  summary                 text not null,
  -- The machine-readable effect, discriminated by an "kind" key. Kept as jsonb
  -- because the shapes genuinely differ - a licence threshold and a verbatim
  -- contract notice have nothing in common - and because the TypeScript union
  -- is the real schema.
  effect                  jsonb not null,
  effective_from          date not null,
  effective_until         date,
  source_tier             source_tier,
  source_citation         text,
  source_url              text,
  source_verified_at      date,
  source_verified_by      text,
  review_interval_months  integer not null default 6,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint compliance_rules_effect_has_kind
    check (effect ? 'kind'),

  constraint compliance_rules_review_interval_positive
    check (review_interval_months > 0),

  constraint compliance_rules_dates_ordered
    check (effective_until is null or effective_until >= effective_from),

  -- A source is all-or-nothing. A citation with no verification date is worse
  -- than no citation: it looks checked.
  constraint compliance_rules_source_complete check (
    (source_tier is null and source_citation is null and source_url is null
     and source_verified_at is null and source_verified_by is null)
    or
    (source_tier is not null and source_citation is not null and source_url is not null
     and source_verified_at is not null and source_verified_by is not null)
  ),

  -- An unsourced rule must announce itself.
  constraint compliance_rules_unsourced_is_declared check (
    source_tier is not null
    or (notes is not null and notes like '%REQUIRES VERIFICATION%')
  ),

  constraint compliance_rules_url_is_https
    check (source_url is null or source_url like 'https://%')
);

create index on compliance_rules (state, category) where effective_until is null;
create index on compliance_rules (source_verified_at);
create index compliance_rules_applies_to_gin on compliance_rules using gin (applies_to);

create trigger touch_compliance_rules before update on compliance_rules
  for each row execute function app.touch_updated_at();

-- Every change to a rule is kept. When a contract written in March cited a
-- statute, it has to be possible to show what the row said in March.
create table compliance_rule_history (
  id                 uuid primary key default gen_random_uuid(),
  rule_id            text not null,
  changed_at         timestamptz not null default now(),
  changed_by         uuid references auth.users (id) on delete set null,
  operation          text not null check (operation in ('insert', 'update', 'delete')),
  previous_state     jsonb,
  new_state          jsonb
);

create index on compliance_rule_history (rule_id, changed_at desc);

create or replace function app.record_compliance_rule_change()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $$
begin
  insert into compliance_rule_history (rule_id, changed_by, operation, previous_state, new_state)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger compliance_rules_history
  after insert or update or delete on compliance_rules
  for each row execute function app.record_compliance_rule_change();

-- Rules are readable by anyone signed in: a rep on a driveway needs to know
-- the parish wants geo-tagged photographs. Writing them is not a tenant
-- operation at all - it follows a human reading an official source - so no
-- write policy is granted here and changes go through a migration or an
-- administrator, on purpose.
alter table compliance_rules enable row level security;
alter table compliance_rule_history enable row level security;

create policy compliance_rules_read on compliance_rules
  for select using (auth.uid() is not null);

create policy compliance_rule_history_read on compliance_rule_history
  for select using (auth.uid() is not null);

comment on table compliance_rules is
  'Sourced legal, code, permit and programme rules. A row with a null source is '
  'a known question, not a known answer, and must say REQUIRES VERIFICATION in '
  'its notes. Nothing in the application may assert a requirement that does not '
  'trace to a row here.';

comment on column compliance_rules.source_verified_at is
  'The date a human last read the official source. Combined with '
  'review_interval_months this is what turns a rule review_due rather than '
  'letting it quietly go stale.';

-- =================================================================
-- 20260920_0013_lead_client_ids.sql
-- =================================================================
-- =============================================================================
-- 0013  Client ids on the CRM tables the field app writes
-- =============================================================================
-- Leads, activities and appointments are captured on a phone in a driveway,
-- often with no signal, and pushed later. Without a device-generated identity
-- the push layer can only INSERT, and an insert whose acknowledgement never
-- arrives â€” app killed, signal dropped between the write and the response â€” is
-- retried and creates a second copy of the same conversation.
--
-- The same column turns every push into an UPSERT, which matters more here
-- than anywhere else: a lead's whole value is that its STATUS moves. Pushing
-- once on creation would leave the office looking at a lead that is forever
-- "attempted" while the rep has since booked, inspected and sold it.
--
-- Backfill uses the existing primary key, which is unique by definition, so
-- rows written before this migration keep a stable identity.
-- =============================================================================

alter table leads add column if not exists client_id uuid;
update leads set client_id = id where client_id is null;
alter table leads alter column client_id set not null;
-- A default matters as much as the constraint: rows created by anything other
-- than the field app (the office, a seed, a future web form) still get a stable
-- identity instead of failing on a NOT NULL they know nothing about.
alter table leads alter column client_id set default gen_random_uuid();
alter table leads
  add constraint leads_org_client_unique unique (organization_id, client_id);

comment on column leads.client_id is
  'UUID generated on the device before the row ever reaches the server. The '
  'conflict target for upserts, so a retried push updates rather than duplicates.';

alter table activities add column if not exists client_id uuid;
update activities set client_id = id where client_id is null;
alter table activities alter column client_id set not null;
alter table activities alter column client_id set default gen_random_uuid();
alter table activities
  add constraint activities_org_client_unique unique (organization_id, client_id);

comment on column activities.client_id is
  'Device-generated UUID. A knock recorded once offline and pushed twice is '
  'one row, not two, which is the difference between a contact history and a '
  'pile of duplicates.';

alter table appointments add column if not exists client_id uuid;
update appointments set client_id = id where client_id is null;
alter table appointments alter column client_id set not null;
alter table appointments alter column client_id set default gen_random_uuid();
alter table appointments
  add constraint appointments_org_client_unique unique (organization_id, client_id);

comment on column appointments.client_id is
  'The local lead id. Rescheduling on the phone updates one appointment row.';

-- -----------------------------------------------------------------------------
-- Do-not-contact has to be answerable without scanning every lead.
--
-- A rep about to knock, and any future messaging, must be able to ask "is this
-- address off limits?" cheaply. Leaving that as a sequential scan over leads is
-- how a do-not-knock request quietly stops being honoured once the table grows.
-- -----------------------------------------------------------------------------
create index if not exists leads_do_not_contact
  on leads (organization_id, property_id)
  where deleted_at is null and status = 'do_not_contact';

-- Activities are read newest-first for one lead, constantly. The existing
-- (lead_id, occurred_at desc) index covers it; this one covers the other read
-- that matters â€” what a rep did today, across every lead.
create index if not exists activities_by_user_day
  on activities (organization_id, user_id, occurred_at desc);

-- =================================================================
-- 20260920_0014_lead_attachments.sql
-- =================================================================
-- =============================================================================
-- 0014  Voice notes and photos captured against a LEAD
-- =============================================================================
-- Deliberately a separate table from `photos` and `voice_notes`, which belong
-- to an inspection.
--
-- An inspection photo is evidence. It is taken against a named category, it is
-- checked for quality, it goes into the package an adjuster reads, and the
-- completeness score depends on it. A lead photo is the rep's own memory: the
-- gate code, the dog, a business card, the stain on a ceiling the homeowner
-- pointed at from the doorway.
--
-- Filing them in one table would put unvetted driveway snapshots into the
-- evidence package, and would make the documentation score answerable to
-- photos nobody meant as documentation. Keeping them apart costs one table and
-- removes a whole category of mistake.
--
-- Storage reuses the `inspection-photos` bucket. Its policy checks only that
-- the second path segment is an organization the caller belongs to, so
-- `organization/<org>/leads/...` is covered by the same rule with no new
-- policy to keep in step.
-- =============================================================================

create table lead_attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  -- Device-generated, so a retried upload updates one row instead of creating
  -- a second copy of the same recording.
  client_id        uuid not null default gen_random_uuid(),
  lead_id          uuid references leads (id) on delete cascade,
  activity_id      uuid references activities (id) on delete set null,
  captured_by      uuid references auth.users (id) on delete set null,
  kind             text not null,
  storage_path     text not null,
  byte_size        integer not null,
  duration_seconds integer,
  width            integer,
  height           integer,
  -- Present only if something actually transcribed it. Never a placeholder:
  -- an empty transcript must not read as "nothing was said".
  transcript       text,
  captured_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint lead_attachments_kind check (kind in ('voice', 'photo')),
  constraint lead_attachments_org_client_unique unique (organization_id, client_id),
  constraint lead_attachments_voice_has_duration check (
    kind <> 'voice' or duration_seconds is not null
  )
);

create index on lead_attachments (organization_id, lead_id, captured_at desc);
create index on lead_attachments (activity_id);

alter table lead_attachments enable row level security;
create policy lead_attachments_org_access on lead_attachments
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

comment on table lead_attachments is
  'Voice notes and photos a rep captured while working a lead. NOT inspection '
  'evidence - see photos and voice_notes for that.';

-- =================================================================
-- 20260923_0015_parcel_provenance_and_suppression.sql
-- =================================================================
-- =============================================================================
-- 0015  Parcel-sourced owner facts, with provenance -- and one suppression list
-- =============================================================================
-- Two tables that have nothing to do with each other except that both exist to
-- stop the same class of mistake: saying something to a homeowner that the
-- record does not support.
--
-- 1. property_parcels
--
--    The door list now carries the assessor's owner name on almost every door.
--    That name will be spoken out loud on a doorstep, so where it came from and
--    when it was read have to travel with it. A name with no date behind it is
--    worse than no name, because it will be used with confidence.
--
--    Deliberately NOT merged into `properties` or `customers`. `properties` is
--    what Delta Ridge knows about a roof it has worked on; this is what the
--    parish publishes about a parcel, refreshed on the parish's schedule and
--    overwritten wholesale when it is. `customers` is a person the company has
--    a relationship with -- a recorded owner is not that, and promoting every
--    parcel owner into `customers` would fill the CRM with thousands of people
--    nobody has ever spoken to.
--
-- 2. contact_suppressions
--
--    Built now, before any outbound channel exists. Delta Ridge knocks and
--    mails today; no number is dialled from this app. But the moment a rep is
--    told "don't contact me again" at a door, that has to be recorded
--    somewhere permanent, and it has to still be there on the day a phone or an
--    email channel is switched on.
--
--    Keyed on the contact point, NOT on a lead and NOT on a channel. The FCC
--    revocation rule in force since April 2025 makes an opt-out cross-channel:
--    someone who says stop has said stop to calls, texts and mail alike, by any
--    reasonable method. One row therefore suppresses every channel. The FCC's
--    internal do-not-call rule requires honouring such a request for five
--    years; this table has no expiry and nothing in the application deletes
--    from it, which is the simplest way to be sure of that.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What the parish assessor says about a parcel
-- -----------------------------------------------------------------------------
create table property_parcels (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  -- Nullable: a parcel is worth caching before anyone has worked the address.
  property_id          uuid references properties (id) on delete set null,

  -- Which roll this came from. 'ebr' today; Ascension and Regrid would be rows
  -- here rather than columns, which is why the provider is stored per record.
  provider             text not null,
  parcel_number        text not null,
  parish               text not null,

  situs_address        text not null,
  normalized_address   text generated always as (
                         app.normalize_address(situs_address)
                       ) stored,

  owner_name           text not null,
  -- person / trust / company / government / unknown. Classified from the
  -- recorded string, never parsed into given and family names: entity owners
  -- are common and splitting them puts a wrong name in a rep's mouth.
  owner_kind           text not null default 'unknown',
  owner_mailing_address text,
  owner_mailing_locality text,

  -- owner_occupied / likely_absentee / unknown. "Likely" is load-bearing: the
  -- weaker signal is a tax bill going elsewhere, and a PO box is not a tenant.
  occupancy            text not null default 'unknown',
  -- homestead_exemption / mailing_matches / mailing_differs / unknown.
  -- Stored so the screen can show WHY, and so a future rule change can be
  -- applied to old rows without re-reading the parish.
  occupancy_basis      text not null default 'unknown',
  homestead_exemption  numeric(14, 2),

  subdivision          text,
  flood_zone           text,
  legal_description    text,

  -- Assessed value only. East Baton Rouge publishes improvement value and fair
  -- market value as columns and leaves both empty on every parcel sampled
  -- (0 of 2,000), so storing them would put a zero on screen that reads as a
  -- fact. If a parish ever populates them, add the columns then.
  assessed_value       numeric(14, 2),
  land_value           numeric(14, 2),

  location             geography(Point, 4326),
  boundary             geography(Polygon, 4326),

  -- Provenance. `retrieved_at` is when this application read it; the parish
  -- does not publish a per-record update time, which is itself worth recording
  -- by its absence rather than faking one.
  retrieved_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint property_parcels_provider check (provider in ('ebr', 'ascension', 'regrid')),
  constraint property_parcels_owner_kind check (
    owner_kind in ('person', 'trust', 'company', 'government', 'unknown')
  ),
  constraint property_parcels_occupancy check (
    occupancy in ('owner_occupied', 'likely_absentee', 'unknown')
  ),
  constraint property_parcels_occupancy_basis check (
    occupancy_basis in ('homestead_exemption', 'mailing_matches', 'mailing_differs', 'unknown')
  ),
  -- An occupancy claim without a basis is an assertion nobody can check.
  constraint property_parcels_occupancy_has_basis check (
    occupancy = 'unknown' or occupancy_basis <> 'unknown'
  ),
  constraint property_parcels_identity unique (organization_id, provider, parcel_number)
);

create index on property_parcels (organization_id, normalized_address);
create index on property_parcels (organization_id, property_id);
create index on property_parcels using gist (location);
-- Finding every parcel not read for a month is the refresh job's only query.
create index on property_parcels (organization_id, retrieved_at);

alter table property_parcels enable row level security;
create policy property_parcels_org_access on property_parcels
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

comment on table property_parcels is
  'What a parish assessor publishes about a parcel, with the time it was read. '
  'Not a customer record and not a Delta Ridge property record.';
comment on column property_parcels.occupancy is
  'likely_absentee is deliberately hedged: the signal is a tax bill going '
  'elsewhere, which a PO box produces just as readily as a rental.';
comment on column property_parcels.assessed_value is
  'The only value the parish populates. Improvement and fair-market value are '
  'empty on every EBR parcel sampled, so they are not stored.';

-- -----------------------------------------------------------------------------
-- Do not contact. One list, every channel, no expiry.
-- -----------------------------------------------------------------------------
create table contact_suppressions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,

  -- 'phone' or 'email' or 'address'. What KIND of contact point this is --
  -- not which channel is suppressed. Every channel is.
  contact_kind     text not null,
  -- Normalised at write time: digits only for a phone, lowercased and trimmed
  -- for an email. A suppression that does not match on the next lookup is not
  -- a suppression.
  contact_value    text not null,

  -- How the request arrived, in the words of the rule that governs it:
  -- 'verbal_at_door', 'reply_stop', 'unsubscribe_link', 'written', 'staff_entry'.
  method           text not null,
  -- Free text, verbatim where there is any. The FCC treats revocation by "any
  -- reasonable method", so what was actually said is the record that matters.
  request_text     text,

  requested_at     timestamptz not null default now(),
  -- When outbound actually stopped. Separate from requested_at on purpose:
  -- the gap between them is the number a regulator asks about.
  honored_at       timestamptz not null default now(),
  recorded_by      uuid references auth.users (id) on delete set null,
  -- Where it came from, if it came from a door.
  lead_id          uuid references leads (id) on delete set null,

  created_at       timestamptz not null default now(),

  constraint contact_suppressions_kind check (contact_kind in ('phone', 'email', 'address')),
  constraint contact_suppressions_method check (
    method in ('verbal_at_door', 'reply_stop', 'unsubscribe_link', 'written', 'staff_entry')
  ),
  constraint contact_suppressions_value_present check (length(trim(contact_value)) > 0),
  -- Re-recording the same request must not create a second row, but it must
  -- also never fail a write and lose the request.
  constraint contact_suppressions_identity unique (organization_id, contact_kind, contact_value)
);

create index on contact_suppressions (organization_id, contact_kind, contact_value);
create index on contact_suppressions (organization_id, lead_id);

alter table contact_suppressions enable row level security;

-- Insert and read, for anyone in the organisation. There is deliberately no
-- delete policy and no update policy: an opt-out is not editable and not
-- removable through the application, by anyone, at any level. Purchasing new
-- contact data for someone does not un-say what they said.
create policy contact_suppressions_read on contact_suppressions
  for select
  using (organization_id in (select app.current_org_ids()));
create policy contact_suppressions_insert on contact_suppressions
  for insert
  with check (organization_id in (select app.current_org_ids()));

comment on table contact_suppressions is
  'Do-not-contact requests. One row suppresses EVERY channel, because the FCC '
  'revocation rule in force since April 2025 makes an opt-out cross-channel. '
  'No expiry, no delete policy: the internal do-not-call rule requires five '
  'years and never deleting is the simplest way to be sure of it.';
comment on column contact_suppressions.honored_at is
  'When outbound actually stopped. The gap from requested_at is the number a '
  'regulator asks about.';

-- =================================================================
-- 20260923_0016_sync_read_views.sql
-- =================================================================
-- =============================================================================
-- 0016  Read views for the field app's pull path
-- =============================================================================
-- Until now sync was one-way. Every `.select()` in the client was a `returning
-- id` after a write; nothing ever read the server back. That is not a partial
-- feature, it is a different system: a lead lived on the phone that captured it,
-- a second rep could not see the street their colleague had already walked, and
-- a wiped device was a wiped pipeline regardless of how reliably the push
-- worked.
--
-- Two views rather than direct table reads, for one reason each:
--
--   1. `properties.location` is `geography(Point)`. PostgREST serialises it as
--      hex WKB, which the client cannot turn back into a latitude without
--      shipping a WKB parser. The view does the projection in the database,
--      where the geometry functions already live.
--   2. The client keys everything on `client_id`, not on the server's `id`. An
--      activity's row carries its lead's server id; the view exposes that
--      lead's `client_id` alongside it so a pulled knock can be filed against
--      the lead the device already knows, without a second round trip per row.
--
-- `security_invoker = true` is the load-bearing option. Without it a view runs
-- as its OWNER, which would bypass every RLS policy on leads, properties and
-- customers and hand any authenticated user the whole table. With it the caller
-- is still the caller and the existing policies apply unchanged â€” no new policy
-- is defined here, and none should be.
--
-- Rollback: `drop view if exists public.activity_sync_rows, public.lead_sync_rows;`
-- Nothing else references them and no table is altered, so the drop is safe at
-- any time.
-- =============================================================================

create or replace view public.lead_sync_rows
with (security_invoker = true) as
select
  l.id                as remote_id,
  l.client_id,
  l.organization_id,
  l.status::text      as status,
  l.opportunity_score,
  l.assigned_to,
  l.next_action_at,
  l.next_action_note,
  l.first_contacted_at,
  l.last_activity_at,
  l.created_at,
  l.updated_at,
  p.address_line1,
  p.city,
  p.postal_code,
  -- Cast to geometry first: st_y/st_x on geography would compute on the
  -- spheroid, and for a point that is the same answer by a slower route.
  st_y(p.location::geometry) as latitude,
  st_x(p.location::geometry) as longitude,
  c.first_name        as contact_name,
  c.primary_phone     as contact_phone
from leads l
join properties p on p.id = l.property_id
left join customers c on c.id = l.customer_id
where l.deleted_at is null;

comment on view public.lead_sync_rows is
  'Leads flattened with their property and customer for the field app''s pull '
  'path. security_invoker, so row-level security on the underlying tables '
  'applies to the caller exactly as it would on a direct select.';

create or replace view public.activity_sync_rows
with (security_invoker = true) as
select
  a.id              as remote_id,
  a.client_id,
  a.organization_id,
  a.lead_id,
  l.client_id       as lead_client_id,
  a.user_id,
  a.activity_type,
  a.outcome,
  a.body,
  a.occurred_at
from activities a
join leads l on l.id = a.lead_id
where l.deleted_at is null;

comment on view public.activity_sync_rows is
  'Activities with their lead''s client_id, so a pulled knock can be filed '
  'against the lead a device already holds. security_invoker.';

-- Readable by signed-in members only. `anon` is revoked explicitly rather than
-- left to the default: these rows carry homeowner names and phone numbers.
revoke all on public.lead_sync_rows from anon;
revoke all on public.activity_sync_rows from anon;
grant select on public.lead_sync_rows to authenticated;
grant select on public.activity_sync_rows to authenticated;

-- =================================================================
-- 20260923_0017_routes_and_assignment.sql
-- =================================================================
-- =============================================================================
-- 0017  Work routes, GPS evidence, and who was given which door
-- =============================================================================
-- Two separate things that happen to arrive together, because both are about
-- accountability and both are easy to build dishonestly.
--
-- ROUTES AND GPS
--
-- A route session is a rep deciding to start work and later deciding to stop.
-- It is NOT a background location service: there is no row here that can exist
-- without someone having pressed start, and `ended_at` closes it. That shape is
-- the privacy design, not an implementation detail â€” a schema that allowed
-- points outside a session would be a schema for tracking employees all day,
-- and no amount of front-end restraint would fix it.
--
-- `route_points` records what the DEVICE reported, including its own accuracy
-- estimate, and nothing is ever written that the device did not report. There
-- is deliberately no interpolation column, no "inferred travel", no snapping to
-- roads: a gap in the points is a gap in the evidence, and the app has to say
-- so rather than drawing a line across it.
--
-- Retention is configurable per organisation and enforced by a function, not a
-- promise. Location history is the most sensitive thing this system will ever
-- hold and it should not accumulate for ever by default.
--
-- ASSIGNMENT
--
-- `lead_score_at_assignment` is NOT NULL and cannot be changed afterwards. Six
-- months from now the only question worth asking about a rep is whether they
-- close better than the doors they were given would predict, and that question
-- is unanswerable if the score is read live: scores are recomputed every run,
-- so a live read would compare today's number against last spring's outcome.
-- Freezing it at the moment of assignment is the whole point of the table.
--
-- Rollback:
--   drop table if exists lead_assignment_history, lead_assignments,
--                        route_points, route_sessions cascade;
--   drop function if exists app.purge_expired_route_points();
--   drop function if exists app.freeze_lead_assignment_facts();
--   alter table organizations drop column if exists route_retention_days;
--   alter table activities drop column if exists gps_verification,
--     drop column if exists gps_distance_m, drop column if exists gps_accuracy_m;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Route sessions
-- ---------------------------------------------------------------------------

create table if not exists route_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Generated on the device before the server sees it, like every other row the
  -- field app writes, so a retried push updates rather than duplicating.
  client_id       uuid not null default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  device_id       text,
  label           text,
  started_at      timestamptz not null,
  -- Null means the rep has not stopped yet. It does not mean "still walking".
  ended_at        timestamptz,
  -- What the rep chose, not what the app decided for them.
  ended_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint route_sessions_org_client_unique unique (organization_id, client_id),
  constraint route_sessions_ends_after_start check (ended_at is null or ended_at >= started_at)
);

create index if not exists route_sessions_org_started_idx
  on route_sessions (organization_id, started_at desc);
create index if not exists route_sessions_user_started_idx
  on route_sessions (user_id, started_at desc);

comment on table route_sessions is
  'One deliberate stretch of door-knocking, opened and closed by the rep. No '
  'location may be recorded outside one of these.';

-- ---------------------------------------------------------------------------
-- Route points
-- ---------------------------------------------------------------------------

create table if not exists route_points (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  route_session_id uuid not null references route_sessions (id) on delete cascade,
  recorded_at      timestamptz not null,
  location         geography(Point, 4326) not null,
  -- The device's own estimate, in metres, carried through untouched. Every
  -- claim this system makes about where somebody was is bounded by this number
  -- and must never be stated more precisely than it allows.
  accuracy_m       real,
  altitude_m       real,
  speed_mps        real,
  heading_deg      real,
  created_at       timestamptz not null default now(),
  constraint route_points_org_client_unique unique (organization_id, client_id),
  constraint route_points_accuracy_sane check (accuracy_m is null or accuracy_m >= 0)
);

create index if not exists route_points_session_time_idx
  on route_points (route_session_id, recorded_at);
create index if not exists route_points_org_time_idx
  on route_points (organization_id, recorded_at);
create index if not exists route_points_gix on route_points using gist (location);

comment on column route_points.accuracy_m is
  'The radius the device itself reported, in metres. No statement about where a '
  'rep was may be made more precisely than this allows.';

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

alter table organizations
  add column if not exists route_retention_days integer not null default 90;

alter table organizations
  drop constraint if exists organizations_route_retention_sane;
alter table organizations
  add constraint organizations_route_retention_sane
  check (route_retention_days between 1 and 3650);

comment on column organizations.route_retention_days is
  'How long raw GPS points are kept. Enforced by app.purge_expired_route_points, '
  'which is expected to run on a schedule.';

create or replace function app.purge_expired_route_points()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  removed integer := 0;
  n integer;
  org record;
begin
  for org in select id, route_retention_days from organizations loop
    delete from route_points
    where organization_id = org.id
      and recorded_at < now() - make_interval(days => org.route_retention_days);
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  return removed;
end $$;

comment on function app.purge_expired_route_points() is
  'Deletes GPS points past their organisation''s retention window. Points only; '
  'the sessions themselves are the record that work happened and are kept.';

revoke all on function app.purge_expired_route_points() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- How good the GPS evidence for a knock was
-- ---------------------------------------------------------------------------
-- Recorded as a named class rather than a boolean, because "was the rep really
-- there" has four honest answers and only one of them is "no evidence either
-- way". A missing fix and a fix that puts them down the street are different
-- facts and must not collapse into the same word.

alter table activities
  add column if not exists gps_verification text,
  add column if not exists gps_distance_m real,
  add column if not exists gps_accuracy_m real;

alter table activities drop constraint if exists activities_gps_verification_known;
alter table activities
  add constraint activities_gps_verification_known
  check (gps_verification is null or gps_verification in
    ('verified', 'probable', 'unverified', 'gps_unavailable'));

comment on column activities.gps_verification is
  'verified: a fix inside the property, within its own accuracy. probable: '
  'close, or accurate enough only to say close. unverified: a fix that does not '
  'place the rep at this door. gps_unavailable: no fix at all, which is not an '
  'accusation - basements, garages and dead phones are ordinary.';

-- ---------------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------------

create table if not exists lead_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  lead_id          uuid not null references leads (id) on delete cascade,
  assigned_to      uuid not null references auth.users (id) on delete cascade,
  assigned_by      uuid references auth.users (id) on delete set null,
  assigned_at      timestamptz not null default now(),
  unassigned_at    timestamptz,
  -- Frozen. See the header: a live score makes rep performance unanswerable.
  lead_score_at_assignment smallint not null,
  score_computed_at timestamptz,
  -- Why this rep got this door, in words a person can argue with.
  reason           text,
  created_at       timestamptz not null default now(),
  constraint lead_assignments_org_client_unique unique (organization_id, client_id),
  constraint lead_assignments_score_range check (lead_score_at_assignment between 0 and 100),
  constraint lead_assignments_ends_after_start
    check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- One live assignment per lead. Two reps sent to the same door is a scheduling
-- bug that should fail loudly here rather than quietly in a driveway.
create unique index if not exists lead_assignments_one_active_per_lead
  on lead_assignments (lead_id) where unassigned_at is null;

create index if not exists lead_assignments_assignee_idx
  on lead_assignments (assigned_to, assigned_at desc);
create index if not exists lead_assignments_org_idx
  on lead_assignments (organization_id, assigned_at desc);

/**
 * The facts that make an assignment worth recording cannot be edited later.
 *
 * Closing one out is an UPDATE of `unassigned_at`, so the table cannot be made
 * append-only outright. Instead every column that a performance question
 * depends on is frozen, and only the closing timestamp may move.
 */
create or replace function app.freeze_lead_assignment_facts()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.lead_id is distinct from old.lead_id
     or new.assigned_to is distinct from old.assigned_to
     or new.assigned_at is distinct from old.assigned_at
     or new.lead_score_at_assignment is distinct from old.lead_score_at_assignment
     or new.organization_id is distinct from old.organization_id
     or new.client_id is distinct from old.client_id then
    raise exception
      'lead_assignments is a record of what was decided: only unassigned_at and reason may change';
  end if;
  return new;
end $$;

drop trigger if exists lead_assignments_freeze on lead_assignments;
create trigger lead_assignments_freeze
  before update on lead_assignments
  for each row execute function app.freeze_lead_assignment_facts();

/**
 * The append-only log.
 *
 * Separate from the table above because that one answers "who has this door
 * now" and gets closed out, while this one answers "what has ever been decided
 * about this door" and is never touched again. Written by a trigger rather than
 * by the client, so a client that forgets cannot create a gap.
 */
create table if not exists lead_assignment_history (
  id               bigserial primary key,
  organization_id  uuid not null references organizations (id) on delete cascade,
  lead_id          uuid not null references leads (id) on delete cascade,
  assignment_id    uuid not null,
  action           text not null check (action in ('assigned', 'unassigned')),
  assigned_to      uuid,
  actor            uuid,
  lead_score_at_assignment smallint not null,
  reason           text,
  occurred_at      timestamptz not null default now()
);

create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_org_idx
  on lead_assignment_history (organization_id, occurred_at desc);

create or replace function app.log_lead_assignment()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'assigned', new.assigned_to,
       new.assigned_by, new.lead_score_at_assignment, new.reason, new.assigned_at);
  elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'unassigned', new.assigned_to,
       auth.uid(), new.lead_score_at_assignment, new.reason, new.unassigned_at);
  end if;
  return new;
end $$;

drop trigger if exists lead_assignments_log on lead_assignments;
create trigger lead_assignments_log
  after insert or update on lead_assignments
  for each row execute function app.log_lead_assignment();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table route_sessions enable row level security;
alter table route_points enable row level security;
alter table lead_assignments enable row level security;
alter table lead_assignment_history enable row level security;

-- A rep writes their OWN route and nobody else's. Managers and admins read the
-- organisation's; a salesperson reading a colleague's movements is not a
-- feature anyone asked for.
drop policy if exists route_sessions_own_write on route_sessions;
create policy route_sessions_own_write on route_sessions
  for all
  using (user_id = auth.uid() and organization_id in (select app.current_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select app.current_org_ids()));

drop policy if exists route_sessions_manager_read on route_sessions;
create policy route_sessions_manager_read on route_sessions
  for select
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists route_points_own_write on route_points;
create policy route_points_own_write on route_points
  for all
  using (exists (
    select 1 from route_sessions s
    where s.id = route_points.route_session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from route_sessions s
    where s.id = route_points.route_session_id
      and s.user_id = auth.uid()
      and s.organization_id = route_points.organization_id
  ));

drop policy if exists route_points_manager_read on route_points;
create policy route_points_manager_read on route_points
  for select
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- Everyone in the organisation sees who has which door; only a manager or admin
-- decides it. Server-enforced, because hiding the button is not a permission.
drop policy if exists lead_assignments_read on lead_assignments;
create policy lead_assignments_read on lead_assignments
  for select using (organization_id in (select app.current_org_ids()));

drop policy if exists lead_assignments_manager_write on lead_assignments;
create policy lead_assignments_manager_write on lead_assignments
  for insert
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists lead_assignments_manager_close on lead_assignments;
create policy lead_assignments_manager_close on lead_assignments
  for update
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- The log is readable by the organisation and writable by nobody: it has no
-- INSERT, UPDATE or DELETE policy at all, so only the trigger can add to it.
drop policy if exists lead_assignment_history_read on lead_assignment_history;
create policy lead_assignment_history_read on lead_assignment_history
  for select using (organization_id in (select app.current_org_ids()));

drop trigger if exists route_sessions_touch on route_sessions;
create trigger route_sessions_touch
  before update on route_sessions
  for each row execute function app.touch_updated_at();

-- =================================================================
-- 20260924_0018_manager_read_views.sql
-- =================================================================
-- =============================================================================
-- 0018  Read views for the manager screens
-- =============================================================================
-- Five views and one column. No new policies: every view is security_invoker,
-- so the RLS already on route_sessions, leads and lead_assignments decides who
-- sees what. A salesperson reading these gets their own rows; a manager gets the
-- organisation's. That is the permission, enforced by the server, and the front
-- end hiding a tab is not a second one.
--
-- `subdivision` moves onto properties because territory coverage is the one
-- manager question that cannot be answered without it, and until now the
-- neighbourhood name existed only on the device that built the door list.
--
-- Rollback:
--   drop view if exists org_directory, manager_assignment_log,
--     manager_assignment_rows, manager_route_rows, manager_activity_rows;
--   alter table properties drop column if exists subdivision;
-- =============================================================================

alter table properties add column if not exists subdivision text;

comment on column properties.subdivision is
  'Neighbourhood as the parish parcel record names it. Carried from the device '
  'that built the door list; the server has no other source for it.';

create index if not exists properties_subdivision_idx
  on properties (organization_id, subdivision) where subdivision is not null;

create or replace view manager_activity_rows with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  a.user_id,
  a.activity_type,
  a.outcome,
  a.gps_verification,
  a.gps_distance_m,
  a.gps_accuracy_m,
  a.occurred_at,
  l.client_id        as lead_client_id,
  l.status::text     as lead_status,
  l.opportunity_score,
  p.address_line1,
  p.subdivision,
  p.postal_code
from activities a
join leads l on l.id = a.lead_id
join properties p on p.id = l.property_id
where l.deleted_at is null;

comment on view manager_activity_rows is
  'Every recorded contact with the lead and property it happened at, including '
  'the GPS verdict as it was judged at the time. security_invoker.';

create or replace view manager_route_rows with (security_invoker = true) as
select
  s.id,
  s.organization_id,
  s.user_id,
  s.label,
  s.device_id,
  s.started_at,
  s.ended_at,
  s.ended_reason,
  (select count(*) from route_points rp where rp.route_session_id = s.id) as point_count,
  (select min(rp.recorded_at) from route_points rp where rp.route_session_id = s.id) as first_fix_at,
  last_point.recorded_at as last_fix_at,
  last_point.latitude,
  last_point.longitude,
  last_point.accuracy_m
from route_sessions s
left join lateral (
  select
    st_y(rp.location::geometry) as latitude,
    st_x(rp.location::geometry) as longitude,
    rp.accuracy_m,
    rp.recorded_at
  from route_points rp
  where rp.route_session_id = s.id
  order by rp.recorded_at desc
  limit 1
) last_point on true;

comment on view manager_route_rows is
  'One row per work route, with its most recent fix only. Deliberately not the '
  'full trail: a live view needs to know where somebody is now, and handing out '
  'every point of everyone''s day for a status screen is not the same question.';

create or replace view manager_assignment_rows with (security_invoker = true) as
select
  la.id,
  la.organization_id,
  la.lead_id,
  l.client_id     as lead_client_id,
  la.assigned_to,
  la.assigned_by,
  la.assigned_at,
  la.unassigned_at,
  la.lead_score_at_assignment,
  la.reason,
  l.status::text  as lead_status,
  l.last_activity_at,
  p.address_line1,
  p.subdivision
from lead_assignments la
join leads l on l.id = la.lead_id
join properties p on p.id = l.property_id;

comment on view manager_assignment_rows is
  'Assignments with the score frozen at the moment each was made. That frozen '
  'number is what makes rep performance answerable at all.';

create or replace view manager_assignment_log with (security_invoker = true) as
select
  h.id,
  h.organization_id,
  h.lead_id,
  h.assignment_id,
  h.action,
  h.assigned_to,
  h.actor,
  h.lead_score_at_assignment,
  h.reason,
  h.occurred_at,
  p.address_line1,
  p.subdivision
from lead_assignment_history h
join leads l on l.id = h.lead_id
join properties p on p.id = l.property_id;

comment on view manager_assignment_log is
  'The append-only record of every assignment decision. Written by trigger, '
  'readable by the organisation, writable by nobody.';

create or replace view org_directory with (security_invoker = true) as
select
  m.organization_id,
  m.user_id,
  m.role::text as role,
  m.is_active,
  pr.full_name
from organization_members m
left join profiles pr on pr.id = m.user_id;

comment on view org_directory is
  'Who is on the team, for putting names on the manager screens.';

revoke all on manager_activity_rows, manager_route_rows, manager_assignment_rows,
              manager_assignment_log, org_directory from anon;
grant select on manager_activity_rows, manager_route_rows, manager_assignment_rows,
                manager_assignment_log, org_directory to authenticated;

-- =================================================================
-- 20260924_0019_schedule_route_purge.sql
-- =================================================================
-- =============================================================================
-- 0019  Actually run the retention policy
-- =============================================================================
-- `app.purge_expired_route_points()` has existed since 0017 and nothing called
-- it. A retention promise that nothing calls is not a retention policy; it is a
-- comment. Location history is the most sensitive thing this system holds, and
-- it was accumulating for ever behind a function nobody ran.
--
-- 04:17 UTC rather than on the hour: cron jobs that all fire at :00 contend
-- with everything else scheduled by habit, and nothing here is time-critical.
--
-- Verified against the live database inside a rolled-back transaction â€” with
-- the default 90 day window, a 200-day-old point was removed, a 2-day-old point
-- was kept, and the session itself was kept.
--
-- Rollback:
--   select cron.unschedule('purge-expired-route-points');
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-route-points',
  '17 4 * * *',
  $$select app.purge_expired_route_points();$$
);

comment on function app.purge_expired_route_points() is
  'Deletes GPS points past their organisation''s retention window. Points only; '
  'the sessions themselves are the record that work happened and are kept. '
  'Scheduled nightly at 04:17 UTC by the pg_cron job purge-expired-route-points '
  '- a retention promise nothing calls is not a retention policy.';

-- =================================================================
-- 20260924_0020_sync_views_carry_everything.sql
-- =================================================================
-- =============================================================================
-- 0020  The pull views learn about columns added after they were written
-- =============================================================================
-- Found by rehearsing the round trip against the live database rather than by
-- anything failing. Both views were written in 0016; `properties.subdivision`
-- arrived in 0018 and the GPS verdict columns in 0017, and neither view was
-- revisited.
--
-- The cost of that was silent, which is what makes it worth a migration of its
-- own rather than a footnote. A device that PULLED a lead â€” a second rep, a
-- manager, a replacement phone â€” got a door with no neighbourhood, so it was
-- invisible to territory coverage; and a knock with no verification class, so
-- the evidence the capturing phone collected read on screen as though none had
-- ever been gathered. Nothing errored. The information was simply dropped on
-- the way down.
--
-- Recreated rather than replaced because a column cannot be inserted into the
-- middle of a view's column list.
--
-- Rollback: recreate both from 0016.
-- =============================================================================

drop view if exists public.lead_sync_rows;

create view public.lead_sync_rows
with (security_invoker = true) as
select
  l.id                as remote_id,
  l.client_id,
  l.organization_id,
  l.status::text      as status,
  l.opportunity_score,
  l.assigned_to,
  l.next_action_at,
  l.next_action_note,
  l.first_contacted_at,
  l.last_activity_at,
  l.created_at,
  l.updated_at,
  p.address_line1,
  p.city,
  p.postal_code,
  p.subdivision,
  st_y(p.location::geometry) as latitude,
  st_x(p.location::geometry) as longitude,
  c.first_name        as contact_name,
  c.primary_phone     as contact_phone
from leads l
join properties p on p.id = l.property_id
left join customers c on c.id = l.customer_id
where l.deleted_at is null;

comment on view public.lead_sync_rows is
  'Leads flattened with their property and customer for the field app''s pull '
  'path. security_invoker, so row-level security on the underlying tables '
  'applies to the caller exactly as it would on a direct select. Carries '
  'subdivision: without it a device that pulls a lead rather than generating it '
  'has no neighbourhood for that door, and its territory coverage silently '
  'reads as unknown.';

drop view if exists public.activity_sync_rows;

create view public.activity_sync_rows
with (security_invoker = true) as
select
  a.id              as remote_id,
  a.client_id,
  a.organization_id,
  a.lead_id,
  l.client_id       as lead_client_id,
  a.user_id,
  a.activity_type,
  a.outcome,
  a.body,
  a.occurred_at,
  a.gps_verification,
  a.gps_distance_m,
  a.gps_accuracy_m
from activities a
join leads l on l.id = a.lead_id
where l.deleted_at is null;

comment on view public.activity_sync_rows is
  'Activities with their lead''s client_id, so a pulled knock can be filed '
  'against the lead a device already holds. security_invoker. Carries the GPS '
  'verdict as it was judged at the time: a knock pulled onto a second device '
  'without it shows no evidence at all, which reads as though none was ever '
  'collected.';

revoke all on public.lead_sync_rows, public.activity_sync_rows from anon;
grant select on public.lead_sync_rows, public.activity_sync_rows to authenticated;

-- =================================================================
-- 20260924_0021_route_pauses_and_detail.sql
-- =================================================================
-- =============================================================================
-- 0021  Breaks a rep took, and the full trail a manager can replay
-- =============================================================================
-- Two additions, both about not making things up.
--
-- PAUSES
--
-- A break is something the rep DECLARED. It is stored as they gave it and is
-- never inferred: the app already knows that a gap in the trail could be lunch,
-- a basement, a dead battery or a drive through a cutting, and it has no way to
-- tell those apart. Recording a gap as a break would put a number on somebody's
-- timesheet that nobody's phone supports. Paused time is therefore reported
-- separately from tracked time and from gaps, and the three are never added
-- together into one confident figure.
--
-- Stored as jsonb rather than a child table because a pause has no identity of
-- its own, is only ever read with its session, and is written by the same
-- idempotent upsert that writes the session. A child table would need its own
-- client_id, its own conflict target and its own place in the push order, for a
-- list that is usually empty and never longer than a handful.
--
-- ROUTE DETAIL
--
-- `manager_route_rows` deliberately carries only the LAST fix, because a live
-- status board should not hand out everyone's whole day. Replay is a different
-- question with a different answer, so it gets its own view, read one route at
-- a time. Same RLS either way: security_invoker, so a rep sees their own routes
-- and a manager sees the organisation's.
--
-- Rollback:
--   drop view if exists route_point_rows;
--   alter table route_sessions drop column if exists pauses;
-- Nothing below alters or drops existing data.
-- =============================================================================

alter table route_sessions
  add column if not exists pauses jsonb not null default '[]'::jsonb;

alter table route_sessions drop constraint if exists route_sessions_pauses_is_array;
alter table route_sessions
  add constraint route_sessions_pauses_is_array
  check (jsonb_typeof(pauses) = 'array');

comment on column route_sessions.pauses is
  'Breaks the rep declared, as [{at, until}]. Never inferred from the GPS: a '
  'gap in the trail is evidence of nothing and must not become paid or unpaid '
  'time on somebody''s record.';

-- ---------------------------------------------------------------------------
-- The full trail, for replaying one route
-- ---------------------------------------------------------------------------

create or replace view route_point_rows with (security_invoker = true) as
select
  rp.id,
  rp.organization_id,
  rp.route_session_id,
  rp.recorded_at,
  st_y(rp.location::geometry) as latitude,
  st_x(rp.location::geometry) as longitude,
  rp.accuracy_m,
  rp.altitude_m,
  rp.speed_mps,
  rp.heading_deg
from route_points rp;

comment on view route_point_rows is
  'Every fix of one route, for playback. Read one session at a time on purpose; '
  'the live board uses manager_route_rows, which carries only the last fix.';

revoke all on route_point_rows from anon;
grant select on route_point_rows to authenticated;

-- =================================================================
-- 20260924_0022_grading.sql
-- =================================================================
-- =============================================================================
-- 0022  Rep grading: the computed grade and the manager's, side by side
-- =============================================================================
-- The shape of this schema is the argument.
--
-- TWO GRADES, NEVER ONE
--
-- `ai_*` and `manager_*` are separate columns and neither is ever written over
-- the other. Accepting a suggested grade does not collapse it into the
-- manager's; it records that the manager agreed. That distinction is the only
-- thing that makes the question worth asking a year from now â€” "does the rubric
-- actually match what our managers think" â€” answerable at all. A single
-- `grade` column with a `source` flag loses it the first time somebody clicks
-- accept.
--
-- THE COMPUTED GRADE IS FROZEN
--
-- Weights change. Sample floors change. The rubric will be rewritten. A grade
-- recorded in September must keep saying what it said in September, so the
-- whole computation â€” score, confidence, every category, the weights and the
-- scale that produced it, and the engine's version string â€” is stored as the
-- jsonb it was, and a trigger refuses to let any of it be edited afterwards.
-- Re-grading a period writes a new row; it does not revise the old one.
--
-- WHAT A REP CAN SEE
--
-- Their own grade, once a manager has entered one. Not the draft suggestion:
-- a rep reading "C-, low confidence" that their manager had not yet looked at
-- is a conversation nobody chose to have, caused by a dashboard. Managers and
-- admins see the organisation's.
--
-- Rollback:
--   drop table if exists rep_grade_events, rep_grades cascade;
--   drop table if exists grading_configs cascade;
--   drop function if exists app.freeze_computed_grade();
--   drop function if exists app.log_rep_grade();
--   drop view if exists manager_lead_followups;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table if not exists grading_configs (
  organization_id uuid primary key references organizations (id) on delete cascade,
  -- manual | assisted | automatic. Assisted is the recommended default: the
  -- rubric reads four thousand activity rows without getting bored, and the
  -- manager still decides.
  mode            text not null default 'assisted',
  -- Never hard-coded in the app. A weighting is a statement about what this
  -- business values and belongs to the business.
  weights         jsonb not null,
  scale           jsonb not null,
  floors          jsonb not null default '{}'::jsonb,
  min_confidence  real not null default 0.6,
  manager_approval_required boolean not null default true,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint grading_configs_mode_known check (mode in ('manual', 'assisted', 'automatic')),
  constraint grading_configs_confidence_range check (min_confidence between 0 and 1),
  constraint grading_configs_weights_object check (jsonb_typeof(weights) = 'object'),
  constraint grading_configs_scale_array check (jsonb_typeof(scale) = 'array')
);

comment on table grading_configs is
  'How this organisation grades. One row per organisation; the app falls back '
  'to its published defaults when there is none.';

-- ---------------------------------------------------------------------------
-- The grades
-- ---------------------------------------------------------------------------

create table if not exists rep_grades (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  rep_id           uuid not null references auth.users (id) on delete cascade,
  period           text not null,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  -- The mode in force when this was produced, stored rather than looked up:
  -- the setting changes and this row must keep describing what happened.
  mode             text not null,

  -- The computation, exactly as it was. Frozen by trigger below.
  engine           text,
  ai_score         real,
  ai_letter        text,
  ai_confidence    real,
  ai_detail        jsonb,
  computed_at      timestamptz,

  -- The manager's. Separate, and always allowed to differ.
  manager_letter   text,
  manager_comment  text,
  manager_override_reason text,
  manager_category_scores jsonb,
  graded_by        uuid references auth.users (id) on delete set null,
  graded_at        timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint rep_grades_org_client_unique unique (organization_id, client_id),
  constraint rep_grades_period_known check (period in ('daily', 'weekly', 'monthly', 'quarterly')),
  constraint rep_grades_mode_known check (mode in ('manual', 'assisted', 'automatic')),
  constraint rep_grades_window_ordered check (period_end > period_start),
  constraint rep_grades_confidence_range
    check (ai_confidence is null or ai_confidence between 0 and 1),
  -- A manager grade without a person attached is unattributable, and an
  -- unattributable grade about somebody's work is worse than none.
  constraint rep_grades_manager_grade_attributed
    check (manager_letter is null or (graded_by is not null and graded_at is not null))
);

-- One live row per rep per period. Re-grading replaces it through the same
-- idempotent upsert everything else in this system uses.
create unique index if not exists rep_grades_one_per_period
  on rep_grades (organization_id, rep_id, period, period_start);

create index if not exists rep_grades_rep_idx on rep_grades (rep_id, period_start desc);
create index if not exists rep_grades_org_idx on rep_grades (organization_id, period_start desc);

comment on column rep_grades.ai_detail is
  'The whole computation as it ran: every category, the weights, the scale, the '
  'sample sizes and the confidence terms. Frozen, because the rubric will change '
  'and a grade from September must keep saying what it said in September.';

comment on column rep_grades.manager_letter is
  'The manager''s grade. Never written over the computed one, and never derived '
  'from it: a row with both is a manager who agreed, which is a different fact '
  'from a rubric that ran.';

-- ---------------------------------------------------------------------------
-- The computed grade cannot be edited
-- ---------------------------------------------------------------------------

create or replace function app.freeze_computed_grade()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.ai_detail is not null and (
       new.engine        is distinct from old.engine
    or new.ai_score      is distinct from old.ai_score
    or new.ai_letter     is distinct from old.ai_letter
    or new.ai_confidence is distinct from old.ai_confidence
    or new.ai_detail     is distinct from old.ai_detail
    or new.computed_at   is distinct from old.computed_at
    or new.period_start  is distinct from old.period_start
    or new.period_end    is distinct from old.period_end
    or new.rep_id        is distinct from old.rep_id
  ) then
    raise exception
      'a computed grade is a record of what the rubric said at the time: re-grade into a new period row instead of editing this one';
  end if;
  return new;
end $$;

drop trigger if exists rep_grades_freeze on rep_grades;
create trigger rep_grades_freeze
  before update on rep_grades
  for each row execute function app.freeze_computed_grade();

drop trigger if exists rep_grades_touch on rep_grades;
create trigger rep_grades_touch
  before update on rep_grades
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Every change, kept
-- ---------------------------------------------------------------------------

create table if not exists rep_grade_events (
  id              bigserial primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  grade_id        uuid not null,
  rep_id          uuid not null,
  action          text not null check (action in ('computed', 'graded', 'regraded', 'cleared')),
  actor           uuid,
  ai_letter       text,
  manager_letter  text,
  reason          text,
  occurred_at     timestamptz not null default now()
);

create index if not exists rep_grade_events_rep_idx
  on rep_grade_events (rep_id, occurred_at desc);
create index if not exists rep_grade_events_org_idx
  on rep_grade_events (organization_id, occurred_at desc);

comment on table rep_grade_events is
  'Who graded whom, when, and what changed. Written by trigger so a client that '
  'forgets cannot create a gap; readable by managers, writable by nobody.';

create or replace function app.log_rep_grade()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  what text;
begin
  if tg_op = 'INSERT' then
    what := case when new.manager_letter is not null then 'graded' else 'computed' end;
  elsif new.manager_letter is distinct from old.manager_letter then
    what := case
              when new.manager_letter is null then 'cleared'
              when old.manager_letter is null then 'graded'
              else 'regraded'
            end;
  else
    return new;
  end if;

  insert into rep_grade_events
    (organization_id, grade_id, rep_id, action, actor, ai_letter, manager_letter, reason)
  values
    (new.organization_id, new.id, new.rep_id, what,
     coalesce(new.graded_by, auth.uid()), new.ai_letter, new.manager_letter,
     new.manager_override_reason);
  return new;
end $$;

drop trigger if exists rep_grades_log on rep_grades;
create trigger rep_grades_log
  after insert or update on rep_grades
  for each row execute function app.log_rep_grade();

-- ---------------------------------------------------------------------------
-- Follow-up, which the performance engine needs and could not see
-- ---------------------------------------------------------------------------

create or replace view manager_lead_followups with (security_invoker = true) as
select
  l.id,
  l.organization_id,
  l.client_id       as lead_client_id,
  l.status::text    as lead_status,
  l.next_action_at,
  l.last_activity_at,
  l.opportunity_score,
  p.subdivision,
  p.address_line1
from leads l
join properties p on p.id = l.property_id
where l.deleted_at is null;

comment on view manager_lead_followups is
  'What each lead is waiting on. next_action_at is a date the REP set for '
  'themselves; a follow-up counted as done here means something was recorded '
  'after it came due, not that the conversation went well.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table grading_configs enable row level security;
alter table rep_grades enable row level security;
alter table rep_grade_events enable row level security;

drop policy if exists grading_configs_read on grading_configs;
create policy grading_configs_read on grading_configs
  for select using (organization_id in (select app.current_org_ids()));

-- How people are graded is a management decision, enforced here and not by
-- hiding a settings tab.
drop policy if exists grading_configs_manager_write on grading_configs;
create policy grading_configs_manager_write on grading_configs
  for all
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- A rep sees their own grade once a manager has entered one. Not the draft
-- suggestion: reading an unreviewed "C-" about yourself is a conversation
-- nobody chose to have.
drop policy if exists rep_grades_own_final_read on rep_grades;
create policy rep_grades_own_final_read on rep_grades
  for select
  using (
    rep_id = auth.uid()
    and manager_letter is not null
    and organization_id in (select app.current_org_ids())
  );

drop policy if exists rep_grades_manager_read on rep_grades;
create policy rep_grades_manager_read on rep_grades
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grades_manager_write on rep_grades;
create policy rep_grades_manager_write on rep_grades
  for insert with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grades_manager_update on rep_grades;
create policy rep_grades_manager_update on rep_grades
  for update
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- The log has no write policy at all, so only the trigger can add to it.
drop policy if exists rep_grade_events_manager_read on rep_grade_events;
create policy rep_grade_events_manager_read on rep_grade_events
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grade_events_own_read on rep_grade_events;
create policy rep_grade_events_own_read on rep_grade_events
  for select using (rep_id = auth.uid() and organization_id in (select app.current_org_ids()));

revoke all on manager_lead_followups from anon;
grant select on manager_lead_followups to authenticated;

-- =================================================================
-- 20260924_0023_route_rows_carry_pauses.sql
-- =================================================================
-- =============================================================================
-- 0023  The manager's route list learns about breaks
-- =============================================================================
-- `manager_route_rows` was written before route_sessions had a `pauses` column,
-- so a break the rep declared reached the server, sat in the table, and was
-- invisible to the only screen that needed it. The route then read to a manager
-- as unbroken work â€” the exact reading pausing exists to prevent.
--
-- Same shape of mistake as 0020: a view written against the columns that existed
-- that afternoon, and a column added later that nothing thought to add to it.
-- Worth naming as a pattern rather than fixing quietly.
--
-- `create or replace` is enough here because the column is appended at the end;
-- inserting one mid-list needs a drop and recreate.
--
-- Rollback: re-run 0018's definition of manager_route_rows.
-- =============================================================================

create or replace view manager_route_rows with (security_invoker = true) as
select
  s.id,
  s.organization_id,
  s.user_id,
  s.label,
  s.device_id,
  s.started_at,
  s.ended_at,
  s.ended_reason,
  (select count(*) from route_points rp where rp.route_session_id = s.id) as point_count,
  (select min(rp.recorded_at) from route_points rp where rp.route_session_id = s.id) as first_fix_at,
  last_point.recorded_at as last_fix_at,
  last_point.latitude,
  last_point.longitude,
  last_point.accuracy_m,
  -- Breaks the rep declared. Never inferred from a gap in the trail.
  s.pauses
from route_sessions s
left join lateral (
  select
    st_y(rp.location::geometry) as latitude,
    st_x(rp.location::geometry) as longitude,
    rp.accuracy_m,
    rp.recorded_at
  from route_points rp
  where rp.route_session_id = s.id
  order by rp.recorded_at desc
  limit 1
) last_point on true;

comment on view manager_route_rows is
  'One row per work route, with its most recent fix only, and the breaks the '
  'rep declared. Deliberately not the full trail: a live view needs to know '
  'where somebody is now, and handing out every point of everyone''s day for a '
  'status screen is not the same question.';

-- =================================================================
-- 20260924_0024_audit_triggers_can_write.sql
-- =================================================================
-- =============================================================================
-- 0024  The append-only logs could not actually be written to
-- =============================================================================
-- Found by using the app: saving a manager's grade returned 403.
--
-- `rep_grade_events` and `lead_assignment_history` are deliberately writable by
-- nobody â€” they have RLS enabled and no INSERT policy at all, so the only thing
-- that may add to them is the trigger. That was the right design and it was
-- half-implemented: the trigger functions were SECURITY INVOKER, so they ran as
-- the signed-in user and were refused by the very policy gap that was supposed
-- to protect them. The log was unwritable by everyone, including its own
-- trigger, which then failed the whole insert it was attached to.
--
-- The consequence is worth stating plainly: a manager could not record a grade,
-- and â€” latent since 0017 â€” assigning a lead would have failed the same way the
-- first time anybody tried it from the UI.
--
-- SECURITY DEFINER is the fix and is safe here for specific reasons:
--   - Neither function takes input. It writes only what the trigger row already
--     contains, so there is no argument to smuggle anything through.
--   - search_path is pinned, so no schema can be shadowed to redirect a write.
--   - Both are trigger functions. A trigger function cannot be called directly
--     over the API, so elevating it does not widen the surface a client can
--     reach.
--   - The tables stay unwritable by clients: no INSERT policy is added.
--
-- Rollback: recreate both functions without `security definer`. Doing so
-- restores the bug, so it is a rollback of last resort.
-- =============================================================================

create or replace function app.log_rep_grade()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  what text;
begin
  if tg_op = 'INSERT' then
    what := case when new.manager_letter is not null then 'graded' else 'computed' end;
  elsif new.manager_letter is distinct from old.manager_letter then
    what := case
              when new.manager_letter is null then 'cleared'
              when old.manager_letter is null then 'graded'
              else 'regraded'
            end;
  else
    return new;
  end if;

  insert into rep_grade_events
    (organization_id, grade_id, rep_id, action, actor, ai_letter, manager_letter, reason)
  values
    (new.organization_id, new.id, new.rep_id, what,
     coalesce(new.graded_by, auth.uid()), new.ai_letter, new.manager_letter,
     new.manager_override_reason);
  return new;
end $$;

create or replace function app.log_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'assigned', new.assigned_to,
       new.assigned_by, new.lead_score_at_assignment, new.reason, new.assigned_at);
  elsif tg_op = 'UPDATE' and old.unassigned_at is null and new.unassigned_at is not null then
    insert into lead_assignment_history
      (organization_id, lead_id, assignment_id, action, assigned_to, actor,
       lead_score_at_assignment, reason, occurred_at)
    values
      (new.organization_id, new.lead_id, new.id, 'unassigned', new.assigned_to,
       auth.uid(), new.lead_score_at_assignment, new.reason, new.unassigned_at);
  end if;
  return new;
end $$;

-- Neither is callable over the API; revoking anyway so the intent is explicit.
revoke all on function app.log_rep_grade() from public, anon, authenticated;
revoke all on function app.log_lead_assignment() from public, anon, authenticated;

comment on function app.log_rep_grade() is
  'Writes the grading audit row. SECURITY DEFINER because the log has no INSERT '
  'policy by design â€” the trigger is meant to be its only writer, and as an '
  'invoker function it was refused by that same gap.';

comment on function app.log_lead_assignment() is
  'Writes the assignment audit row. SECURITY DEFINER for the same reason as '
  'app.log_rep_grade.';

-- =================================================================
-- 20260924_0025_contact_provenance.sql
-- =================================================================
-- =============================================================================
-- 0025  Where a phone number came from
-- =============================================================================
-- `customers.primary_phone` recorded a number and nothing about how it got
-- there. A number the homeowner said out loud at their door and a number off a
-- people-search service were the same row, and that distinction is the entire
-- question if a call is ever challenged: "we had their number" is not an
-- answer, and "she gave it to me at the door on the twelfth" is.
--
-- This is not a quality score. A looked-up number may well be correct. It is a
-- statement about whether this person handed it over, which is a different fact
-- and the one that decides whether the app will let anybody dial it.
--
-- NOT NULL is deliberately avoided: existing rows predate the question and
-- guessing an answer for them would be the exact failure this column exists to
-- prevent. The client reads a null as `homeowner_at_door` for rows it wrote
-- itself â€” the door sheet was the only code path that could set a number â€” and
-- says so in the open.
--
-- Rollback:
--   alter table customers drop column if exists phone_source;
-- Nothing below alters or drops existing data.
-- =============================================================================

alter table customers
  add column if not exists phone_source text;

alter table customers drop constraint if exists customers_phone_source_known;
alter table customers
  add constraint customers_phone_source_known
  check (
    phone_source is null
    or phone_source in (
      'homeowner_at_door',
      'homeowner_by_phone',
      'homeowner_in_writing',
      'public_record',
      'third_party_lookup',
      'unknown'
    )
  );

comment on column customers.phone_source is
  'How this number was obtained. Only the three homeowner_* values are the '
  'person handing over their own number; everything else is somebody else '
  'telling us about them, however accurate. Null means the row predates the '
  'column, not that the source was trustworthy.';

create index if not exists customers_phone_source_idx
  on customers (organization_id, phone_source) where phone_source is not null;

-- =================================================================
-- 20260924_0026_roofr_integration.sql
-- =================================================================
-- =============================================================================
-- 0026  Roofr, through Zapier
-- =============================================================================
-- Delta Ridge stays the source of truth for everything it generates â€” storm
-- opportunities, property intelligence, routes, knocks, notes, scoring â€” and
-- Roofr stays the system of record for its own job, report and proposal
-- workflow. Neither overwrites the other's half.
--
-- WHAT THE INTEGRATION CAN ACTUALLY DO, verified 2026-09-24
--
-- Zapier exposes eight Roofr TRIGGERS (lead created, report ordered, proposal
-- sent / viewed / signed / lost / total adjusted, workflow stage changed) and
-- exactly one ACTION: Create Job and Customer. There is no search, no read, and
-- no update. That shapes this schema:
--
--   - Inbound is the reliable half, and it is append-only. Roofr tells us what
--     happened; we record it and never argue with it.
--   - Outbound can only ever CREATE. There is no way to update a Roofr job, so
--     a job is created once and after that Roofr owns it.
--   - There is no historical import. Nothing here pretends otherwise; the link
--     table starts empty and fills from the day the Zaps are switched on.
--
-- Roofr's own help page still describes the integration as one-way, Roofr to
-- elsewhere, while Zapier's directory lists the create action. The outbound
-- half is therefore built but gated: `roofr_settings.push_enabled` is false
-- until a real Zap has been seen to work, and nothing in the app turns it on
-- by itself.
--
-- Rollback:
--   drop table if exists roofr_outbox, roofr_events, roofr_links cascade;
--   drop table if exists roofr_settings cascade;
--   drop view if exists roofr_sync_log;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists roofr_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,

  -- Off until somebody proves the create action works on this account. An
  -- integration that silently starts writing to a live CRM the moment a
  -- migration lands is not a feature.
  push_enabled    boolean not null default false,
  -- Whether a qualifying lead goes automatically or waits for a manager tap.
  push_automatic  boolean not null default false,
  /*
   * When a Delta Ridge lead is considered worth a Roofr job.
   *
   * The default is deliberately late. Delta Ridge generates 150 doors a run;
   * pushing every raw storm lead would fill Roofr with canvassing records and
   * make it useless for the thing it is good at. A door becomes a Roofr job
   * when somebody has actually agreed to something.
   */
  push_threshold  text not null default 'inspection_scheduled',

  /*
   * Delta Ridge status -> Roofr workflow stage, as {"our_status": "their stage"}.
   *
   * Empty by default and it must stay that way until somebody has read the
   * stage names out of this company's own Roofr. Roofr workflow stages are
   * configurable per account, so a shipped default would be a guess about
   * somebody else's pipeline.
   */
  stage_map       jsonb not null default '{}'::jsonb,

  connected_at      timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  updated_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint roofr_settings_threshold_known check (push_threshold in (
    'manual_only',
    'lead_created',
    'contacted',
    'interested',
    'inspection_scheduled',
    'manager_approved'
  )),
  constraint roofr_settings_stage_map_object check (jsonb_typeof(stage_map) = 'object')
);

comment on table roofr_settings is
  'How this organisation talks to Roofr. push_enabled is false until the create '
  'action has been proven on this account; nothing in the app turns it on.';

-- ---------------------------------------------------------------------------
-- The link between one lead and one Roofr job
-- ---------------------------------------------------------------------------

create table if not exists roofr_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid not null references leads (id) on delete cascade,

  -- Roofr's own ids, as they come back. Null until Roofr has created the job.
  roofr_customer_id text,
  roofr_job_id      text,
  /*
   * The ids WE sent, which Roofr stores as external ids.
   *
   * These are the deduplication key and the reason a retry cannot create a
   * second job: the same lead always sends the same external id, so a repeated
   * create is recognisable as a repeat. Matching on a homeowner's name would
   * merge two Smiths on the same street, which is how a CRM quietly loses a job.
   */
  external_customer_id text,
  external_job_id      text,

  -- Roofr's half of the record. Roofr wins on every column below; the app
  -- never writes them from its own state.
  workflow_stage      text,
  report_ordered_at   timestamptz,
  proposal_sent_at    timestamptz,
  proposal_viewed_at  timestamptz,
  proposal_signed_at  timestamptz,
  proposal_lost_at    timestamptz,
  proposal_total_cents bigint,

  -- Who worked it here. Kept so entering Roofr cannot cost a rep their
  -- attribution, which is what rep grading is computed from.
  originating_rep_id uuid references auth.users (id) on delete set null,

  last_event_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint roofr_links_one_per_lead unique (lead_id),
  constraint roofr_links_total_sane check (proposal_total_cents is null or proposal_total_cents >= 0)
);

create unique index if not exists roofr_links_job_unique
  on roofr_links (organization_id, roofr_job_id) where roofr_job_id is not null;
create unique index if not exists roofr_links_external_job_unique
  on roofr_links (organization_id, external_job_id) where external_job_id is not null;
create index if not exists roofr_links_org_idx on roofr_links (organization_id, updated_at desc);

comment on column roofr_links.external_job_id is
  'The id WE sent. Roofr stores it as the job''s external id, which makes a '
  'repeated create recognisable as a repeat rather than a second job.';

-- ---------------------------------------------------------------------------
-- Every event Roofr sent, kept
-- ---------------------------------------------------------------------------

create table if not exists roofr_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  /*
   * The id that makes a redelivery harmless.
   *
   * Zapier retries, and a Zap can be replayed by hand. Without a stable id per
   * event the same signed proposal becomes three timeline entries and the
   * manager dashboard counts it three times.
   */
  provider_event_id text not null,
  event_type        text not null,
  occurred_at       timestamptz,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,

  status            text not null default 'received',
  lead_id           uuid references leads (id) on delete set null,
  roofr_customer_id text,
  roofr_job_id      text,

  -- The payload is NOT stored. It carries homeowner PII through a third party
  -- and nothing downstream reads it; a hash is enough to spot a replay with
  -- changed contents.
  payload_hash      text,
  error             text,

  constraint roofr_events_unique_per_org unique (organization_id, provider_event_id),
  constraint roofr_events_status_known check (status in ('received', 'processed', 'ignored', 'failed')),
  constraint roofr_events_type_known check (event_type in (
    'lead_created',
    'report_ordered',
    'proposal_sent',
    'proposal_viewed',
    'proposal_signed',
    'proposal_lost',
    'proposal_total_adjusted',
    'workflow_stage_changed',
    'job_created'
  ))
);

create index if not exists roofr_events_org_time_idx
  on roofr_events (organization_id, received_at desc);
create index if not exists roofr_events_lead_idx
  on roofr_events (lead_id, received_at desc) where lead_id is not null;

comment on table roofr_events is
  'Append-only record of what Roofr said and when. The payload itself is not '
  'kept: it carries homeowner PII through a third party and nothing reads it '
  'after processing.';

-- ---------------------------------------------------------------------------
-- Outbound queue
-- ---------------------------------------------------------------------------

create table if not exists roofr_outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid not null references leads (id) on delete cascade,

  action          text not null default 'create_job_and_customer',
  -- What was sent, minus anything not needed to retry it.
  payload         jsonb not null,
  external_job_id text not null,

  status          text not null default 'queued',
  attempts        integer not null default 0,
  last_error      text,
  next_attempt_at timestamptz,

  queued_by       uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- Not "sent". Roofr confirmed, by sending an event back with the ids.
  acknowledged_at timestamptz,

  constraint roofr_outbox_status_known check (status in (
    'queued', 'sent', 'acknowledged', 'failed', 'given_up', 'duplicate'
  )),
  constraint roofr_outbox_action_known check (action in ('create_job_and_customer'))
);

-- One live attempt per lead. A second tap on "create in Roofr" must not make a
-- second job, and this is the constraint rather than a disabled button.
create unique index if not exists roofr_outbox_one_open_per_lead
  on roofr_outbox (lead_id) where status in ('queued', 'sent');

create index if not exists roofr_outbox_org_idx on roofr_outbox (organization_id, created_at desc);

comment on column roofr_outbox.acknowledged_at is
  'Set only when Roofr has confirmed by sending an event back carrying the job '
  'id. "Sent to Zapier" is not "created in Roofr", and treating the first as '
  'the second is how a job goes missing with everything looking green.';

-- ---------------------------------------------------------------------------
-- The sync log, both directions in one place
-- ---------------------------------------------------------------------------

create or replace view roofr_sync_log with (security_invoker = true) as
select
  e.id,
  e.organization_id,
  'inbound'::text          as direction,
  e.event_type             as what,
  e.status,
  e.received_at            as at,
  e.lead_id,
  e.roofr_job_id,
  e.error,
  null::integer            as attempts
from roofr_events e
union all
select
  o.id,
  o.organization_id,
  'outbound'::text         as direction,
  o.action                 as what,
  o.status,
  o.created_at             as at,
  o.lead_id,
  null::text               as roofr_job_id,
  o.last_error             as error,
  o.attempts
from roofr_outbox o;

comment on view roofr_sync_log is
  'Both directions, newest first when ordered. security_invoker, so a rep sees '
  'what their organisation''s RLS lets them see.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table roofr_settings enable row level security;
alter table roofr_links enable row level security;
alter table roofr_events enable row level security;
alter table roofr_outbox enable row level security;

drop policy if exists roofr_settings_read on roofr_settings;
create policy roofr_settings_read on roofr_settings
  for select using (organization_id in (select app.current_org_ids()));

-- Connecting a CRM is a management decision, enforced here and not by hiding a
-- settings tab.
drop policy if exists roofr_settings_manager_write on roofr_settings;
create policy roofr_settings_manager_write on roofr_settings
  for all
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists roofr_links_read on roofr_links;
create policy roofr_links_read on roofr_links
  for select using (organization_id in (select app.current_org_ids()));

-- Links are written by the Edge Function with the service role, which bypasses
-- RLS. No client write policy exists, so a phone cannot invent a Roofr job id.
drop policy if exists roofr_events_read on roofr_events;
create policy roofr_events_read on roofr_events
  for select using (organization_id in (select app.current_org_ids()));

drop policy if exists roofr_outbox_read on roofr_outbox;
create policy roofr_outbox_read on roofr_outbox
  for select using (organization_id in (select app.current_org_ids()));

-- A rep may ASK for a lead to go to Roofr; the Edge Function decides and sends.
drop policy if exists roofr_outbox_member_queue on roofr_outbox;
create policy roofr_outbox_member_queue on roofr_outbox
  for insert with check (
    organization_id in (select app.current_org_ids())
    and queued_by = auth.uid()
    and status = 'queued'
  );

drop trigger if exists roofr_links_touch on roofr_links;
create trigger roofr_links_touch
  before update on roofr_links
  for each row execute function app.touch_updated_at();

drop trigger if exists roofr_settings_touch on roofr_settings;
create trigger roofr_settings_touch
  before update on roofr_settings
  for each row execute function app.touch_updated_at();

revoke all on roofr_sync_log from anon;
grant select on roofr_sync_log to authenticated;

-- =================================================================
-- 20260924_0027_roofr_webhook_credential.sql
-- =================================================================
-- =============================================================================
-- 0027  The credential the Zapier webhook presents
-- =============================================================================
-- The inbound endpoint has to answer two questions about every request: is this
-- really from our Zap, and which organisation is it for. One secret answers
-- both, so the token IS the organisation's identity and there is no org id in
-- the URL for somebody to change.
--
-- Only the hash is stored. The token is generated in the browser, shown to the
-- person once, and never recoverable â€” not by support, not by an admin, not by
-- reading this table. A hint (last four characters) exists so somebody can tell
-- which token is in a Zap without being able to reconstruct it.
--
-- No salt, deliberately: the token is 32 bytes of CSPRNG output, so there is no
-- dictionary to defend against, and a salt would only prevent the endpoint from
-- finding the row by hash in one indexed lookup.
--
-- Rollback:
--   alter table roofr_settings
--     drop column if exists webhook_secret_hash,
--     drop column if exists webhook_secret_hint,
--     drop column if exists webhook_rotated_at;
-- =============================================================================

alter table roofr_settings
  add column if not exists webhook_secret_hash text,
  add column if not exists webhook_secret_hint text,
  add column if not exists webhook_rotated_at timestamptz;

create unique index if not exists roofr_settings_webhook_hash_unique
  on roofr_settings (webhook_secret_hash) where webhook_secret_hash is not null;

comment on column roofr_settings.webhook_secret_hash is
  'SHA-256 of the bearer token the Zap sends, hex, lowercase. The token itself '
  'is never stored anywhere and cannot be recovered.';
comment on column roofr_settings.webhook_secret_hint is
  'Last four characters, so a person can identify a token without holding it.';

-- =================================================================
-- 20260924_0028_roofr_address_rpc.sql
-- =================================================================
-- =============================================================================
-- 0028  One address normaliser, reachable from the Edge Function
-- =============================================================================
-- properties.normalized_address is a generated column computed by
-- app.normalize_address. The inbound webhook has to normalise a Roofr address
-- the identical way or it will never match a row, and `app` is not a schema
-- PostgREST exposes.
--
-- The alternative â€” reimplementing the same regexes in TypeScript â€” is how the
-- two copies drift: somebody adds "avenue -> ave" to the SQL, the webhook keeps
-- the old rules, and inbound events quietly stop matching properties that are
-- plainly there. So this is a thin wrapper over the one real implementation,
-- not a second one.
--
-- Rollback:
--   drop function if exists public.roofr_normalize_address(text, text);
-- =============================================================================

create or replace function public.roofr_normalize_address(raw_address text, raw_postal text)
returns text
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  -- Composed exactly as properties.normalized_address is composed, including
  -- the space and the coalesce. Any difference here is a silent no-match.
  select app.normalize_address(raw_address || ' ' || coalesce(raw_postal, ''));
$$;

comment on function public.roofr_normalize_address is
  'Wrapper so the inbound Roofr webhook normalises an address with the exact '
  'same rules as the generated column it has to match against.';

revoke all on function public.roofr_normalize_address(text, text) from public, anon, authenticated;
grant execute on function public.roofr_normalize_address(text, text) to service_role;

-- =================================================================
-- 20260924_0029_roofr_address_rpc_definer.sql
-- =================================================================
-- =============================================================================
-- 0029  Let the webhook actually reach the address normaliser
-- =============================================================================
-- 0028 exposed public.roofr_normalize_address as SECURITY INVOKER, which looked
-- like the conservative choice and was in fact a broken one: `service_role` has
-- no USAGE on the `app` schema, so the wrapper could never call the function it
-- wraps. Every inbound Roofr event fell through to "unmatched" â€” with a 200, a
-- recorded event and an honest reason, which is why this was visible rather
-- than silent, but still wrong.
--
-- Found by posting a real event at the deployed endpoint with an address that
-- is verifiably in the properties table, and getting matched=unmatched back.
-- Nothing in the unit tests could have caught it; it is a grant, not a branch.
--
-- The fix is SECURITY DEFINER on this one function rather than
-- `grant usage on schema app to service_role`, which would hand the service
-- role every helper in that schema to solve a problem with one of them.
--
-- Safe as definer: it takes two text arguments, calls one immutable pure
-- function, touches no table, and returns a string. There is no row it could
-- expose and no statement a caller could steer. search_path is pinned so the
-- `app.` reference cannot be shadowed.
--
-- Rollback: re-run 0028 (restores the invoker version, and the bug).
-- =============================================================================

create or replace function public.roofr_normalize_address(raw_address text, raw_postal text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.normalize_address(raw_address || ' ' || coalesce(raw_postal, ''));
$$;

revoke all on function public.roofr_normalize_address(text, text) from public, anon, authenticated;
grant execute on function public.roofr_normalize_address(text, text) to service_role;

comment on function public.roofr_normalize_address is
  'SECURITY DEFINER so the inbound webhook, which runs as service_role and has '
  'no USAGE on the app schema, can normalise an address with the same rules as '
  'the generated column it must match. Pure: no tables, no rows, no statement '
  'a caller could steer.';

-- =================================================================
-- 20260924_0030_integration_traces.sql
-- =================================================================
-- =============================================================================
-- 0030  One id that follows a piece of field work all the way through
-- =============================================================================
-- The question this answers is "what happened to this lead?", asked by a
-- manager on the phone while a rep stands in a driveway insisting they recorded
-- something. Today that question takes an afternoon and a database client.
--
-- Append-only, and enforced rather than promised: the trigger below refuses
-- UPDATE and DELETE from every role including the service role. A trace whose
-- history can be quietly rewritten is worth less than no trace at all, because
-- it invites being trusted.
--
-- Two clocks are kept, deliberately. `device_at` is when the rep's phone
-- believed something happened; `at` is when the server heard about it. They can
-- differ by hours â€” a phone with no signal in a truck all afternoon â€” and
-- collapsing them into one column destroys exactly the evidence needed to
-- explain a late-arriving knock.
--
-- Rollback:
--   drop view if exists lead_trace;
--   drop table if exists integration_traces cascade;
--   drop function if exists app.forbid_trace_rewrite();
-- =============================================================================

create table if not exists integration_traces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  -- Minted on the DEVICE at the moment the rep acted, not here. The interesting
  -- failures happen before the server ever hears about the work.
  trace_id        text not null,
  layer           text not null,
  step            text not null,
  outcome         text not null,

  lead_id         uuid references leads (id) on delete set null,
  entity          text,
  entity_id       text,

  -- One short human sentence. Never a payload, a token, or a homeowner.
  detail          text,

  actor           uuid references auth.users (id) on delete set null,
  device_at       timestamptz,
  at              timestamptz not null default now(),

  constraint integration_traces_layer_known check (layer in (
    'device', 'outbox', 'server', 'outbound', 'inbound'
  )),
  constraint integration_traces_outcome_known check (outcome in (
    'started', 'ok', 'refused', 'failed', 'unknown'
  )),
  -- A trace id is 'tr_' plus 16 Crockford base32 characters. Checked here so a
  -- malformed id cannot enter and quietly fail to join with anything.
  constraint integration_traces_id_shaped check (trace_id ~ '^tr_[0-9A-HJKMNP-TV-Z]{16}$'),
  constraint integration_traces_detail_short check (detail is null or length(detail) <= 200)
);

create index if not exists integration_traces_trace_idx
  on integration_traces (organization_id, trace_id, at);
create index if not exists integration_traces_lead_idx
  on integration_traces (lead_id, at desc) where lead_id is not null;
create index if not exists integration_traces_recent_idx
  on integration_traces (organization_id, at desc);
-- Finding the failures is the common query, so it gets its own partial index.
create index if not exists integration_traces_trouble_idx
  on integration_traces (organization_id, at desc) where outcome in ('failed', 'unknown');

comment on table integration_traces is
  'Append-only. What happened to a piece of field work, at every layer it '
  'passed through. Enforced immutable by app.forbid_trace_rewrite.';
comment on column integration_traces.device_at is
  'When the phone believed this happened. Differs from `at` by however long the '
  'device was offline, which is the evidence that explains a late knock.';

-- ---------------------------------------------------------------------------
-- Immutable, and not on the honour system
-- ---------------------------------------------------------------------------

create or replace function app.forbid_trace_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  raise exception
    'integration_traces is append-only; % is not permitted', lower(tg_op)
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists integration_traces_immutable on integration_traces;
create trigger integration_traces_immutable
  before update or delete on integration_traces
  for each row execute function app.forbid_trace_rewrite();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table integration_traces enable row level security;

drop policy if exists integration_traces_read on integration_traces;
create policy integration_traces_read on integration_traces
  for select using (organization_id in (select app.current_org_ids()));

-- A member may record what their own device did, and nothing else. `actor` is
-- pinned to the caller so one rep's phone cannot write steps in another's name.
drop policy if exists integration_traces_append on integration_traces;
create policy integration_traces_append on integration_traces
  for insert with check (
    organization_id in (select app.current_org_ids())
    and actor = auth.uid()
    and layer in ('device', 'outbox')
  );

-- No update policy and no delete policy exist, and the trigger above means even
-- adding one later would not make rewriting possible without a migration that
-- says so out loud.

-- ---------------------------------------------------------------------------
-- What happened to this lead
-- ---------------------------------------------------------------------------

create or replace view lead_trace with (security_invoker = true) as
select
  t.lead_id,
  t.trace_id,
  t.layer,
  t.step,
  t.outcome,
  t.detail,
  t.actor,
  t.device_at,
  t.at,
  -- How long the phone sat on this before the server heard. The number that
  -- explains most "it never synced" reports.
  case
    when t.device_at is null then null
    else extract(epoch from (t.at - t.device_at))
  end as carried_seconds,
  t.organization_id
from integration_traces t;

comment on view lead_trace is
  'Every step recorded against a lead, newest last when ordered by at. '
  'carried_seconds is how long the device held the work before the server saw it.';

revoke all on lead_trace from anon;
grant select on lead_trace to authenticated;

-- =================================================================
-- 20260924_0031_contact_provider.sql
-- =================================================================
-- =============================================================================
-- 0031  Which contact-data provider this company may actually use
-- =============================================================================
-- The research behind this, 23 September 2026: BeenVerified does run a current
-- documented API, but its CONSUMER terms (updated 23 October 2025) prohibit use
-- "for professional, commercial, business ... lead-list generating ...
-- purposes". A roofing company building a call list is inside that list four
-- ways. The prohibition is on the PURPOSE, so it binds a rep typing a number in
-- by hand exactly as it binds a script fetching one.
--
-- Hence `commercial_use_confirmed`: a person has read the agreement behind the
-- credential and states that it permits commercial prospecting. No API response
-- can tell you what contract you signed, so this cannot be detected â€” only
-- attested, by somebody, on a date, with their name against it.
--
-- Rollback: drop table if exists contact_provider_settings cascade;
-- =============================================================================

create table if not exists contact_provider_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,

  entitlement text not null default 'none',

  /*
   * Whether a server-side credential exists. NOT the credential.
   *
   * The key itself lives in an Edge Function secret. This column exists so the
   * admin screen can say "a key is set" without the browser ever being able to
   * read one, and so there is no column anybody could be tempted to paste into.
   */
  credential_present boolean not null default false,

  commercial_use_confirmed boolean not null default false,
  commercial_use_confirmed_by uuid references auth.users (id) on delete set null,
  commercial_use_confirmed_at timestamptz,
  /** What the confirmer says permits this. A contract name or a date. */
  commercial_use_basis text,

  -- Off unless somebody chooses otherwise, knowing each call costs money.
  secondary_providers_enabled boolean not null default false,

  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint contact_provider_entitlement_known check (entitlement in (
    'none', 'consumer_subscription', 'business_api'
  )),
  -- A confirmation with nobody's name on it is not a confirmation.
  constraint contact_provider_confirmation_attributed check (
    commercial_use_confirmed = false
    or (commercial_use_confirmed_by is not null and commercial_use_confirmed_at is not null)
  )
);

comment on table contact_provider_settings is
  'Whether this organisation may use a people-search provider, and on whose '
  'authority. Holds no credential: the key is an Edge Function secret.';
comment on column contact_provider_settings.commercial_use_confirmed is
  'A person attests the agreement behind the credential permits commercial '
  'prospecting. Not detectable from any API response â€” only attestable.';

alter table contact_provider_settings enable row level security;

drop policy if exists contact_provider_read on contact_provider_settings;
create policy contact_provider_read on contact_provider_settings
  for select using (organization_id in (select app.current_org_ids()));

-- Deciding what data this company is entitled to use is not a rep's call.
drop policy if exists contact_provider_admin_write on contact_provider_settings;
create policy contact_provider_admin_write on contact_provider_settings
  for all
  using (app.has_org_role(organization_id, array['admin']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin']::app_role[]));

drop trigger if exists contact_provider_touch on contact_provider_settings;
create trigger contact_provider_touch
  before update on contact_provider_settings
  for each row execute function app.touch_updated_at();

-- =================================================================
-- 20260924_0032_revoke_blanket_view_grants.sql
-- =================================================================
-- =============================================================================
-- 0032  Take the write grants off the views nobody meant to hand out
-- =============================================================================
-- Found by auditing the live database against these migrations. The two files
-- disagreed, and the live one was wrong.
--
-- 0011 created the sales-safe estimate projections and granted exactly what it
-- meant to:
--
--     grant select on estimate_versions_sales to authenticated;
--     grant select on estimate_items_sales   to authenticated;
--
-- The live database had INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER on both, for `authenticated` AND for `anon`. Nothing in this repo
-- asked for that. It comes from Supabase's default privileges on the `public`
-- schema, which hand `anon` and `authenticated` ALL on every new table-like
-- object created by `postgres` â€” a view included, the moment it is created.
--
-- WHY THAT WAS SERIOUS, precisely.
--
-- The two *_sales views are deliberately `security_invoker = false` (see the
-- comment above them in 0011, and leave it that way). Base-table RLS on
-- estimate_items/estimate_versions restricts SELECT to admin and manager; the
-- definer view is what lets a SALES REP read a projection with the cost columns
-- dropped. That design is sound and stays.
--
-- But a definer view runs as its owner, `postgres`, for writes too. Both views
-- are single-table with a WHERE, so Postgres makes them automatically
-- updatable (information_schema.views said is_insertable_into = YES), and
-- neither was created WITH CHECK OPTION (check_option = NONE). Put together:
--
--   POST /rest/v1/estimate_items_sales  { "organization_id": "<any org>", ... }
--
-- with nothing but the anon key â€” which is public by design, ships in the
-- browser bundle, and sits in a public repo â€” inserted a forged row straight
-- into estimate_items, as postgres, bypassing RLS, into ANY organisation.
-- CHECK OPTION being absent is what allowed a foreign organization_id; the
-- definer property is what bypassed the policy that would have caught it.
--
-- Reads were never exposed: the views filter on app.current_org_ids(), which
-- is `where user_id = auth.uid()`, and auth.uid() is null for anon, so an
-- unauthenticated SELECT returned zero rows. This was a write hole, not a
-- read hole. Fixing the write grants closes it without touching the design.
--
-- The other views in this file are the same blanket-grant accident with a much
-- smaller blast radius: they are security_invoker (so a write through them is
-- still checked against base-table RLS as the calling user) and were never
-- granted to anon. Revoked anyway â€” every one of them is a read projection,
-- verified against src/: all thirteen are only ever `.select()`ed.
--
-- Not touched here: geometry_columns and geography_columns carry the same
-- blanket grants, but they are PostGIS catalog views, not auto-updatable, and
-- owned by the extension. Revoking on them risks the extension for no gain.
-- =============================================================================

-- --- The actual vulnerability -------------------------------------------------
-- anon has no business touching these at all. Revoke everything, including the
-- SELECT that returned nothing anyway, so least privilege is the stated intent
-- rather than an accident of auth.uid() being null.
revoke all on public.estimate_versions_sales from anon;
revoke all on public.estimate_items_sales   from anon;

-- authenticated keeps SELECT and loses the rest. This is what 0011 intended.
revoke insert, update, delete, truncate, references, trigger
  on public.estimate_versions_sales from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.estimate_items_sales   from authenticated;

grant select on public.estimate_versions_sales to authenticated;
grant select on public.estimate_items_sales   to authenticated;

-- --- Least privilege on the remaining read projections -------------------------
do $$
declare
  v text;
begin
  foreach v in array array[
    'activity_sync_rows',
    'lead_sync_rows',
    'lead_trace',
    'manager_activity_rows',
    'manager_assignment_log',
    'manager_assignment_rows',
    'manager_lead_followups',
    'manager_route_rows',
    'org_directory',
    'roofr_sync_log',
    'route_point_rows'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated',
      v
    );
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$$;

-- --- Stop it happening again ---------------------------------------------------
-- The root cause is a DEFAULT privilege, so every future view created by
-- postgres in this schema starts wide open again. Narrow the default to SELECT
-- so a new read projection is born read-only. A table that genuinely needs
-- writes still gets them the normal way: an explicit grant, in a migration,
-- where it can be read and reviewed.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

comment on view public.estimate_items_sales is
  'Sales-safe projection of estimate_items with cost columns dropped. '
  'Deliberately SECURITY DEFINER (security_invoker = false) so a sales rep can '
  'read it even though base-table RLS limits SELECT to admin/manager â€” do not '
  '"fix" the security_definer_view lint by flipping it. SELECT to authenticated '
  'only; write grants were revoked in 0032 and must never be re-added, because '
  'a definer view without CHECK OPTION is an RLS bypass on insert.';

comment on view public.estimate_versions_sales is
  'Sales-safe projection of estimate_versions with cost columns dropped. '
  'Deliberately SECURITY DEFINER (security_invoker = false) so a sales rep can '
  'read it even though base-table RLS limits SELECT to admin/manager â€” do not '
  '"fix" the security_definer_view lint by flipping it. SELECT to authenticated '
  'only; write grants were revoked in 0032 and must never be re-added, because '
  'a definer view without CHECK OPTION is an RLS bypass on insert.';

-- =================================================================
-- 20260924_0033_postgis_least_privilege.sql
-- =================================================================
-- =============================================================================
-- 0033  Stop anon being able to break every coordinate transform in the app
-- =============================================================================
-- The same blanket default privileges that 0032 cleaned off our own views also
-- landed on PostGIS's own objects, and one of them matters.
--
-- public.spatial_ref_sys is the EPSG lookup table: the thing ST_Transform reads
-- to know what SRID 4326 means. It had SELECT, INSERT, UPDATE, DELETE and
-- TRUNCATE granted to `anon`, and RLS is not enabled on it (it cannot sensibly
-- be â€” it is extension-owned static reference data).
--
-- So, holding only the public anon key:
--
--     DELETE /rest/v1/spatial_ref_sys?srid=eq.4326
--
-- and every geometry operation in the product starts failing. No data is
-- stolen; the app simply stops being able to do geography. That is a denial of
-- service against a roofing crew's door list, reachable by anyone who views
-- source on the deployed bundle.
--
-- SELECT stays: PostGIS needs to read it, and EPSG definitions are public
-- reference data with nothing of ours in them. Only the writes go.
--
-- Also here: st_estimatedextent is a SECURITY DEFINER C function that PostGIS
-- exposes, which Supabase's linter flags because it is reachable at
-- /rest/v1/rpc/st_estimatedextent by anon. It reads planner statistics to
-- return the bounding box of a geometry column â€” a mild disclosure of where
-- our data sits geographically. Nothing in src/ or supabase/ calls it
-- (verified), so EXECUTE comes off both browser roles.
--
-- NOT done here, deliberately: moving postgis, pg_trgm and btree_gist out of
-- the public schema, which the linter also suggests. That is a real
-- correctness improvement in the abstract and a genuine way to break a
-- production database on a Thursday afternoon â€” every existing index,
-- function signature and migration would need its search_path revisited. It
-- stays on the list, not in this migration.
--
-- -----------------------------------------------------------------------------
-- READ THIS BEFORE TRUSTING THE STATEMENTS BELOW: ON HOSTED SUPABASE THEY DO
-- NOTHING, AND THAT IS NOT A TYPO.
-- -----------------------------------------------------------------------------
-- Applied against the hosted project and then re-read, the grants were
-- unchanged. The reason is a Postgres rule that fails quietly:
--
--   REVOKE only removes grants made BY the role running it.
--
-- Both objects are owned by `supabase_admin`, and the grants were made by
-- `supabase_admin`:
--
--   spatial_ref_sys acl: {... anon=arwdDxtm/supabase_admin ...}
--                                    ^ a=INSERT r=SELECT w=UPDATE d=DELETE
--                                      D=TRUNCATE  /supabase_admin = grantor
--
-- Migrations run as `postgres`, and pg_has_role('postgres','supabase_admin',
-- 'MEMBER') is false. So Postgres emits a WARNING, not an ERROR, the migration
-- reports success, and nothing changes. A green migration that did nothing is
-- exactly the kind of false assurance this codebase tries not to ship, hence
-- this comment rather than a quiet deletion of the statements.
--
-- The statements are kept because they are correct, harmless, and will take
-- effect on any environment where the objects are owned by the migrating role
-- (a local `supabase start` stack, or a self-hosted instance).
--
-- WHAT IS ACTUALLY STILL EXPOSED, verified rather than assumed:
--
--   GET {SUPABASE_URL}/rest/v1/spatial_ref_sys?select=srid&limit=1
--   with only the anon key  ->  HTTP 200  [{"srid":2000}]
--
-- and the ACL above shows the same role holds DELETE and TRUNCATE. This cannot
-- be closed from a `postgres` connection. It needs Supabase support to revoke
-- the write grants that `supabase_admin` made on public.spatial_ref_sys, or a
-- platform-side fix. Tracked as an open item; it is a denial-of-service on
-- geography, not a data-disclosure path.
-- =============================================================================

revoke insert, update, delete, truncate, references, trigger
  on public.spatial_ref_sys from anon, authenticated;

grant select on public.spatial_ref_sys to anon, authenticated;

revoke execute on function public.st_estimatedextent(text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text) from anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean) from anon, authenticated;

-- =================================================================
-- 20260924_0034_activities_carry_route.sql
-- =================================================================
-- =============================================================================
-- 0034  Which route was this door knocked on?
-- =============================================================================
-- Today nothing can answer that question server-side.
--
-- `route_session_id` exists on exactly one table: route_points. A route's doors
-- are matched to it in the browser, by asking for activities whose timestamp
-- falls between the session's start and stop (see RoutePanel.readCounts). That
-- works for the rep looking at their own phone and fails for everything else:
--
--   - a manager cannot ask which doors belonged to a rep's route without
--     re-deriving the time window per rep, per session, in SQL;
--   - an end-of-day report cannot be regenerated later, because the window is
--     reconstructed rather than recorded;
--   - an activity recorded offline mid-route and synced at 9pm lands outside
--     any window the client is still holding, and silently belongs to nothing;
--   - a rep who forgets to end a route has a window that swallows the next
--     morning.
--
-- WHY A COLUMN AND NOT A `route_events` TABLE.
--
-- The obvious shape is a join table carrying route_session_id, lead_id,
-- property_id, activity_id, event_type, occurred_at, location, verification and
-- distance_to_property. Every one of those columns except the first already
-- exists on `activities`:
--
--   lead_id, property_id, activity_type, outcome, occurred_at,
--   recorded_at_location, gps_verification, gps_distance_m, gps_accuracy_m
--
-- So that table would be a second copy of a row we already have, kept in step
-- by hand, free to disagree with the original about whether a knock was
-- verified. The rule this repo already follows - activities and inspections are
-- the source of truth, nothing is duplicated to make a report easier - says to
-- add the one fact that is genuinely missing and nothing else.
--
-- The missing fact is which route the activity happened on. That is one FK.
--
-- WHAT DELIBERATELY DOES NOT GO HERE.
--
-- Arrivals, departures and stops are NOT recorded as events. They are inferred
-- from the GPS trail by features/routes/stops.ts, they are only ever as good as
-- the accuracy of the fixes underneath them, and writing an inference into a
-- table is how it stops being labelled as one. They stay derived, computed on
-- read, next to the accuracy figures that bound them.
--
-- ON DELETE SET NULL, not CASCADE. A purged route must never take a rep's
-- knocks and conversations with it - the activity is the record of work and
-- outlives the trail. route_retention_days on organizations exists precisely so
-- routes can be aged out; that must remain a safe thing to do.
-- =============================================================================

alter table activities
  add column if not exists route_session_id uuid
    references route_sessions (id) on delete set null;

comment on column activities.route_session_id is
  'The route this activity was recorded during, stamped by the client at write '
  'time from the open session. Null means no route was running - a phone call '
  'from the truck, an office follow-up, or work done before routes existed. '
  'Null is not a defect and must never be backfilled by guessing from '
  'timestamps: that would turn an inference into a recorded fact.';

-- Every route-scoped read is "this session, in time order".
create index if not exists activities_route_session_idx
  on activities (route_session_id, occurred_at)
  where route_session_id is not null;

-- =============================================================================
-- No new RLS policies.
-- =============================================================================
-- activities already carries its own org and role policies, and this column
-- adds no way to reach a row that was not already reachable. A manager who can
-- read the activity can now also see which route it belonged to; a manager who
-- cannot read it still cannot. route_sessions keeps its own policies unchanged:
-- rep writes their own, managers and admins read the organisation's.
-- =============================================================================

-- =================================================================
-- 20260924_0035_route_coverage.sql
-- =================================================================
-- =============================================================================
-- 0035  Route coverage is not door coverage
-- =============================================================================
-- The distinction this function exists to make, and the reason it is a hard
-- rule rather than a nicety:
--
--   ROUTE COVERAGE - the trail went past this house.
--   DOOR COVERAGE  - somebody recorded an outcome at this house.
--
-- Treating the first as the second credits a rep for driving down a street,
-- which is the single easiest number in this product to game and the one a
-- manager would most reasonably believe. `manager_route_rows` and
-- route-stats.ts already refuse that; this refuses it at the neighbourhood
-- level too.
--
-- What it is FOR is the gap between them. "You went past 64 doors in Quail
-- Ridge and knocked 12" is the sentence that tells somebody where to send the
-- team tomorrow. Neither number alone says it.
--
-- PASSED IS NOT VISITED. A door within p_radius_m of a recorded fix is a door
-- the rep went past. It is never evidence anybody knocked, and nothing
-- downstream may present it as a visit, an attempt, or contact. It answers
-- only "was this house available on the street they actually walked".
--
-- WHY A FUNCTION AND NOT A VIEW A CLIENT JOINS
--
-- 0021 made a deliberate choice: the full trail is read one route at a time,
-- because handing every GPS point of everybody's week to a browser to draw a
-- list is a surveillance feature wearing a dashboard's clothes. Computing
-- coverage in the client would require exactly that download. So the join
-- happens here and only AGGREGATES leave - counts per subdivision, never a
-- position. This is the more private of the two designs, not the more
-- convenient one.
--
-- SECURITY INVOKER, so every RLS policy that governs route_points, activities
-- and properties governs this too. A rep calling it sees their own routes; a
-- manager sees the organisation's; nobody gains a row they could not already
-- read. The organisation is also passed explicitly, because a user who belongs
-- to two organisations must not get one number spanning both.
-- =============================================================================

create or replace function public.route_coverage(
  p_org        uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_radius_m   double precision default 45
)
returns table (
  subdivision      text,
  doors_available  integer,
  doors_passed     integer,
  doors_knocked    integer,
  appointments     integer
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with pts as (
    select rp.location
    from route_points rp
    join route_sessions s on s.id = rp.route_session_id
    where rp.organization_id = p_org
      and rp.recorded_at >= p_from
      and rp.recorded_at <= p_to
  ),
  doors as (
    select
      p.id,
      coalesce(nullif(btrim(p.subdivision), ''), 'Unnamed') as subdivision,
      p.location
    from properties p
    where p.organization_id = p_org
      and p.location is not null
      and p.deleted_at is null
  ),
  -- The trail went past. NOT a visit; see the header.
  passed as (
    select d.id, d.subdivision
    from doors d
    where exists (
      select 1 from pts
      where st_dwithin(pts.location, d.location, p_radius_m)
    )
  ),
  -- Somebody recorded an outcome. `appointment` is included because an
  -- appointment-set knock is relabelled on the way to the server, and dropping
  -- it here would lose the best door of the day - the same trap recap.ts hit.
  knocked as (
    select distinct a.property_id as id
    from activities a
    where a.organization_id = p_org
      and a.property_id is not null
      and a.activity_type in ('door_knock', 'appointment')
      and a.occurred_at >= p_from
      and a.occurred_at <= p_to
  ),
  booked as (
    select distinct a.property_id as id
    from activities a
    where a.organization_id = p_org
      and a.property_id is not null
      and a.activity_type = 'appointment'
      and a.occurred_at >= p_from
      and a.occurred_at <= p_to
  )
  select
    d.subdivision,
    count(*)::integer                                             as doors_available,
    count(*) filter (where p.id is not null)::integer              as doors_passed,
    count(*) filter (where k.id is not null)::integer              as doors_knocked,
    count(*) filter (where b.id is not null)::integer              as appointments
  from doors d
  left join passed  p on p.id = d.id
  left join knocked k on k.id = d.id
  left join booked  b on b.id = d.id
  group by d.subdivision
  order by d.subdivision;
$$;

comment on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) is
  'Per-subdivision coverage for a window. doors_passed means the recorded trail '
  'came within p_radius_m of the house and is NOT evidence of a visit; '
  'doors_knocked means an outcome was recorded there. The two must never be '
  'presented as the same thing. Returns aggregates only - no position ever '
  'leaves this function. SECURITY INVOKER, so RLS decides what is counted.';

-- Anonymous callers have no business here; this reads where people walked.
--
-- FROM PUBLIC, not from anon. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and anon inherits it there - so `revoke ... from anon`
-- succeeds, changes nothing, and leaves anon able to call it. Verified the
-- hard way: after the first revoke, has_function_privilege('anon', ...) was
-- still true. This is the same silent-no-op shape as 0033, where a revoke of
-- grants made by supabase_admin reported success and did nothing. A revoke
-- that returns without error has NOT necessarily removed anything; the only
-- proof is reading the ACL back.
--
-- It would have been harmless here - the function is SECURITY INVOKER, so anon
-- has no rows to see either way - and it is fixed anyway, because "the other
-- lock held" is not a reason to leave a door open.
revoke execute on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) from public;
grant execute on function public.route_coverage(uuid, timestamptz, timestamptz, double precision) to authenticated;



-- =================================================================
-- 20260924_0036_imagery_intelligence.sql
-- =================================================================
-- =============================================================================
-- 0036  Provider-neutral roof imagery intelligence
-- =============================================================================
-- Metadata is durable; licensed image bytes are not. Every provider's terms
-- decide whether an image may be cached. The application proxies EagleView
-- bytes through its approved API and stores only capture identity, provenance,
-- resolution and dates here.
--
-- Rollback:
--   drop table if exists imagery_ai_analysis, imagery_watch_requests,
--     imagery_comparisons, property_imagery, imagery_requests,
--     imagery_captures cascade;
-- =============================================================================

create table if not exists imagery_captures (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  provider          text not null,
  capture_id        text not null,
  image_urn         text not null,
  captured_from     timestamptz,
  captured_until    timestamptz,
  published_at      timestamptz,
  resolution_gsd_m  numeric(10, 6),
  view_type         text not null,
  composite         boolean not null default false,
  disaster_capture  boolean not null default false,
  source_reference  text,
  license_metadata  jsonb not null default '{}'::jsonb,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  constraint imagery_captures_provider_known check (provider in ('eagleview', 'nearmap', 'mapbox', 'manual_drone')),
  constraint imagery_captures_view_known check (view_type in ('ortho', 'north', 'east', 'south', 'west', 'drone')),
  constraint imagery_captures_gsd_sane check (resolution_gsd_m is null or resolution_gsd_m > 0),
  unique (organization_id, provider, image_urn)
);

create index if not exists imagery_captures_date_idx
  on imagery_captures (organization_id, captured_until desc nulls last);

create table if not exists imagery_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  provider          text not null,
  action            text not null,
  property_id       uuid references properties (id) on delete set null,
  requested_location geography(Point, 4326),
  requested_by      uuid references auth.users (id) on delete set null,
  status            text not null default 'started',
  response_count    integer,
  error_summary     text,
  requested_at      timestamptz not null default now(),
  completed_at      timestamptz,
  constraint imagery_requests_status_known check (status in ('started', 'succeeded', 'failed', 'not_configured')),
  constraint imagery_requests_error_short check (error_summary is null or length(error_summary) <= 240)
);

create index if not exists imagery_requests_recent_idx
  on imagery_requests (organization_id, requested_at desc);

create table if not exists property_imagery (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  property_id       uuid not null references properties (id) on delete cascade,
  imagery_capture_id uuid not null references imagery_captures (id) on delete cascade,
  hazard_event_id   uuid references storm_events (id) on delete set null,
  role              text not null default 'reference',
  created_at        timestamptz not null default now(),
  constraint property_imagery_role_known check (role in ('reference', 'before', 'after', 'inspection', 'claim_evidence')),
  unique (property_id, imagery_capture_id, hazard_event_id, role)
);

create index if not exists property_imagery_property_idx
  on property_imagery (organization_id, property_id, created_at desc);

create table if not exists imagery_comparisons (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  property_id       uuid not null references properties (id) on delete cascade,
  hazard_event_id   uuid references storm_events (id) on delete set null,
  before_capture_id uuid not null references imagery_captures (id) on delete restrict,
  after_capture_id  uuid not null references imagery_captures (id) on delete restrict,
  registration_status text not null default 'not_checked',
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint imagery_comparisons_registration_known check (
    registration_status in ('not_checked', 'aligned', 'warning', 'unusable')
  ),
  constraint imagery_comparisons_two_images check (before_capture_id <> after_capture_id)
);

create table if not exists imagery_watch_requests (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  property_id       uuid not null references properties (id) on delete cascade,
  hazard_event_id   uuid references storm_events (id) on delete set null,
  provider          text not null default 'eagleview',
  minimum_captured_at timestamptz,
  maximum_gsd_m     numeric(10, 6),
  status            text not null default 'active',
  last_checked_at   timestamptz,
  matched_capture_id uuid references imagery_captures (id) on delete set null,
  requested_by      uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint imagery_watch_status_known check (status in ('active', 'matched', 'paused', 'cancelled')),
  constraint imagery_watch_gsd_sane check (maximum_gsd_m is null or maximum_gsd_m > 0)
);

create unique index if not exists imagery_watch_one_active_idx
  on imagery_watch_requests (property_id, provider, coalesce(hazard_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

create table if not exists imagery_ai_analysis (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  comparison_id     uuid not null references imagery_comparisons (id) on delete cascade,
  model             text not null,
  model_version     text,
  possible_changes  jsonb not null default '[]'::jsonb,
  areas_to_inspect  jsonb not null default '[]'::jsonb,
  confidence        text not null,
  limitations       jsonb not null default '[]'::jsonb,
  quality_gate      text not null,
  created_at        timestamptz not null default now(),
  constraint imagery_ai_confidence_known check (confidence in ('none', 'low', 'moderate', 'high')),
  constraint imagery_ai_gate_known check (quality_gate in ('passed', 'warning', 'failed'))
);

do $$
declare t text;
begin
  foreach t in array array[
    'imagery_captures', 'imagery_requests', 'property_imagery',
    'imagery_comparisons', 'imagery_watch_requests', 'imagery_ai_analysis'
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

revoke all on imagery_captures, imagery_requests, property_imagery,
  imagery_comparisons, imagery_watch_requests, imagery_ai_analysis from anon;
grant select, insert, update on imagery_captures, imagery_requests, property_imagery,
  imagery_comparisons, imagery_watch_requests, imagery_ai_analysis to authenticated;


-- =================================================================
-- 20260925062254_campaigns.sql
-- =================================================================
create table campaigns (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    name text not null,
    is_active boolean not null default true,
    area geography(Geometry, 4326) not null
);

alter table campaigns enable row level security;

create policy "Managers can read campaigns"
    on campaigns for select
    to authenticated
    using (true);

create policy "Managers can insert campaigns"
    on campaigns for insert
    to authenticated
    with check (true);

create policy "Managers can update campaigns"
    on campaigns for update
    to authenticated
    using (true);


-- =================================================================
-- 20260926_0033_lead_intelligence_ops.sql
-- =================================================================
-- =============================================================================
-- 0033  Lead intelligence provider operations
-- =============================================================================

create table if not exists contact_lookup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  provider text not null,
  status text not null check (status in ('started', 'succeeded', 'not_found', 'failed', 'blocked')),
  matched boolean not null default false,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists contact_lookup_events_org_time
  on contact_lookup_events (organization_id, requested_at desc);

alter table contact_lookup_events enable row level security;

drop policy if exists contact_lookup_events_org_read on contact_lookup_events;
create policy contact_lookup_events_org_read on contact_lookup_events
  for select using (organization_id in (select app.current_org_ids()));

comment on table contact_lookup_events is
  'Operational audit of contact enrichment calls. Stores provider/status only; no returned phone/email values.';

-- Latest estimate economics attached to a lead. This is QUOTED economics, not
-- realised job profit: actual production cost belongs to a future job-cost
-- closeout. The naming intentionally prevents the dashboard from overstating it.
create or replace view lead_quoted_economics
with (security_invoker = true)
as
select distinct on (e.lead_id)
  e.organization_id,
  e.lead_id,
  l.client_id as lead_client_id,
  l.status as lead_status,
  l.opportunity_score,
  ev.version_number,
  ev.sell_price_cents,
  ev.job_cost_cents,
  case
    when ev.sell_price_cents is null then null
    else ev.sell_price_cents - ev.job_cost_cents
  end as quoted_gross_margin_cents,
  ev.created_at as priced_at
from estimates e
join leads l
  on l.id = e.lead_id
 and l.organization_id = e.organization_id
join estimate_versions ev
  on ev.estimate_id = e.id
 and ev.organization_id = e.organization_id
where e.deleted_at is null
  and e.lead_id is not null
order by e.lead_id, ev.version_number desc, ev.created_at desc;

grant select on lead_quoted_economics to authenticated;

comment on view lead_quoted_economics is
  'Latest quoted sell price minus estimated job cost by lead. Not realised accounting gross profit.';


-- =================================================================
-- 20260926_0034_campaigns_tenant_scope.sql
-- =================================================================
-- =============================================================================
-- 0034  Campaigns belong to one organization
-- =============================================================================
-- The original campaigns table had no organization_id and RLS policies using
-- true, which meant every authenticated Delta Ridge user could read/write every
-- campaign. Existing unattributed rows remain inaccessible; new rows must carry
-- an active organization id.
-- =============================================================================

alter table campaigns
  add column if not exists organization_id uuid references organizations (id) on delete cascade,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists campaigns_org_active
  on campaigns (organization_id, is_active, created_at desc);

drop policy if exists "Managers can read campaigns" on campaigns;
drop policy if exists "Managers can insert campaigns" on campaigns;
drop policy if exists "Managers can update campaigns" on campaigns;

create policy campaigns_org_read
  on campaigns for select
  using (
    organization_id in (select app.current_org_ids())
  );

create policy campaigns_manager_insert
  on campaigns for insert
  with check (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
    and (created_by is null or created_by = auth.uid())
  );

create policy campaigns_manager_update
  on campaigns for update
  using (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  )
  with check (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  );

create policy campaigns_manager_delete
  on campaigns for delete
  using (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  );

drop trigger if exists campaigns_touch_updated_at on campaigns;
create trigger campaigns_touch_updated_at
  before update on campaigns
  for each row execute function app.touch_updated_at();

comment on column campaigns.organization_id is
  'Tenant boundary. Legacy rows with NULL are intentionally invisible until an admin explicitly attributes them.';


-- =================================================================
-- 20260926_0035_property_lookup_audit.sql
-- =================================================================
-- =============================================================================
-- 0035  Property provider operational audit
-- =============================================================================
-- Records only provider/status/timing. No property attributes or address values
-- are stored in this operational log.
-- =============================================================================

create table if not exists property_lookup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  provider text not null,
  status text not null check (status in ('started', 'succeeded', 'not_found', 'failed', 'not_configured')),
  matched boolean not null default false,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists property_lookup_events_org_time
  on property_lookup_events (organization_id, requested_at desc);

alter table property_lookup_events enable row level security;

drop policy if exists property_lookup_events_org_read on property_lookup_events;
create policy property_lookup_events_org_read on property_lookup_events
  for select using (organization_id in (select app.current_org_ids()));

comment on table property_lookup_events is
  'Operational audit of paid property-data calls. Does not contain addresses or returned property data.';

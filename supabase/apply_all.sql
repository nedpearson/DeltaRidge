-- Delta Ridge — all migrations, concatenated for one-shot application.
-- Generated 2026-09-18T22:16Z from supabase/migrations/.
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
-- deliberately NOT applied yet — Delta Ridge is one rep today and premature
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
--      right — which is the only way to know whether it is earning its cost.
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


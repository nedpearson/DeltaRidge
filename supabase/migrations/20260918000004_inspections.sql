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

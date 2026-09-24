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

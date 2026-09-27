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

begin;
\set ON_ERROR_STOP on
set client_min_messages to notice;

-- Setup test data
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333','rep.c@delta-ridge.com') on conflict (id) do nothing;

insert into organizations (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000001','Storm Testers','storm-testers') on conflict (id) do nothing;

insert into organization_members (organization_id, user_id, role) values
  ('dddddddd-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','admin') on conflict do nothing;

insert into properties (id, organization_id, address_line1, city, parish, postal_code, location) values
  ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
   '100 Storm Way','Houston','Harris','77001',
   ST_SetSRID(ST_MakePoint(-95.3698, 29.7604),4326)::geography) on conflict do nothing;

-- Ensure NOAA provider exists
insert into storm_providers (id, display_name, geometry_storage_allowed, attribution) values
  ('noaa', 'NOAA', true, 'Source: NOAA') on conflict (id) do nothing;

-- Create a storm event
insert into storm_events (id, provider, external_id, event_type, occurred_at, hail_size_inches, wind_speed_mph, location) values
  ('ffffffff-0000-0000-0000-000000000001','noaa', 'test-storm-1', 'hail', now(), 2.0, 75, ST_SetSRID(ST_MakePoint(-95.3698, 29.7604),4326)::geography) on conflict do nothing;

-- Link storm to property
insert into property_storm_impacts (organization_id, property_id, storm_event_id, distance_meters, match_method) values
  ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 50.0, 'proximity') on conflict do nothing;

grant usage on schema public, app to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;

\echo '--- TEST 1: Property Opportunity Scoring View ---'
do $$
declare
  score int;
begin
  select opportunity_score into score from property_opportunity_scores where property_id = 'eeeeeeee-0000-0000-0000-000000000001';
  -- 2.0 hail * 25 = 50
  -- 75 wind * 0.5 = 37.5
  -- 50 dist * 0.005 = 0.25
  -- Total ~ 87
  if score >= 87 and score <= 88 then
    raise notice 'PASS opportunity score computed correctly: %', score;
  else
    raise exception 'FAIL opportunity score incorrect. Expected ~87, got %', score;
  end if;
end $$;

\echo '--- TEST 2: GPS Verification Route Columns ---'
do $$
declare
  sess_id uuid;
  point_id uuid;
begin
  insert into route_sessions (organization_id, user_id, started_at, total_distance_meters, properties_visited_count)
  values ('dddddddd-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', now(), 1200.50, 5) returning id into sess_id;

  insert into route_points (organization_id, route_session_id, recorded_at, location, location_confidence, is_background_sync)
  values ('dddddddd-0000-0000-0000-000000000001', sess_id, now(), ST_SetSRID(ST_MakePoint(-95.3698, 29.7604),4326)::geography, 'high', true) returning id into point_id;

  raise notice 'PASS route_sessions and route_points accepted new GPS metric columns';
end $$;

\echo '--- TEST 3: Property Visits ---'
do $$
begin
  insert into property_visits (organization_id, property_id, user_id, gps_verified, closest_distance_meters, reported_action)
  values ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', true, 12.5, 'knocked');
  
  raise notice 'PASS property_visits table allows insertions for GPS verified knocks';
end $$;

rollback;

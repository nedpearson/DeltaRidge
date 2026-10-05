begin;
select plan(7);

-- 1. Setup Data
insert into organizations (id, name, slug) values ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org') on conflict do nothing;
insert into properties (id, organization_id, address_line1, location) 
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', '123 Main St', ST_SetSRID(ST_MakePoint(-90.0, 30.0), 4326));

insert into leads (id, organization_id, property_id, status)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'untouched');

-- Insert Storm Event directly on the property
insert into storm_events (id, provider, external_id, event_type, occurred_at, wind_speed_mph, location)
values ('33333333-3333-3333-3333-333333333333', 'noaa', 'test-wind-1', 'wind', now(), 65, ST_SetSRID(ST_MakePoint(-90.001, 30.001), 4326));

-- 2. Test Geospatial Matching
select lives_ok(
  $$ select match_storm_properties('33333333-3333-3333-3333-333333333333') $$,
  'match_storm_properties runs without error'
);

select results_eq(
  $$ select count(*)::int from property_storm_impacts where storm_event_id = '33333333-3333-3333-3333-333333333333' $$,
  ARRAY[1],
  'Storm is matched to property within distance'
);

-- 3. Test Opportunity Scoring
select lives_ok(
  $$ select calculate_property_opportunity_score('11111111-1111-1111-1111-111111111111') $$,
  'calculate_property_opportunity_score runs without error'
);

-- Expected score: Base 0 + 20 (Wind 65) + 10 (Distance <= 1 mile) = 30
select results_eq(
  $$ select opportunity_score::int from leads where property_id = '11111111-1111-1111-1111-111111111111' $$,
  ARRAY[30],
  'Opportunity score correctly computed'
);

-- Change lead status to closed/won
update leads set status = 'sold' where property_id = '11111111-1111-1111-1111-111111111111';
select calculate_property_opportunity_score('11111111-1111-1111-1111-111111111111');

-- Expected score: 0 because sold
select results_eq(
  $$ select opportunity_score::int from leads where property_id = '11111111-1111-1111-1111-111111111111' $$,
  ARRAY[0],
  'Opportunity score is 0 for sold leads'
);

-- Change lead status to high priority
update leads set status = 'appointment', opportunity_score = null where property_id = '11111111-1111-1111-1111-111111111111';
select calculate_property_opportunity_score('11111111-1111-1111-1111-111111111111');

-- Expected score: 100 because appointment
select results_eq(
  $$ select opportunity_score::int from leads where property_id = '11111111-1111-1111-1111-111111111111' $$,
  ARRAY[100],
  'Opportunity score is 100 for appointment leads'
);

-- Test Idempotency
select lives_ok(
  $$ select match_storm_properties('33333333-3333-3333-3333-333333333333') $$,
  'match_storm_properties can be called repeatedly (idempotent)'
);

select * from finish();
rollback;


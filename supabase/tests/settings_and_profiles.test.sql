begin;

select plan(13);

-- TASK 1: Profiles schema checks
select has_column('public', 'profiles', 'first_name', 'profiles should have first_name column');
select has_column('public', 'profiles', 'last_name', 'profiles should have last_name column');
select has_column('public', 'profiles', 'display_name', 'profiles should have display_name column');
select has_column('public', 'profiles', 'mobile_phone', 'profiles should have mobile_phone column');
select has_column('public', 'profiles', 'job_title', 'profiles should have job_title column');
select has_column('public', 'profiles', 'role', 'profiles should have role column');
select has_column('public', 'profiles', 'timezone', 'profiles should have timezone column');

-- TASK 2: Settings schema checks
select has_table('public', 'organization_settings', 'organization_settings table exists');
select has_column('public', 'organization_settings', 'storm_settings', 'organization_settings has storm_settings');
select has_column('public', 'organization_settings', 'gps_settings', 'organization_settings has gps_settings');
select has_column('public', 'organization_settings', 'ai_settings', 'organization_settings has ai_settings');

-- TASK 1: Trigger tests
-- Simulate auth.users insert
insert into auth.users (id, email) values ('c4e61000-0000-4000-8000-000000000000'::uuid, 'john.doe@example.com');

select results_eq(
  $$ select display_name from profiles where id = 'c4e61000-0000-4000-8000-000000000000'::uuid $$,
  $$ values ('john.doe'::text) $$,
  'trigger should extract name before @ for display_name'
);

-- TASK 2: Settings default values & constraints
-- We need to ensure we can insert a settings record for an org
insert into organizations (id, name, slug) values ('c4e61000-0000-4000-8000-000000000001'::uuid, 'Test Org', 'test-org');

insert into organization_settings (organization_id) values ('c4e61000-0000-4000-8000-000000000001'::uuid);

select is(
  (select storm_settings->>'wind_threshold' from organization_settings where organization_id = 'c4e61000-0000-4000-8000-000000000001'::uuid),
  '45',
  'default wind_threshold should be 45'
);

select * from finish();
rollback;

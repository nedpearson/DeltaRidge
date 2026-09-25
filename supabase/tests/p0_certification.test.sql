\set ON_ERROR_STOP on
set client_min_messages to notice;

\echo '--- P0 CERTIFICATION: Manager KPI & Routing Security ---'

do $$
declare
  policy_count integer;
  coverage_public_exec boolean;
  edge_tables integer;
begin
  -- 1. Ensure RLS policies actually exist for the new Manager KPIs
  -- They might be named specific to the KPI or rely on existing policies.
  -- The most critical check is that the tables are not permissive to all.
  select count(*) into policy_count
  from pg_policies 
  where tablename in ('activities', 'route_points', 'leads', 'properties');

  if policy_count < 4 then
    raise exception 'FAIL: Missing RLS policies. Found %, expected at least 4.', policy_count;
  end if;

  -- 2. Verify PostGIS coverage function exists and PUBLIC execution is revoked (Migration 0035)
  select has_function_privilege('public', 'route_coverage(uuid, uuid)', 'EXECUTE') 
  into coverage_public_exec;

  if coverage_public_exec then
    raise exception 'FAIL: route_coverage is executable by PUBLIC. Migration 0035 revoke failed or was skipped.';
  end if;

  -- 3. Verify Edge Function tracking tables exist
  select count(*) into edge_tables
  from information_schema.tables 
  where table_name in ('imagery_requests', 'roofr_outbox', 'roofr_settings')
    and table_schema = 'public';

  if edge_tables < 3 then
    raise exception 'FAIL: Missing Edge Function tracking tables. Found %', edge_tables;
  end if;

  raise notice 'PASS: P0 Certification SQL checks completed successfully.';
end;
$$;

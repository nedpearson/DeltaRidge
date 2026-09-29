-- Emergency RLS Patch
-- 1. Fix content_engine_jobs missing TO clause
drop policy if exists "Service role has full access" on content_engine_jobs;
create policy "Service role has full access" on content_engine_jobs
  for all to service_role
  using (true)
  with check (true);

-- 2. Fix integration_health_logs missing TO clause
drop policy if exists "Admins can read integration health logs" on integration_health_logs;
create policy "Admins can read integration health logs" on integration_health_logs
  for select to authenticated
  using (true);

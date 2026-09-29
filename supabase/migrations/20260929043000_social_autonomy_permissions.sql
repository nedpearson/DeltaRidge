-- Tighten autonomy controls: organization members may read the current state,
-- but only admins/managers may change automation permissions. The automation
-- ledger is evidence and is written by server-side workers, not by browsers.

drop policy if exists social_autonomy_config_org_access on social_autonomy_config;

create policy social_autonomy_config_read on social_autonomy_config
  for select using (app.has_org_access(organization_id));

create policy social_autonomy_config_insert on social_autonomy_config
  for insert with check (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

create policy social_autonomy_config_update on social_autonomy_config
  for update using (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  )
  with check (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

create policy social_autonomy_config_delete on social_autonomy_config
  for delete using (
    app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
  );

drop policy if exists automation_ledger_org_access on automation_ledger;
create policy automation_ledger_read on automation_ledger
  for select using (app.has_org_access(organization_id));

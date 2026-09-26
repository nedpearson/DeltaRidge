-- =============================================================================
-- 0034  Campaigns belong to one organization
-- =============================================================================
-- The original campaigns table had no organization_id and RLS policies using
-- true, which meant every authenticated Delta Ridge user could read/write every
-- campaign. Existing unattributed rows remain inaccessible; new rows must carry
-- an active organization id.
-- =============================================================================

alter table campaigns
  add column if not exists organization_id uuid references organizations (id) on delete cascade,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists campaigns_org_active
  on campaigns (organization_id, is_active, created_at desc);

drop policy if exists "Managers can read campaigns" on campaigns;
drop policy if exists "Managers can insert campaigns" on campaigns;
drop policy if exists "Managers can update campaigns" on campaigns;

create policy campaigns_org_read
  on campaigns for select
  using (
    organization_id in (select app.current_org_ids())
  );

create policy campaigns_manager_insert
  on campaigns for insert
  with check (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
    and (created_by is null or created_by = auth.uid())
  );

create policy campaigns_manager_update
  on campaigns for update
  using (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  )
  with check (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  );

create policy campaigns_manager_delete
  on campaigns for delete
  using (
    organization_id is not null
    and app.has_org_role(organization_id, array['admin','manager']::app_role[])
  );

drop trigger if exists campaigns_touch_updated_at on campaigns;
create trigger campaigns_touch_updated_at
  before update on campaigns
  for each row execute function app.touch_updated_at();

comment on column campaigns.organization_id is
  'Tenant boundary. Legacy rows with NULL are intentionally invisible until an admin explicitly attributes them.';

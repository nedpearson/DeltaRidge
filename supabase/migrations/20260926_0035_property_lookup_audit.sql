-- =============================================================================
-- 0035  Property provider operational audit
-- =============================================================================
-- Records only provider/status/timing. No property attributes or address values
-- are stored in this operational log.
-- =============================================================================

create table if not exists property_lookup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  provider text not null,
  status text not null check (status in ('started', 'succeeded', 'not_found', 'failed', 'not_configured')),
  matched boolean not null default false,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists property_lookup_events_org_time
  on property_lookup_events (organization_id, requested_at desc);

alter table property_lookup_events enable row level security;

drop policy if exists property_lookup_events_org_read on property_lookup_events;
create policy property_lookup_events_org_read on property_lookup_events
  for select using (organization_id in (select app.current_org_ids()));

comment on table property_lookup_events is
  'Operational audit of paid property-data calls. Does not contain addresses or returned property data.';

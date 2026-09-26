-- =============================================================================
-- 0033  Lead intelligence provider operations
-- =============================================================================

create table if not exists contact_lookup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  provider text not null,
  status text not null check (status in ('started', 'succeeded', 'not_found', 'failed', 'blocked')),
  matched boolean not null default false,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists contact_lookup_events_org_time
  on contact_lookup_events (organization_id, requested_at desc);

alter table contact_lookup_events enable row level security;

drop policy if exists contact_lookup_events_org_read on contact_lookup_events;
create policy contact_lookup_events_org_read on contact_lookup_events
  for select using (organization_id in (select app.current_org_ids()));

comment on table contact_lookup_events is
  'Operational audit of contact enrichment calls. Stores provider/status only; no returned phone/email values.';

-- Latest estimate economics attached to a lead. This is QUOTED economics, not
-- realised job profit: actual production cost belongs to a future job-cost
-- closeout. The naming intentionally prevents the dashboard from overstating it.
create or replace view lead_quoted_economics
with (security_invoker = true)
as
select distinct on (e.lead_id)
  e.organization_id,
  e.lead_id,
  l.client_id as lead_client_id,
  l.status as lead_status,
  l.opportunity_score,
  ev.version_number,
  ev.sell_price_cents,
  ev.job_cost_cents,
  case
    when ev.sell_price_cents is null then null
    else ev.sell_price_cents - ev.job_cost_cents
  end as quoted_gross_margin_cents,
  ev.created_at as priced_at
from estimates e
join leads l
  on l.id = e.lead_id
 and l.organization_id = e.organization_id
join estimate_versions ev
  on ev.estimate_id = e.id
 and ev.organization_id = e.organization_id
where e.deleted_at is null
  and e.lead_id is not null
order by e.lead_id, ev.version_number desc, ev.created_at desc;

grant select on lead_quoted_economics to authenticated;

comment on view lead_quoted_economics is
  'Latest quoted sell price minus estimated job cost by lead. Not realised accounting gross profit.';

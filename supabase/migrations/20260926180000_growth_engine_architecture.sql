-- =============================================================================
-- DELTA RIDGE GROWTH ENGINE ARCHITECTURE
-- =============================================================================
-- This migration lays the schema foundation for the remaining features requested
-- in the Phase 5/6 audit.
-- =============================================================================

-- 1. Lead Source Registry
create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, -- e.g., 'Facebook Ads', 'Door Knocking', 'Direct Mail'
  category text not null, -- e.g., 'digital', 'field', 'referral', 'organic'
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

alter table leads add column if not exists lead_source_id uuid references lead_sources(id);
alter table leads add column if not exists utm_campaign text;
alter table leads add column if not exists utm_medium text;
alter table leads add column if not exists utm_content text;

-- 2. Marketing Spend & Attribution
create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_source_id uuid references lead_sources(id),
  name text not null,
  budget_cap integer,
  total_spend integer default 0,
  start_date date,
  end_date date,
  status text default 'planned' check (status in ('planned', 'active', 'paused', 'completed'))
);

create table if not exists marketing_spend_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  campaign_id uuid references marketing_campaigns(id),
  amount integer not null,
  spend_date date not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 3. Automation Ledger & Approvals
create table if not exists automation_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  event_trigger text not null, -- e.g., 'lead_won'
  rule_name text not null, -- e.g., 'neighborhood_blast'
  action_attempted text not null,
  result text not null check (result in ('success', 'failed', 'queued')),
  details jsonb, -- e.g., {"passed_suppression": 61, "rejected": 1}
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists automation_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  rule_name text not null,
  proposed_action jsonb not null, -- e.g., {"cost": 248, "postcards": 312}
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 4. Actual Job Costing
create table if not exists job_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid references leads(id),
  category text not null check (category in ('materials', 'labor', 'subs', 'permits', 'waste', 'commissions')),
  estimated_amount integer,
  actual_amount integer,
  variance_reason text,
  incurred_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 5. Competitor Intelligence
create table if not exists competitor_intelligence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid references leads(id),
  competitor_name text not null,
  competitor_quote integer,
  win_loss_result text check (win_loss_result in ('we_won', 'competitor_won')),
  reason text check (reason in ('price', 'relationship', 'speed', 'product')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 6. Call Outcome Intelligence
create table if not exists call_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid references leads(id),
  rep_id uuid,
  outcome text not null check (outcome in ('no_answer', 'voicemail', 'spoke', 'interested', 'do_not_contact')),
  duration_seconds integer,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 7. RoofCare Deeper (Service Requests)
create table if not exists roofcare_service_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  membership_id uuid references roofcare_memberships(id),
  request_type text not null check (request_type in ('inspection', 'leak', 'warranty', 'repair')),
  description text,
  status text default 'open' check (status in ('open', 'scheduled', 'resolved')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- =============================================================================
-- RLS Policies
-- =============================================================================

alter table lead_sources enable row level security;
create policy lead_sources_org_access on lead_sources
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table marketing_campaigns enable row level security;
create policy marketing_campaigns_org_access on marketing_campaigns
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table marketing_spend_ledger enable row level security;
create policy marketing_spend_ledger_org_access on marketing_spend_ledger
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table automation_ledger enable row level security;
create policy automation_ledger_org_access on automation_ledger
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table automation_approvals enable row level security;
create policy automation_approvals_org_access on automation_approvals
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table job_costs enable row level security;
create policy job_costs_org_access on job_costs
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table competitor_intelligence enable row level security;
create policy competitor_intelligence_org_access on competitor_intelligence
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table call_outcomes enable row level security;
create policy call_outcomes_org_access on call_outcomes
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table roofcare_service_requests enable row level security;
create policy roofcare_service_requests_org_access on roofcare_service_requests
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

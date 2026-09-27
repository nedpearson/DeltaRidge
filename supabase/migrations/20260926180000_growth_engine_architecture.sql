-- =============================================================================
-- DELTA RIDGE GROWTH ENGINE ARCHITECTURE
-- =============================================================================
-- This migration lays the schema foundation for the remaining features requested
-- in the Phase 5/6 audit.
-- =============================================================================

-- 1. Lead Source Registry
create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  name text not null, -- e.g., 'Facebook Ads', 'Door Knocking', 'Direct Mail'
  category text not null, -- e.g., 'digital', 'field', 'referral', 'organic'
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table leads add column if not exists lead_source_id uuid references lead_sources(id);
alter table leads add column if not exists utm_campaign text;
alter table leads add column if not exists utm_medium text;
alter table leads add column if not exists utm_content text;

-- 2. Marketing Spend & Attribution
create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_source_id uuid references lead_sources(id),
  name text not null,
  budget_cap numeric,
  total_spend numeric default 0,
  start_date date,
  end_date date,
  status text default 'planned' -- planned, active, paused, completed
);

create table if not exists marketing_spend_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references marketing_campaigns(id),
  amount numeric not null,
  spend_date date not null,
  description text,
  created_at timestamptz default now()
);

-- 3. Automation Ledger & Approvals
create table if not exists automation_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  event_trigger text not null, -- e.g., 'lead_won'
  rule_name text not null, -- e.g., 'neighborhood_blast'
  action_attempted text not null,
  result text not null, -- 'success', 'failed', 'queued'
  details jsonb, -- e.g., {"passed_suppression": 61, "rejected": 1}
  created_at timestamptz default now()
);

create table if not exists automation_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  rule_name text not null,
  proposed_action jsonb not null, -- e.g., {"cost": 248, "postcards": 312}
  status text default 'pending', -- pending, approved, rejected
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- 4. Actual Job Costing
create table if not exists job_costs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  category text not null, -- 'materials', 'labor', 'subs', 'permits', 'waste', 'commissions'
  estimated_amount numeric,
  actual_amount numeric,
  variance_reason text,
  incurred_date date,
  created_at timestamptz default now()
);

-- 5. Competitor Intelligence
create table if not exists competitor_intelligence (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  lead_id uuid references leads(id),
  competitor_name text not null,
  competitor_quote numeric,
  win_loss_result text, -- 'we_won', 'competitor_won'
  reason text, -- 'price', 'relationship', 'speed', 'product'
  created_at timestamptz default now()
);

-- 6. Call Outcome Intelligence
create table if not exists call_outcomes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  rep_id uuid,
  outcome text not null, -- 'no_answer', 'voicemail', 'spoke', 'interested', 'do_not_contact'
  duration_seconds integer,
  notes text,
  created_at timestamptz default now()
);

-- 7. RoofCare Deeper (Service Requests)
create table if not exists roofcare_service_requests (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid references roofcare_memberships(id),
  request_type text not null, -- 'inspection', 'leak', 'warranty', 'repair'
  description text,
  status text default 'open', -- 'open', 'scheduled', 'resolved'
  created_at timestamptz default now()
);

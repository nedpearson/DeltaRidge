-- Phase 14 & Phase 2: Enrichment Jobs & Source Classification

create type opportunity_classification as enum (
  'STORM_COMBINED',
  'STORM_WIND',
  'STORM_HAIL',
  'AGING_ROOF',
  'PERMIT_GAP',
  'REFERRAL',
  'MANUAL',
  'CRM',
  'CAMPAIGN',
  'UNKNOWN'
);

create type enrichment_job_status as enum (
  'QUEUED',
  'RUNNING',
  'PARTIAL',
  'SUCCEEDED',
  'FAILED',
  'RETRYING'
);

create table if not exists enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  status enrichment_job_status not null default 'QUEUED',
  
  -- Tracking
  attempt_count int not null default 0,
  last_error text,
  
  -- Lifecycle
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);

-- Backfill table
create table if not exists enrichment_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  total_leads int default 0,
  owner_complete int default 0,
  owner_missing int default 0,
  phone_complete int default 0,
  email_complete int default 0,
  permits_checked int default 0,
  roof_age_known int default 0,
  storm_matched int default 0,
  gps_coordinates_complete int default 0,
  scores_recalculated int default 0,
  failed int default 0,
  retrying int default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Phase 13: Store score versions on leads (or properties)
alter table leads add column if not exists score_version int default 1;
alter table leads add column if not exists score_breakdown jsonb;

-- Trigger to enqueue jobs when a new property is created
create or replace function queue_property_enrichment()
returns trigger
language plpgsql security definer
as $$
begin
  insert into enrichment_jobs (property_id, status)
  values (NEW.id, 'QUEUED');
  return NEW;
end;
$$;

drop trigger if exists on_property_created_queue_enrichment on properties;
create trigger on_property_created_queue_enrichment
  after insert on properties
  for each row execute function queue_property_enrichment();

-- Trigger to enqueue jobs when a lead is created
create or replace function queue_lead_enrichment()
returns trigger
language plpgsql security definer
as $$
begin
  insert into enrichment_jobs (property_id, lead_id, status)
  values (NEW.property_id, NEW.id, 'QUEUED');
  return NEW;
end;
$$;

drop trigger if exists on_lead_created_queue_enrichment on leads;
create trigger on_lead_created_queue_enrichment
  after insert on leads
  for each row execute function queue_lead_enrichment();

-- RLS
alter table enrichment_jobs enable row level security;
alter table enrichment_backfill_runs enable row level security;

create policy "Admins and service roles can manage jobs" on enrichment_jobs
  for all using (true);

create policy "Admins and service roles can manage backfill" on enrichment_backfill_runs
  for all using (true);

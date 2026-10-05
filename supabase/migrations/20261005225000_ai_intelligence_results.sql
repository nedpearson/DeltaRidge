create table if not exists ai_intelligence_results (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  model text not null,
  raw_input jsonb,
  raw_output jsonb,
  opportunity_summary text,
  roof_age_years_extracted smallint,
  last_roof_permit_date_extracted date,
  created_at timestamptz default now()
);

create index if not exists ai_intelligence_results_property_id_idx on ai_intelligence_results(property_id);
create index if not exists ai_intelligence_results_lead_id_idx on ai_intelligence_results(lead_id);

alter table properties
  add column if not exists opportunity_summary text;

-- Enable RLS
alter table ai_intelligence_results enable row level security;

-- Policies for ai_intelligence_results
create policy "Enable read access for authenticated users"
  on ai_intelligence_results for select
  to authenticated
  using (true);

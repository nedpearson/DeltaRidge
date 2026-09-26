-- =============================================================================
-- Lead intelligence snapshots: property opportunity, homeowner intent,
-- contactability, and "Ultimate Lead" certification.
--
-- These are rule-based evidence scores, NOT probabilities of sale.
-- Every snapshot keeps its inputs/reasons so a manager can audit the number
-- that was shown at assignment time.
-- =============================================================================

create table if not exists lead_intelligence_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  lead_id               uuid not null references leads (id) on delete cascade,
  property_score        smallint not null check (property_score between 0 and 100),
  intent_score          smallint not null check (intent_score between 0 and 100),
  contactability_score  smallint not null check (contactability_score between 0 and 100),
  overall_priority      smallint not null check (overall_priority between 0 and 100),
  certification         text not null check (certification in ('ultimate','strong','developing','insufficient')),
  property_reasons      jsonb not null default '[]'::jsonb,
  intent_reasons        jsonb not null default '[]'::jsonb,
  contactability_reasons jsonb not null default '[]'::jsonb,
  evidence              jsonb not null default '{}'::jsonb,
  missing_requirements  jsonb not null default '[]'::jsonb,
  scoring_version       text not null,
  computed_at           timestamptz not null default now(),
  computed_by           uuid references auth.users (id) on delete set null
);

create index if not exists lead_intelligence_snapshots_lead
  on lead_intelligence_snapshots (lead_id, computed_at desc);

create index if not exists lead_intelligence_snapshots_org_priority
  on lead_intelligence_snapshots (organization_id, overall_priority desc, computed_at desc);

alter table lead_intelligence_snapshots enable row level security;

create policy lead_intelligence_snapshots_org_access
  on lead_intelligence_snapshots
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

create or replace view latest_lead_intelligence
with (security_invoker = true)
as
select distinct on (s.lead_id)
  s.organization_id,
  s.lead_id,
  l.client_id as lead_client_id,
  s.property_score,
  s.intent_score,
  s.contactability_score,
  s.overall_priority,
  s.certification,
  s.property_reasons,
  s.intent_reasons,
  s.contactability_reasons,
  s.evidence,
  s.missing_requirements,
  s.scoring_version,
  s.computed_at
from lead_intelligence_snapshots s
join leads l on l.id = s.lead_id
where l.deleted_at is null
order by s.lead_id, s.computed_at desc;

grant select on latest_lead_intelligence to authenticated;

comment on table lead_intelligence_snapshots is
  'Auditable rule-based lead intelligence snapshots. Scores are evidence indexes, not predictions of sale probability.';

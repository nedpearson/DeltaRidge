-- =============================================================================
-- 0037  Lead intelligence signals + history
-- =============================================================================
-- Keep the three signals separate. Opportunity is about the PROPERTY, intent
-- is about the HOMEOWNER, and contactability is about whether the homeowner can
-- be reached through an established channel. None of these is a close-rate
-- probability.
-- =============================================================================

alter table leads
  add column if not exists intent_score smallint,
  add column if not exists contactability_score smallint,
  add column if not exists intelligence_level text,
  add column if not exists intelligence_version text;

alter table leads
  drop constraint if exists leads_intent_score_range,
  add constraint leads_intent_score_range
    check (intent_score is null or intent_score between 0 and 100),
  drop constraint if exists leads_contactability_score_range,
  add constraint leads_contactability_score_range
    check (contactability_score is null or contactability_score between 0 and 100),
  drop constraint if exists leads_intelligence_level_valid,
  add constraint leads_intelligence_level_valid
    check (
      intelligence_level is null or intelligence_level in (
        'property_only', 'reachable', 'engaged', 'ultimate'
      )
    );

create table if not exists lead_intelligence_history (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  lead_id               uuid not null references leads (id) on delete cascade,
  property_id           uuid not null references properties (id) on delete cascade,
  opportunity_score     smallint,
  intent_score          smallint,
  contactability_score  smallint,
  intelligence_level    text,
  intelligence_version  text,
  recorded_at           timestamptz not null default now(),
  constraint lead_intelligence_history_opportunity_range
    check (opportunity_score is null or opportunity_score between 0 and 100),
  constraint lead_intelligence_history_intent_range
    check (intent_score is null or intent_score between 0 and 100),
  constraint lead_intelligence_history_contactability_range
    check (contactability_score is null or contactability_score between 0 and 100),
  constraint lead_intelligence_history_level_valid
    check (
      intelligence_level is null or intelligence_level in (
        'property_only', 'reachable', 'engaged', 'ultimate'
      )
    )
);

create index if not exists lead_intelligence_history_lead_time
  on lead_intelligence_history (lead_id, recorded_at desc);

create index if not exists lead_intelligence_history_org_time
  on lead_intelligence_history (organization_id, recorded_at desc);

alter table lead_intelligence_history enable row level security;

drop policy if exists lead_intelligence_history_org_access on lead_intelligence_history;
create policy lead_intelligence_history_org_access
  on lead_intelligence_history
  for all
  using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

create or replace function app.snapshot_lead_intelligence()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if tg_op = 'INSERT'
     or new.opportunity_score is distinct from old.opportunity_score
     or new.intent_score is distinct from old.intent_score
     or new.contactability_score is distinct from old.contactability_score
     or new.intelligence_level is distinct from old.intelligence_level
     or new.intelligence_version is distinct from old.intelligence_version then
    insert into lead_intelligence_history (
      organization_id,
      lead_id,
      property_id,
      opportunity_score,
      intent_score,
      contactability_score,
      intelligence_level,
      intelligence_version,
      recorded_at
    )
    values (
      new.organization_id,
      new.id,
      new.property_id,
      new.opportunity_score,
      new.intent_score,
      new.contactability_score,
      new.intelligence_level,
      new.intelligence_version,
      now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_lead_intelligence on leads;
create trigger snapshot_lead_intelligence
  after insert or update of
    opportunity_score,
    intent_score,
    contactability_score,
    intelligence_level,
    intelligence_version
  on leads
  for each row execute function app.snapshot_lead_intelligence();

comment on column leads.opportunity_score is
  'Deterministic property opportunity index, not a sale probability.';
comment on column leads.intent_score is
  'Observed homeowner intent index based on recorded pipeline state, not a prediction.';
comment on column leads.contactability_score is
  'Reachability/permission index. A looked-up number alone does not imply permission to contact.';
comment on table lead_intelligence_history is
  'Point-in-time history of separate property opportunity, homeowner intent, and contactability signals for outcome attribution.';

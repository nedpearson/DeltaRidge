-- =============================================================================
-- 0012  Compliance rules: sourced, versioned, and allowed to say "I don't know"
-- =============================================================================
-- Nothing in Delta Ridge may assert a legal, code, permit, licensing or
-- programme requirement unless a row here says so, and every row carries where
-- it came from, when it took effect, and when a human last checked it.
--
-- The design point is the third state. A rule can be:
--   verified              - source read, review interval not yet lapsed
--   review_due            - was verified, interval lapsed, still shown WITH its age
--   requires_verification - source is null: we know the question, not the answer
--
-- A rule with no source is not deleted and not trusted. It surfaces as a
-- question, which is the only honest thing to do with a permit fee nobody has
-- looked up. The check constraint below makes that explicit: an unsourced rule
-- must say so in its notes, so it cannot be mistaken for a verified one that
-- merely lost its citation.
--
-- These rows are global rather than per-organisation. Louisiana law does not
-- vary by tenant, and duplicating it per organisation would mean one customer
-- running on a stale copy of a statute.
-- =============================================================================

create type rule_category as enum (
  'licensing',
  'permit',
  'code',
  'contract_notice',
  'conduct',
  'incentive_programme',
  'documentation'
);

create type source_tier as enum (
  'statute',
  'state_agency',
  'ahj',
  'adopted_code',
  'manufacturer',
  'licensed_dataset',
  'quote',
  'secondary'
);

create table compliance_rules (
  id                      text primary key,
  category                rule_category not null,
  state                   text not null,
  -- Empty array means statewide. Otherwise parish or municipality names.
  applies_to              text[] not null default '{}',
  summary                 text not null,
  -- The machine-readable effect, discriminated by an "kind" key. Kept as jsonb
  -- because the shapes genuinely differ - a licence threshold and a verbatim
  -- contract notice have nothing in common - and because the TypeScript union
  -- is the real schema.
  effect                  jsonb not null,
  effective_from          date not null,
  effective_until         date,
  source_tier             source_tier,
  source_citation         text,
  source_url              text,
  source_verified_at      date,
  source_verified_by      text,
  review_interval_months  integer not null default 6,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint compliance_rules_effect_has_kind
    check (effect ? 'kind'),

  constraint compliance_rules_review_interval_positive
    check (review_interval_months > 0),

  constraint compliance_rules_dates_ordered
    check (effective_until is null or effective_until >= effective_from),

  -- A source is all-or-nothing. A citation with no verification date is worse
  -- than no citation: it looks checked.
  constraint compliance_rules_source_complete check (
    (source_tier is null and source_citation is null and source_url is null
     and source_verified_at is null and source_verified_by is null)
    or
    (source_tier is not null and source_citation is not null and source_url is not null
     and source_verified_at is not null and source_verified_by is not null)
  ),

  -- An unsourced rule must announce itself.
  constraint compliance_rules_unsourced_is_declared check (
    source_tier is not null
    or (notes is not null and notes like '%REQUIRES VERIFICATION%')
  ),

  constraint compliance_rules_url_is_https
    check (source_url is null or source_url like 'https://%')
);

create index on compliance_rules (state, category) where effective_until is null;
create index on compliance_rules (source_verified_at);
create index compliance_rules_applies_to_gin on compliance_rules using gin (applies_to);

create trigger touch_compliance_rules before update on compliance_rules
  for each row execute function app.touch_updated_at();

-- Every change to a rule is kept. When a contract written in March cited a
-- statute, it has to be possible to show what the row said in March.
create table compliance_rule_history (
  id                 uuid primary key default gen_random_uuid(),
  rule_id            text not null,
  changed_at         timestamptz not null default now(),
  changed_by         uuid references auth.users (id) on delete set null,
  operation          text not null check (operation in ('insert', 'update', 'delete')),
  previous_state     jsonb,
  new_state          jsonb
);

create index on compliance_rule_history (rule_id, changed_at desc);

create or replace function app.record_compliance_rule_change()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $$
begin
  insert into compliance_rule_history (rule_id, changed_by, operation, previous_state, new_state)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger compliance_rules_history
  after insert or update or delete on compliance_rules
  for each row execute function app.record_compliance_rule_change();

-- Rules are readable by anyone signed in: a rep on a driveway needs to know
-- the parish wants geo-tagged photographs. Writing them is not a tenant
-- operation at all - it follows a human reading an official source - so no
-- write policy is granted here and changes go through a migration or an
-- administrator, on purpose.
alter table compliance_rules enable row level security;
alter table compliance_rule_history enable row level security;

create policy compliance_rules_read on compliance_rules
  for select using (auth.uid() is not null);

create policy compliance_rule_history_read on compliance_rule_history
  for select using (auth.uid() is not null);

comment on table compliance_rules is
  'Sourced legal, code, permit and programme rules. A row with a null source is '
  'a known question, not a known answer, and must say REQUIRES VERIFICATION in '
  'its notes. Nothing in the application may assert a requirement that does not '
  'trace to a row here.';

comment on column compliance_rules.source_verified_at is
  'The date a human last read the official source. Combined with '
  'review_interval_months this is what turns a rule review_due rather than '
  'letting it quietly go stale.';

-- =============================================================================
-- 0022  Rep grading: the computed grade and the manager's, side by side
-- =============================================================================
-- The shape of this schema is the argument.
--
-- TWO GRADES, NEVER ONE
--
-- `ai_*` and `manager_*` are separate columns and neither is ever written over
-- the other. Accepting a suggested grade does not collapse it into the
-- manager's; it records that the manager agreed. That distinction is the only
-- thing that makes the question worth asking a year from now — "does the rubric
-- actually match what our managers think" — answerable at all. A single
-- `grade` column with a `source` flag loses it the first time somebody clicks
-- accept.
--
-- THE COMPUTED GRADE IS FROZEN
--
-- Weights change. Sample floors change. The rubric will be rewritten. A grade
-- recorded in September must keep saying what it said in September, so the
-- whole computation — score, confidence, every category, the weights and the
-- scale that produced it, and the engine's version string — is stored as the
-- jsonb it was, and a trigger refuses to let any of it be edited afterwards.
-- Re-grading a period writes a new row; it does not revise the old one.
--
-- WHAT A REP CAN SEE
--
-- Their own grade, once a manager has entered one. Not the draft suggestion:
-- a rep reading "C-, low confidence" that their manager had not yet looked at
-- is a conversation nobody chose to have, caused by a dashboard. Managers and
-- admins see the organisation's.
--
-- Rollback:
--   drop table if exists rep_grade_events, rep_grades cascade;
--   drop table if exists grading_configs cascade;
--   drop function if exists app.freeze_computed_grade();
--   drop function if exists app.log_rep_grade();
--   drop view if exists manager_lead_followups;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

create table if not exists grading_configs (
  organization_id uuid primary key references organizations (id) on delete cascade,
  -- manual | assisted | automatic. Assisted is the recommended default: the
  -- rubric reads four thousand activity rows without getting bored, and the
  -- manager still decides.
  mode            text not null default 'assisted',
  -- Never hard-coded in the app. A weighting is a statement about what this
  -- business values and belongs to the business.
  weights         jsonb not null,
  scale           jsonb not null,
  floors          jsonb not null default '{}'::jsonb,
  min_confidence  real not null default 0.6,
  manager_approval_required boolean not null default true,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint grading_configs_mode_known check (mode in ('manual', 'assisted', 'automatic')),
  constraint grading_configs_confidence_range check (min_confidence between 0 and 1),
  constraint grading_configs_weights_object check (jsonb_typeof(weights) = 'object'),
  constraint grading_configs_scale_array check (jsonb_typeof(scale) = 'array')
);

comment on table grading_configs is
  'How this organisation grades. One row per organisation; the app falls back '
  'to its published defaults when there is none.';

-- ---------------------------------------------------------------------------
-- The grades
-- ---------------------------------------------------------------------------

create table if not exists rep_grades (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  client_id        uuid not null default gen_random_uuid(),
  rep_id           uuid not null references auth.users (id) on delete cascade,
  period           text not null,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  -- The mode in force when this was produced, stored rather than looked up:
  -- the setting changes and this row must keep describing what happened.
  mode             text not null,

  -- The computation, exactly as it was. Frozen by trigger below.
  engine           text,
  ai_score         real,
  ai_letter        text,
  ai_confidence    real,
  ai_detail        jsonb,
  computed_at      timestamptz,

  -- The manager's. Separate, and always allowed to differ.
  manager_letter   text,
  manager_comment  text,
  manager_override_reason text,
  manager_category_scores jsonb,
  graded_by        uuid references auth.users (id) on delete set null,
  graded_at        timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint rep_grades_org_client_unique unique (organization_id, client_id),
  constraint rep_grades_period_known check (period in ('daily', 'weekly', 'monthly', 'quarterly')),
  constraint rep_grades_mode_known check (mode in ('manual', 'assisted', 'automatic')),
  constraint rep_grades_window_ordered check (period_end > period_start),
  constraint rep_grades_confidence_range
    check (ai_confidence is null or ai_confidence between 0 and 1),
  -- A manager grade without a person attached is unattributable, and an
  -- unattributable grade about somebody's work is worse than none.
  constraint rep_grades_manager_grade_attributed
    check (manager_letter is null or (graded_by is not null and graded_at is not null))
);

-- One live row per rep per period. Re-grading replaces it through the same
-- idempotent upsert everything else in this system uses.
create unique index if not exists rep_grades_one_per_period
  on rep_grades (organization_id, rep_id, period, period_start);

create index if not exists rep_grades_rep_idx on rep_grades (rep_id, period_start desc);
create index if not exists rep_grades_org_idx on rep_grades (organization_id, period_start desc);

comment on column rep_grades.ai_detail is
  'The whole computation as it ran: every category, the weights, the scale, the '
  'sample sizes and the confidence terms. Frozen, because the rubric will change '
  'and a grade from September must keep saying what it said in September.';

comment on column rep_grades.manager_letter is
  'The manager''s grade. Never written over the computed one, and never derived '
  'from it: a row with both is a manager who agreed, which is a different fact '
  'from a rubric that ran.';

-- ---------------------------------------------------------------------------
-- The computed grade cannot be edited
-- ---------------------------------------------------------------------------

create or replace function app.freeze_computed_grade()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.ai_detail is not null and (
       new.engine        is distinct from old.engine
    or new.ai_score      is distinct from old.ai_score
    or new.ai_letter     is distinct from old.ai_letter
    or new.ai_confidence is distinct from old.ai_confidence
    or new.ai_detail     is distinct from old.ai_detail
    or new.computed_at   is distinct from old.computed_at
    or new.period_start  is distinct from old.period_start
    or new.period_end    is distinct from old.period_end
    or new.rep_id        is distinct from old.rep_id
  ) then
    raise exception
      'a computed grade is a record of what the rubric said at the time: re-grade into a new period row instead of editing this one';
  end if;
  return new;
end $$;

drop trigger if exists rep_grades_freeze on rep_grades;
create trigger rep_grades_freeze
  before update on rep_grades
  for each row execute function app.freeze_computed_grade();

drop trigger if exists rep_grades_touch on rep_grades;
create trigger rep_grades_touch
  before update on rep_grades
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Every change, kept
-- ---------------------------------------------------------------------------

create table if not exists rep_grade_events (
  id              bigserial primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  grade_id        uuid not null,
  rep_id          uuid not null,
  action          text not null check (action in ('computed', 'graded', 'regraded', 'cleared')),
  actor           uuid,
  ai_letter       text,
  manager_letter  text,
  reason          text,
  occurred_at     timestamptz not null default now()
);

create index if not exists rep_grade_events_rep_idx
  on rep_grade_events (rep_id, occurred_at desc);
create index if not exists rep_grade_events_org_idx
  on rep_grade_events (organization_id, occurred_at desc);

comment on table rep_grade_events is
  'Who graded whom, when, and what changed. Written by trigger so a client that '
  'forgets cannot create a gap; readable by managers, writable by nobody.';

create or replace function app.log_rep_grade()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  what text;
begin
  if tg_op = 'INSERT' then
    what := case when new.manager_letter is not null then 'graded' else 'computed' end;
  elsif new.manager_letter is distinct from old.manager_letter then
    what := case
              when new.manager_letter is null then 'cleared'
              when old.manager_letter is null then 'graded'
              else 'regraded'
            end;
  else
    return new;
  end if;

  insert into rep_grade_events
    (organization_id, grade_id, rep_id, action, actor, ai_letter, manager_letter, reason)
  values
    (new.organization_id, new.id, new.rep_id, what,
     coalesce(new.graded_by, auth.uid()), new.ai_letter, new.manager_letter,
     new.manager_override_reason);
  return new;
end $$;

drop trigger if exists rep_grades_log on rep_grades;
create trigger rep_grades_log
  after insert or update on rep_grades
  for each row execute function app.log_rep_grade();

-- ---------------------------------------------------------------------------
-- Follow-up, which the performance engine needs and could not see
-- ---------------------------------------------------------------------------

create or replace view manager_lead_followups with (security_invoker = true) as
select
  l.id,
  l.organization_id,
  l.client_id       as lead_client_id,
  l.status::text    as lead_status,
  l.next_action_at,
  l.last_activity_at,
  l.opportunity_score,
  p.subdivision,
  p.address_line1
from leads l
join properties p on p.id = l.property_id
where l.deleted_at is null;

comment on view manager_lead_followups is
  'What each lead is waiting on. next_action_at is a date the REP set for '
  'themselves; a follow-up counted as done here means something was recorded '
  'after it came due, not that the conversation went well.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table grading_configs enable row level security;
alter table rep_grades enable row level security;
alter table rep_grade_events enable row level security;

drop policy if exists grading_configs_read on grading_configs;
create policy grading_configs_read on grading_configs
  for select using (organization_id in (select app.current_org_ids()));

-- How people are graded is a management decision, enforced here and not by
-- hiding a settings tab.
drop policy if exists grading_configs_manager_write on grading_configs;
create policy grading_configs_manager_write on grading_configs
  for all
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- A rep sees their own grade once a manager has entered one. Not the draft
-- suggestion: reading an unreviewed "C-" about yourself is a conversation
-- nobody chose to have.
drop policy if exists rep_grades_own_final_read on rep_grades;
create policy rep_grades_own_final_read on rep_grades
  for select
  using (
    rep_id = auth.uid()
    and manager_letter is not null
    and organization_id in (select app.current_org_ids())
  );

drop policy if exists rep_grades_manager_read on rep_grades;
create policy rep_grades_manager_read on rep_grades
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grades_manager_write on rep_grades;
create policy rep_grades_manager_write on rep_grades
  for insert with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grades_manager_update on rep_grades;
create policy rep_grades_manager_update on rep_grades
  for update
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

-- The log has no write policy at all, so only the trigger can add to it.
drop policy if exists rep_grade_events_manager_read on rep_grade_events;
create policy rep_grade_events_manager_read on rep_grade_events
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists rep_grade_events_own_read on rep_grade_events;
create policy rep_grade_events_own_read on rep_grade_events
  for select using (rep_id = auth.uid() and organization_id in (select app.current_org_ids()));

revoke all on manager_lead_followups from anon;
grant select on manager_lead_followups to authenticated;

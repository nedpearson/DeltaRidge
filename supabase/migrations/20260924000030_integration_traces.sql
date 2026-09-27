-- =============================================================================
-- 0030  One id that follows a piece of field work all the way through
-- =============================================================================
-- The question this answers is "what happened to this lead?", asked by a
-- manager on the phone while a rep stands in a driveway insisting they recorded
-- something. Today that question takes an afternoon and a database client.
--
-- Append-only, and enforced rather than promised: the trigger below refuses
-- UPDATE and DELETE from every role including the service role. A trace whose
-- history can be quietly rewritten is worth less than no trace at all, because
-- it invites being trusted.
--
-- Two clocks are kept, deliberately. `device_at` is when the rep's phone
-- believed something happened; `at` is when the server heard about it. They can
-- differ by hours — a phone with no signal in a truck all afternoon — and
-- collapsing them into one column destroys exactly the evidence needed to
-- explain a late-arriving knock.
--
-- Rollback:
--   drop view if exists lead_trace;
--   drop table if exists integration_traces cascade;
--   drop function if exists app.forbid_trace_rewrite();
-- =============================================================================

create table if not exists integration_traces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  -- Minted on the DEVICE at the moment the rep acted, not here. The interesting
  -- failures happen before the server ever hears about the work.
  trace_id        text not null,
  layer           text not null,
  step            text not null,
  outcome         text not null,

  lead_id         uuid references leads (id) on delete set null,
  entity          text,
  entity_id       text,

  -- One short human sentence. Never a payload, a token, or a homeowner.
  detail          text,

  actor           uuid references auth.users (id) on delete set null,
  device_at       timestamptz,
  at              timestamptz not null default now(),

  constraint integration_traces_layer_known check (layer in (
    'device', 'outbox', 'server', 'outbound', 'inbound'
  )),
  constraint integration_traces_outcome_known check (outcome in (
    'started', 'ok', 'refused', 'failed', 'unknown'
  )),
  -- A trace id is 'tr_' plus 16 Crockford base32 characters. Checked here so a
  -- malformed id cannot enter and quietly fail to join with anything.
  constraint integration_traces_id_shaped check (trace_id ~ '^tr_[0-9A-HJKMNP-TV-Z]{16}$'),
  constraint integration_traces_detail_short check (detail is null or length(detail) <= 200)
);

create index if not exists integration_traces_trace_idx
  on integration_traces (organization_id, trace_id, at);
create index if not exists integration_traces_lead_idx
  on integration_traces (lead_id, at desc) where lead_id is not null;
create index if not exists integration_traces_recent_idx
  on integration_traces (organization_id, at desc);
-- Finding the failures is the common query, so it gets its own partial index.
create index if not exists integration_traces_trouble_idx
  on integration_traces (organization_id, at desc) where outcome in ('failed', 'unknown');

comment on table integration_traces is
  'Append-only. What happened to a piece of field work, at every layer it '
  'passed through. Enforced immutable by app.forbid_trace_rewrite.';
comment on column integration_traces.device_at is
  'When the phone believed this happened. Differs from `at` by however long the '
  'device was offline, which is the evidence that explains a late knock.';

-- ---------------------------------------------------------------------------
-- Immutable, and not on the honour system
-- ---------------------------------------------------------------------------

create or replace function app.forbid_trace_rewrite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  raise exception
    'integration_traces is append-only; % is not permitted', lower(tg_op)
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists integration_traces_immutable on integration_traces;
create trigger integration_traces_immutable
  before update or delete on integration_traces
  for each row execute function app.forbid_trace_rewrite();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table integration_traces enable row level security;

drop policy if exists integration_traces_read on integration_traces;
create policy integration_traces_read on integration_traces
  for select using (organization_id in (select app.current_org_ids()));

-- A member may record what their own device did, and nothing else. `actor` is
-- pinned to the caller so one rep's phone cannot write steps in another's name.
drop policy if exists integration_traces_append on integration_traces;
create policy integration_traces_append on integration_traces
  for insert with check (
    organization_id in (select app.current_org_ids())
    and actor = auth.uid()
    and layer in ('device', 'outbox')
  );

-- No update policy and no delete policy exist, and the trigger above means even
-- adding one later would not make rewriting possible without a migration that
-- says so out loud.

-- ---------------------------------------------------------------------------
-- What happened to this lead
-- ---------------------------------------------------------------------------

create or replace view lead_trace with (security_invoker = true) as
select
  t.lead_id,
  t.trace_id,
  t.layer,
  t.step,
  t.outcome,
  t.detail,
  t.actor,
  t.device_at,
  t.at,
  -- How long the phone sat on this before the server heard. The number that
  -- explains most "it never synced" reports.
  case
    when t.device_at is null then null
    else extract(epoch from (t.at - t.device_at))
  end as carried_seconds,
  t.organization_id
from integration_traces t;

comment on view lead_trace is
  'Every step recorded against a lead, newest last when ordered by at. '
  'carried_seconds is how long the device held the work before the server saw it.';

revoke all on lead_trace from anon;
grant select on lead_trace to authenticated;

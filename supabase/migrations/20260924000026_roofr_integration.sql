-- =============================================================================
-- 0026  Roofr, through Zapier
-- =============================================================================
-- Delta Ridge stays the source of truth for everything it generates — storm
-- opportunities, property intelligence, routes, knocks, notes, scoring — and
-- Roofr stays the system of record for its own job, report and proposal
-- workflow. Neither overwrites the other's half.
--
-- WHAT THE INTEGRATION CAN ACTUALLY DO, verified 2026-09-24
--
-- Zapier exposes eight Roofr TRIGGERS (lead created, report ordered, proposal
-- sent / viewed / signed / lost / total adjusted, workflow stage changed) and
-- exactly one ACTION: Create Job and Customer. There is no search, no read, and
-- no update. That shapes this schema:
--
--   - Inbound is the reliable half, and it is append-only. Roofr tells us what
--     happened; we record it and never argue with it.
--   - Outbound can only ever CREATE. There is no way to update a Roofr job, so
--     a job is created once and after that Roofr owns it.
--   - There is no historical import. Nothing here pretends otherwise; the link
--     table starts empty and fills from the day the Zaps are switched on.
--
-- Roofr's own help page still describes the integration as one-way, Roofr to
-- elsewhere, while Zapier's directory lists the create action. The outbound
-- half is therefore built but gated: `roofr_settings.push_enabled` is false
-- until a real Zap has been seen to work, and nothing in the app turns it on
-- by itself.
--
-- Rollback:
--   drop table if exists roofr_outbox, roofr_events, roofr_links cascade;
--   drop table if exists roofr_settings cascade;
--   drop view if exists roofr_sync_log;
-- Nothing below alters or drops existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists roofr_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,

  -- Off until somebody proves the create action works on this account. An
  -- integration that silently starts writing to a live CRM the moment a
  -- migration lands is not a feature.
  push_enabled    boolean not null default false,
  -- Whether a qualifying lead goes automatically or waits for a manager tap.
  push_automatic  boolean not null default false,
  /*
   * When a Delta Ridge lead is considered worth a Roofr job.
   *
   * The default is deliberately late. Delta Ridge generates 150 doors a run;
   * pushing every raw storm lead would fill Roofr with canvassing records and
   * make it useless for the thing it is good at. A door becomes a Roofr job
   * when somebody has actually agreed to something.
   */
  push_threshold  text not null default 'inspection_scheduled',

  /*
   * Delta Ridge status -> Roofr workflow stage, as {"our_status": "their stage"}.
   *
   * Empty by default and it must stay that way until somebody has read the
   * stage names out of this company's own Roofr. Roofr workflow stages are
   * configurable per account, so a shipped default would be a guess about
   * somebody else's pipeline.
   */
  stage_map       jsonb not null default '{}'::jsonb,

  connected_at      timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  updated_by        uuid references auth.users (id) on delete set null,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint roofr_settings_threshold_known check (push_threshold in (
    'manual_only',
    'lead_created',
    'contacted',
    'interested',
    'inspection_scheduled',
    'manager_approved'
  )),
  constraint roofr_settings_stage_map_object check (jsonb_typeof(stage_map) = 'object')
);

comment on table roofr_settings is
  'How this organisation talks to Roofr. push_enabled is false until the create '
  'action has been proven on this account; nothing in the app turns it on.';

-- ---------------------------------------------------------------------------
-- The link between one lead and one Roofr job
-- ---------------------------------------------------------------------------

create table if not exists roofr_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid not null references leads (id) on delete cascade,

  -- Roofr's own ids, as they come back. Null until Roofr has created the job.
  roofr_customer_id text,
  roofr_job_id      text,
  /*
   * The ids WE sent, which Roofr stores as external ids.
   *
   * These are the deduplication key and the reason a retry cannot create a
   * second job: the same lead always sends the same external id, so a repeated
   * create is recognisable as a repeat. Matching on a homeowner's name would
   * merge two Smiths on the same street, which is how a CRM quietly loses a job.
   */
  external_customer_id text,
  external_job_id      text,

  -- Roofr's half of the record. Roofr wins on every column below; the app
  -- never writes them from its own state.
  workflow_stage      text,
  report_ordered_at   timestamptz,
  proposal_sent_at    timestamptz,
  proposal_viewed_at  timestamptz,
  proposal_signed_at  timestamptz,
  proposal_lost_at    timestamptz,
  proposal_total_cents bigint,

  -- Who worked it here. Kept so entering Roofr cannot cost a rep their
  -- attribution, which is what rep grading is computed from.
  originating_rep_id uuid references auth.users (id) on delete set null,

  last_event_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint roofr_links_one_per_lead unique (lead_id),
  constraint roofr_links_total_sane check (proposal_total_cents is null or proposal_total_cents >= 0)
);

create unique index if not exists roofr_links_job_unique
  on roofr_links (organization_id, roofr_job_id) where roofr_job_id is not null;
create unique index if not exists roofr_links_external_job_unique
  on roofr_links (organization_id, external_job_id) where external_job_id is not null;
create index if not exists roofr_links_org_idx on roofr_links (organization_id, updated_at desc);

comment on column roofr_links.external_job_id is
  'The id WE sent. Roofr stores it as the job''s external id, which makes a '
  'repeated create recognisable as a repeat rather than a second job.';

-- ---------------------------------------------------------------------------
-- Every event Roofr sent, kept
-- ---------------------------------------------------------------------------

create table if not exists roofr_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  /*
   * The id that makes a redelivery harmless.
   *
   * Zapier retries, and a Zap can be replayed by hand. Without a stable id per
   * event the same signed proposal becomes three timeline entries and the
   * manager dashboard counts it three times.
   */
  provider_event_id text not null,
  event_type        text not null,
  occurred_at       timestamptz,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,

  status            text not null default 'received',
  lead_id           uuid references leads (id) on delete set null,
  roofr_customer_id text,
  roofr_job_id      text,

  -- The payload is NOT stored. It carries homeowner PII through a third party
  -- and nothing downstream reads it; a hash is enough to spot a replay with
  -- changed contents.
  payload_hash      text,
  error             text,

  constraint roofr_events_unique_per_org unique (organization_id, provider_event_id),
  constraint roofr_events_status_known check (status in ('received', 'processed', 'ignored', 'failed')),
  constraint roofr_events_type_known check (event_type in (
    'lead_created',
    'report_ordered',
    'proposal_sent',
    'proposal_viewed',
    'proposal_signed',
    'proposal_lost',
    'proposal_total_adjusted',
    'workflow_stage_changed',
    'job_created'
  ))
);

create index if not exists roofr_events_org_time_idx
  on roofr_events (organization_id, received_at desc);
create index if not exists roofr_events_lead_idx
  on roofr_events (lead_id, received_at desc) where lead_id is not null;

comment on table roofr_events is
  'Append-only record of what Roofr said and when. The payload itself is not '
  'kept: it carries homeowner PII through a third party and nothing reads it '
  'after processing.';

-- ---------------------------------------------------------------------------
-- Outbound queue
-- ---------------------------------------------------------------------------

create table if not exists roofr_outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_id         uuid not null references leads (id) on delete cascade,

  action          text not null default 'create_job_and_customer',
  -- What was sent, minus anything not needed to retry it.
  payload         jsonb not null,
  external_job_id text not null,

  status          text not null default 'queued',
  attempts        integer not null default 0,
  last_error      text,
  next_attempt_at timestamptz,

  queued_by       uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  -- Not "sent". Roofr confirmed, by sending an event back with the ids.
  acknowledged_at timestamptz,

  constraint roofr_outbox_status_known check (status in (
    'queued', 'sent', 'acknowledged', 'failed', 'given_up', 'duplicate'
  )),
  constraint roofr_outbox_action_known check (action in ('create_job_and_customer'))
);

-- One live attempt per lead. A second tap on "create in Roofr" must not make a
-- second job, and this is the constraint rather than a disabled button.
create unique index if not exists roofr_outbox_one_open_per_lead
  on roofr_outbox (lead_id) where status in ('queued', 'sent');

create index if not exists roofr_outbox_org_idx on roofr_outbox (organization_id, created_at desc);

comment on column roofr_outbox.acknowledged_at is
  'Set only when Roofr has confirmed by sending an event back carrying the job '
  'id. "Sent to Zapier" is not "created in Roofr", and treating the first as '
  'the second is how a job goes missing with everything looking green.';

-- ---------------------------------------------------------------------------
-- The sync log, both directions in one place
-- ---------------------------------------------------------------------------

create or replace view roofr_sync_log with (security_invoker = true) as
select
  e.id,
  e.organization_id,
  'inbound'::text          as direction,
  e.event_type             as what,
  e.status,
  e.received_at            as at,
  e.lead_id,
  e.roofr_job_id,
  e.error,
  null::integer            as attempts
from roofr_events e
union all
select
  o.id,
  o.organization_id,
  'outbound'::text         as direction,
  o.action                 as what,
  o.status,
  o.created_at             as at,
  o.lead_id,
  null::text               as roofr_job_id,
  o.last_error             as error,
  o.attempts
from roofr_outbox o;

comment on view roofr_sync_log is
  'Both directions, newest first when ordered. security_invoker, so a rep sees '
  'what their organisation''s RLS lets them see.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table roofr_settings enable row level security;
alter table roofr_links enable row level security;
alter table roofr_events enable row level security;
alter table roofr_outbox enable row level security;

drop policy if exists roofr_settings_read on roofr_settings;
create policy roofr_settings_read on roofr_settings
  for select using (organization_id in (select app.current_org_ids()));

-- Connecting a CRM is a management decision, enforced here and not by hiding a
-- settings tab.
drop policy if exists roofr_settings_manager_write on roofr_settings;
create policy roofr_settings_manager_write on roofr_settings
  for all
  using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

drop policy if exists roofr_links_read on roofr_links;
create policy roofr_links_read on roofr_links
  for select using (organization_id in (select app.current_org_ids()));

-- Links are written by the Edge Function with the service role, which bypasses
-- RLS. No client write policy exists, so a phone cannot invent a Roofr job id.
drop policy if exists roofr_events_read on roofr_events;
create policy roofr_events_read on roofr_events
  for select using (organization_id in (select app.current_org_ids()));

drop policy if exists roofr_outbox_read on roofr_outbox;
create policy roofr_outbox_read on roofr_outbox
  for select using (organization_id in (select app.current_org_ids()));

-- A rep may ASK for a lead to go to Roofr; the Edge Function decides and sends.
drop policy if exists roofr_outbox_member_queue on roofr_outbox;
create policy roofr_outbox_member_queue on roofr_outbox
  for insert with check (
    organization_id in (select app.current_org_ids())
    and queued_by = auth.uid()
    and status = 'queued'
  );

drop trigger if exists roofr_links_touch on roofr_links;
create trigger roofr_links_touch
  before update on roofr_links
  for each row execute function app.touch_updated_at();

drop trigger if exists roofr_settings_touch on roofr_settings;
create trigger roofr_settings_touch
  before update on roofr_settings
  for each row execute function app.touch_updated_at();

revoke all on roofr_sync_log from anon;
grant select on roofr_sync_log to authenticated;

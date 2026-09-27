-- =============================================================================
-- 0006  Office handoff, integration sync, AI runs, audit
-- =============================================================================
-- The handoff is the product's payoff and its highest-risk operation: pushing to
-- CompanyCam creates a Roofr job through the bidirectional sync, so a double-tap
-- must not create a double job. Idempotency is enforced by `payload_hash` plus a
-- unique index on (provider, record_type, external_id), and every attempt is
-- recorded in sync_jobs whether it succeeded or not.
-- =============================================================================

create type handoff_status as enum (
  'draft', 'validating', 'ready', 'sending', 'sent', 'failed', 'superseded'
);

create table office_handoffs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  inspection_id   uuid not null references inspections (id) on delete cascade,
  property_id     uuid not null references properties (id) on delete cascade,
  customer_id     uuid references customers (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  status          handoff_status not null default 'draft',
  -- Frozen snapshot of everything sent to the office. The handoff must remain
  -- readable exactly as sent even after the underlying records change.
  package_payload jsonb,
  -- Stable hash of package_payload, used to detect a no-op resend.
  payload_hash    text,
  pdf_storage_path text,
  recommended_action text,
  -- Validation results at the moment of sending: what was missing and whether
  -- the rep waived it. This is the audit trail if the office later asks why a
  -- photo is absent.
  validation_result jsonb,
  -- Which route actually carried it: companycam | pdf_email | manual
  delivery_channel text,
  sent_at         timestamptz,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on office_handoffs (organization_id, status);
create index on office_handoffs (inspection_id, created_at desc);
-- One live handoff per inspection; earlier ones become 'superseded'.
create unique index office_handoffs_one_live on office_handoffs (inspection_id)
  where status in ('draft', 'validating', 'ready', 'sending');

create table integration_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,          -- companycam | roofr | hailtrace | mapbox
  display_name    text,
  is_enabled      boolean not null default false,
  -- Credentials are NEVER stored here. They live in Edge Function secrets.
  -- This table holds non-secret configuration and health only.
  config          jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_health_ok  boolean,
  last_health_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, provider)
);

-- Mapping between our canonical records and a third party's.
create table external_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,
  record_type     text not null,        -- project | photo | document | job | contact
  -- Our side.
  local_table     text not null,
  local_id        uuid not null,
  -- Their side.
  external_id     text,
  external_url    text,
  sync_status     text not null default 'pending',   -- pending | synced | failed | skipped
  payload_hash    text,
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The idempotency guarantee: one external record per local record per provider.
  unique (provider, record_type, local_table, local_id)
);

create unique index external_records_provider_external_id
  on external_records (provider, record_type, external_id)
  where external_id is not null;
create index on external_records (organization_id, sync_status) where sync_status <> 'synced';

create table sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  provider        text not null,
  operation       text not null,        -- create_project | upload_photo | upload_document
  local_table     text,
  local_id        uuid,
  handoff_id      uuid references office_handoffs (id) on delete cascade,
  -- Deduplication key: the same logical operation enqueued twice collapses.
  idempotency_key text not null,
  status          text not null default 'queued',  -- queued | running | succeeded | failed | dead
  attempt_count   smallint not null default 0,
  max_attempts    smallint not null default 5,
  next_attempt_at timestamptz not null default now(),
  request_payload jsonb,
  response_payload jsonb,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index on sync_jobs (status, next_attempt_at) where status in ('queued', 'failed');
create index on sync_jobs (handoff_id);

-- Every AI call, for cost visibility and for measuring whether assist helps.
create table ai_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,
  request_type    text not null,   -- photo_classify | quality_check | voice_structure | summary | handoff_narrative
  provider        text not null,
  model           text not null,
  prompt_version  text,
  subject_table   text,
  subject_id      uuid,
  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,
  estimated_cost_usd numeric(10, 6),
  -- Did the structured output pass Zod validation? A false here is a bug signal.
  schema_valid    boolean,
  error           text,
  created_at      timestamptz not null default now()
);

create index on ai_runs (organization_id, created_at desc);
create index on ai_runs (request_type, created_at desc);

-- Append-only audit log. No update or delete policy is granted to anyone.
create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete set null,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  subject_table   text,
  subject_id      uuid,
  before_state    jsonb,
  after_state     jsonb,
  ip_address      inet,
  created_at      timestamptz not null default now()
);

create index on audit_log (organization_id, created_at desc);
create index on audit_log (subject_table, subject_id, created_at desc);

create trigger touch_office_handoffs before update on office_handoffs for each row execute function app.touch_updated_at();
create trigger touch_integration_connections before update on integration_connections for each row execute function app.touch_updated_at();
create trigger touch_external_records before update on external_records for each row execute function app.touch_updated_at();
create trigger touch_sync_jobs before update on sync_jobs for each row execute function app.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['office_handoffs', 'integration_connections']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$
      create policy %1$s_org_access on %1$I
        for all
        using (organization_id in (select app.current_org_ids()))
        with check (organization_id in (select app.current_org_ids()))
    $p$, t);
  end loop;
end $$;

-- Sync plumbing and AI runs are readable by the org (the rep needs to see "sync
-- problem") but writable only by the service role running Edge Functions.
alter table external_records enable row level security;
alter table sync_jobs enable row level security;
alter table ai_runs enable row level security;
alter table audit_log enable row level security;

create policy external_records_read on external_records
  for select using (organization_id in (select app.current_org_ids()));
create policy sync_jobs_read on sync_jobs
  for select using (organization_id in (select app.current_org_ids()));
create policy ai_runs_read on ai_runs
  for select using (organization_id in (select app.current_org_ids()));
-- Audit log: readable by admins and managers only, and never mutable from the
-- client. Absence of INSERT/UPDATE/DELETE policies is intentional.
create policy audit_log_read on audit_log
  for select using (app.has_org_role(organization_id, array['admin', 'manager']::app_role[]));

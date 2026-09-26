-- =============================================================================
-- 0037  Lead acquisition attribution + appointment setter work queue
-- =============================================================================
-- Purpose:
--   1) preserve where a lead/intent signal came from;
--   2) deduplicate provider/webhook deliveries;
--   3) create a human-operable appointment-setter queue without auto-contacting
--      people who have not provided channel permission.
-- =============================================================================

create table if not exists lead_acquisition_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  lead_id             uuid references leads(id) on delete cascade,
  lead_client_id      text,
  campaign_id         uuid references campaigns(id) on delete set null,
  source_channel      text not null check (
    source_channel in (
      'door',
      'referral',
      'organic',
      'google_ads',
      'meta_ads',
      'roofcare',
      'partner',
      'manual',
      'import',
      'other'
    )
  ),
  event_type          text not null check (
    event_type in (
      'lead_created',
      'form_submitted',
      'callback_requested',
      'inspection_requested',
      'appointment_requested',
      'referral_received',
      'campaign_response',
      'qualified',
      'disqualified',
      'other'
    )
  ),
  external_lead_id    text,
  external_campaign_id text,
  external_ad_id      text,
  click_id            text,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid references auth.users(id) on delete set null
);

create unique index if not exists lead_acquisition_events_external_unique
  on lead_acquisition_events (organization_id, source_channel, external_lead_id)
  where external_lead_id is not null;

create index if not exists lead_acquisition_events_lead
  on lead_acquisition_events (organization_id, lead_id, occurred_at desc);

create unique index if not exists lead_acquisition_events_one_created_source
  on lead_acquisition_events (organization_id, lead_id, source_channel, event_type)
  where lead_id is not null and event_type = 'lead_created';

create index if not exists lead_acquisition_events_campaign
  on lead_acquisition_events (organization_id, campaign_id, occurred_at desc);

alter table lead_acquisition_events enable row level security;

create policy lead_acquisition_events_org_read
  on lead_acquisition_events for select
  using (organization_id in (select app.current_org_ids()));

create policy lead_acquisition_events_org_insert
  on lead_acquisition_events for insert
  with check (
    organization_id in (select app.current_org_ids())
    and created_by = auth.uid()
    and (
      source_channel in ('door','referral','manual','other')
      or app.has_org_role(organization_id, array['admin','manager','office']::app_role[])
    )
  );

create policy lead_acquisition_events_manager_update
  on lead_acquisition_events for update
  using (app.has_org_role(organization_id, array['admin','manager']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin','manager']::app_role[]));

create table if not exists lead_action_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  lead_id             uuid not null references leads(id) on delete cascade,
  assigned_to         uuid references auth.users(id) on delete set null,
  task_kind           text not null check (
    task_kind in (
      'call',
      'sms',
      'email',
      'door_visit',
      'confirm_identity',
      'book_inspection',
      'appointment_followup',
      'review_evidence',
      'manager_review'
    )
  ),
  status              text not null default 'open'
    check (status in ('open','in_progress','done','cancelled','blocked')),
  due_at              timestamptz,
  reason              text not null,
  blocked_reason      text,
  created_from        text not null default 'system'
    check (created_from in ('system','manager','rep','acquisition_event','integration')),
  acquisition_event_id uuid references lead_acquisition_events(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists lead_action_tasks_open
  on lead_action_tasks (organization_id, status, due_at)
  where status in ('open','in_progress','blocked');

create index if not exists lead_action_tasks_lead
  on lead_action_tasks (organization_id, lead_id, created_at desc);

alter table lead_action_tasks enable row level security;

create policy lead_action_tasks_org_read
  on lead_action_tasks for select
  using (organization_id in (select app.current_org_ids()));

create policy lead_action_tasks_org_insert
  on lead_action_tasks for insert
  with check (
    organization_id in (select app.current_org_ids())
    and (created_by is null or created_by = auth.uid())
  );

create policy lead_action_tasks_org_update
  on lead_action_tasks for update
  using (
    app.has_org_role(organization_id, array['admin','manager','office']::app_role[])
    or assigned_to = auth.uid()
  )
  with check (
    app.has_org_role(organization_id, array['admin','manager','office']::app_role[])
    or assigned_to = auth.uid()
  );

drop trigger if exists lead_action_tasks_touch_updated_at on lead_action_tasks;
create trigger lead_action_tasks_touch_updated_at
  before update on lead_action_tasks
  for each row execute function app.touch_updated_at();

-- One manager-facing rollup. This intentionally does not call quoted margin
-- "actual profit"; it just connects acquisition source to current CRM outcome.
create or replace view lead_source_outcomes
with (security_invoker = true)
as
select
  l.organization_id,
  coalesce(a.source_channel, 'other') as source_channel,
  count(distinct l.id) as leads,
  count(distinct l.id) filter (where l.status in ('appointment','inspected','proposal_pending','sold')) as progressed,
  count(distinct l.id) filter (where l.status = 'sold') as sold,
  min(a.occurred_at) as first_seen_at,
  max(a.occurred_at) as last_seen_at
from leads l
left join lateral (
  select e.source_channel, e.occurred_at
  from lead_acquisition_events e
  where e.organization_id = l.organization_id
    and (e.lead_id = l.id or (e.lead_id is null and e.lead_client_id = l.client_id))
  order by e.occurred_at asc
  limit 1
) a on true
where l.deleted_at is null
group by l.organization_id, coalesce(a.source_channel, 'other');

grant select on lead_source_outcomes to authenticated;

comment on table lead_acquisition_events is
  'Source/intent events behind a lead. Stores attribution identifiers and non-PII metadata; customer contact details remain on CRM records.';
comment on table lead_action_tasks is
  'Human appointment-setter/follow-up queue. A task is not permission to contact; channel compliance gates still apply at execution time.';
comment on view lead_source_outcomes is
  'Observed CRM progress by acquisition source. Descriptive history only; not a predictive close-rate model.';

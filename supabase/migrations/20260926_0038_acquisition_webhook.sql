-- =============================================================================
-- 0038  Acquisition webhook credential + intent-to-workflow trigger
-- =============================================================================
-- External lead sources may post to one canonical endpoint using a per-org
-- webhook token. Only the SHA-256 hash is stored.
--
-- High-intent inbound events create a HUMAN task. They do not send a call,
-- text, or email automatically and they do not create consent.
-- =============================================================================

create table if not exists acquisition_webhook_settings (
  organization_id     uuid primary key references organizations(id) on delete cascade,
  webhook_secret_hash text,
  webhook_secret_hint text,
  webhook_rotated_at  timestamptz,
  enabled             boolean not null default false,
  last_received_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table acquisition_webhook_settings enable row level security;

create policy acquisition_webhook_settings_manager_read
  on acquisition_webhook_settings for select
  using (app.has_org_role(organization_id, array['admin','manager']::app_role[]));

create policy acquisition_webhook_settings_admin_write
  on acquisition_webhook_settings for all
  using (app.has_org_role(organization_id, array['admin']::app_role[]))
  with check (app.has_org_role(organization_id, array['admin']::app_role[]));

drop trigger if exists acquisition_webhook_settings_touch on acquisition_webhook_settings;
create trigger acquisition_webhook_settings_touch
  before update on acquisition_webhook_settings
  for each row execute function app.touch_updated_at();

create or replace function app.create_action_task_from_acquisition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  task_kind_value text;
  task_reason text;
begin
  if new.lead_id is null then
    return new;
  end if;

  task_kind_value := case new.event_type
    when 'appointment_requested' then 'book_inspection'
    when 'inspection_requested' then 'book_inspection'
    when 'callback_requested' then 'appointment_followup'
    when 'form_submitted' then 'confirm_identity'
    when 'campaign_response' then 'confirm_identity'
    else null
  end;

  if task_kind_value is null then
    return new;
  end if;

  task_reason := case new.event_type
    when 'appointment_requested' then 'Homeowner requested an appointment through an inbound source.'
    when 'inspection_requested' then 'Homeowner requested a roof inspection through an inbound source.'
    when 'callback_requested' then 'Homeowner requested follow-up through an inbound source.'
    when 'form_submitted' then 'New inbound form needs identity and request review.'
    when 'campaign_response' then 'Campaign response needs human review and qualification.'
    else 'Inbound lead event needs review.'
  end;

  if not exists (
    select 1
    from lead_action_tasks t
    where t.organization_id = new.organization_id
      and t.lead_id = new.lead_id
      and t.status in ('open','in_progress','blocked')
      and t.task_kind = task_kind_value
      and t.acquisition_event_id = new.id
  ) then
    insert into lead_action_tasks (
      organization_id,
      lead_id,
      task_kind,
      status,
      due_at,
      reason,
      created_from,
      acquisition_event_id
    )
    values (
      new.organization_id,
      new.lead_id,
      task_kind_value,
      'open',
      now(),
      task_reason,
      'acquisition_event',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists lead_acquisition_event_create_task on lead_acquisition_events;
create trigger lead_acquisition_event_create_task
  after insert on lead_acquisition_events
  for each row execute function app.create_action_task_from_acquisition();

comment on table acquisition_webhook_settings is
  'Per-organization credential for external lead-source ingestion. Only a SHA-256 token hash is stored.';
comment on function app.create_action_task_from_acquisition() is
  'Creates a human review/booking task for high-intent inbound events. It never sends a communication or grants consent.';

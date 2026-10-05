begin;

create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelled', 'stale');

create table durable_jobs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    job_type text not null,
    payload jsonb not null default '{}'::jsonb,
    status job_status not null default 'queued',
    
    created_at timestamptz not null default now(),
    started_at timestamptz,
    heartbeat_at timestamptz,
    finished_at timestamptz,
    
    attempt_count int not null default 0,
    max_attempts int not null default 3,
    last_error text,
    next_retry_at timestamptz,
    
    created_by uuid references auth.users(id) on delete set null
);

create index idx_durable_jobs_org on durable_jobs(organization_id);
create index idx_durable_jobs_status on durable_jobs(status, next_retry_at);

alter table durable_jobs enable row level security;

create policy durable_jobs_manager on durable_jobs for all using (
    organization_id in (select app.current_org_ids()) and app.has_org_role(organization_id, array['admin', 'manager']::app_role[])
);
create policy durable_jobs_rep on durable_jobs for select using (
    organization_id in (select app.current_org_ids()) and created_by = auth.uid()
);

-- Phase 17: Omnichannel timeline
create or replace view omnichannel_timeline as
  select 
    m.id, 
    m.organization_id, 
    c.lead_id, 
    c.property_id, 
    'message' as event_type, 
    m.channel as subtype, 
    m.created_at, 
    m.direction, 
    m.content, 
    false as ai_generated, 
    m.status 
  from messages m
  join conversations c on c.id = m.conversation_id
  union all
  select 
    ca.id, 
    ca.organization_id, 
    c.lead_id, 
    c.property_id, 
    'call' as event_type, 
    null as subtype, 
    ca.created_at, 
    ca.direction, 
    ca.transcript as content, 
    false as ai_generated, 
    null as status 
  from calls ca
  join conversations c on c.id = ca.conversation_id
  union all
  select 
    a.id, 
    a.organization_id, 
    a.lead_id, 
    null as property_id, 
    'activity' as event_type, 
    a.activity_type as subtype, 
    a.created_at, 
    null as direction, 
    a.body as content, 
    false as ai_generated, 
    null as status 
  from activities a;

commit;




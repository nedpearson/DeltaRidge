-- PHASE 1: Database Schema & Compliance Ledger for the AI Revenue Engine

-- =====================================================================
-- TASK 1: Communications & Omnichannel Schema
-- =====================================================================

create table conversations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    lead_id uuid references leads(id) on delete cascade,
    property_id uuid references properties(id) on delete cascade,
    title text,
    status text not null default 'active' check (status in ('active', 'closed', 'snoozed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint conversations_parent_check check (
        (lead_id is not null) or (property_id is not null)
    )
);
create index on conversations(organization_id, lead_id);
create index on conversations(organization_id, property_id);

alter table conversations enable row level security;
create policy conversations_manager_all on conversations for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
create policy conversations_rep_assigned on conversations for all using (
    organization_id in (select app.current_org_ids()) and 
    lead_id in (select id from leads where assigned_to = auth.uid())
);

create table messages (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    conversation_id uuid not null references conversations(id) on delete cascade,
    channel text not null check (channel in ('sms', 'email', 'chat')),
    direction text not null check (direction in ('inbound', 'outbound')),
    status text not null default 'sent' check (status in ('pending', 'sent', 'delivered', 'failed', 'received', 'read')),
    content text not null,
    created_at timestamptz not null default now()
);
create index on messages(organization_id, conversation_id);

alter table messages enable row level security;
create policy messages_manager_all on messages for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
create policy messages_rep_assigned on messages for all using (
    organization_id in (select app.current_org_ids()) and 
    conversation_id in (
        select id from conversations where lead_id in (
            select id from leads where assigned_to = auth.uid()
        )
    )
);

create table calls (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    conversation_id uuid not null references conversations(id) on delete cascade,
    direction text not null check (direction in ('inbound', 'outbound')),
    duration_seconds integer,
    recording_url text,
    transcript text,
    created_at timestamptz not null default now()
);
create index on calls(organization_id, conversation_id);

alter table calls enable row level security;
create policy calls_manager_all on calls for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
create policy calls_rep_assigned on calls for all using (
    organization_id in (select app.current_org_ids()) and 
    conversation_id in (
        select id from conversations where lead_id in (
            select id from leads where assigned_to = auth.uid()
        )
    )
);

-- =====================================================================
-- TASK 2: Compliance & Consent Ledger
-- =====================================================================

create table contact_consents (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    lead_id uuid references leads(id) on delete cascade,
    contact_kind text not null check (contact_kind in ('phone', 'email')),
    contact_value text not null,
    channel text not null check (channel in ('sms', 'email', 'voice', 'all')),
    source text not null check (source in ('web_form', 'verbal', 'written', 'import')),
    opt_in_timestamp timestamptz not null default now(),
    ip_address text,
    user_agent text,
    created_at timestamptz not null default now(),
    constraint contact_consents_identity unique (organization_id, contact_kind, contact_value, channel)
);
create index on contact_consents(organization_id, lead_id);
create index on contact_consents(organization_id, contact_value);

alter table contact_consents enable row level security;
create policy contact_consents_read on contact_consents for select using (
    organization_id in (select app.current_org_ids())
);
create policy contact_consents_insert on contact_consents for insert with check (
    organization_id in (select app.current_org_ids())
);

-- Expand contact_suppressions
alter table contact_suppressions add column if not exists channel_blocked text not null default 'all' check (channel_blocked in ('sms', 'email', 'voice', 'mail', 'all'));
alter table contact_suppressions add column if not exists block_type text not null default 'opted_out' check (block_type in ('opted_out', 'dnc', 'spam_complaint', 'hard_bounce'));

-- We need to drop the unique constraint to include channel_blocked so we can have a DNC for voice and opted_out for SMS.
alter table contact_suppressions drop constraint if exists contact_suppressions_identity;
alter table contact_suppressions add constraint contact_suppressions_identity unique (organization_id, contact_kind, contact_value, channel_blocked);

create table campaign_enrollments (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    campaign_id uuid not null references campaigns(id) on delete cascade,
    lead_id uuid not null references leads(id) on delete cascade,
    status text not null default 'enrolled' check (status in ('enrolled', 'completed', 'paused', 'opted_out')),
    enrolled_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint campaign_enrollments_identity unique (organization_id, campaign_id, lead_id)
);
create index on campaign_enrollments(organization_id, campaign_id);
create index on campaign_enrollments(organization_id, lead_id);

alter table campaign_enrollments enable row level security;
create policy campaign_enrollments_manager on campaign_enrollments for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
create policy campaign_enrollments_rep on campaign_enrollments for all using (
    organization_id in (select app.current_org_ids()) and 
    lead_id in (select id from leads where assigned_to = auth.uid())
);

-- =====================================================================
-- TASK 3: Insurance Information & Carrier Directory
-- =====================================================================

create table insurance_carriers (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    claims_website text,
    claims_phone text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint insurance_carriers_name_key unique (name)
);

-- Note: insurance_carriers could be global or org-specific. We'll make it global (no org_id) or we add org_id if they are tenant specific.
-- Based on "Directory of official names", it sounds global, but usually everything in DeltaRidge has organization_id. Let's add organization_id to be safe.
alter table insurance_carriers add column organization_id uuid references organizations(id) on delete cascade;
-- Allow global ones with null organization_id
create index on insurance_carriers(organization_id);
alter table insurance_carriers enable row level security;
create policy insurance_carriers_read on insurance_carriers for select using (
    organization_id is null or organization_id in (select app.current_org_ids())
);

create table insurance_profiles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    lead_id uuid references leads(id) on delete cascade,
    property_id uuid references properties(id) on delete cascade,
    carrier_id uuid references insurance_carriers(id) on delete restrict,
    policy_number text,
    claim_number text,
    date_of_loss date,
    status text not null default 'UNKNOWN' check (status in ('VERIFIED', 'UNKNOWN', 'SELF_PAY')),
    homeowner_confirmed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint insurance_profiles_parent_check check (
        (lead_id is not null) or (property_id is not null)
    )
);
create index on insurance_profiles(organization_id, lead_id);
create index on insurance_profiles(organization_id, property_id);

alter table insurance_profiles enable row level security;
create policy insurance_profiles_manager on insurance_profiles for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
create policy insurance_profiles_rep on insurance_profiles for all using (
    organization_id in (select app.current_org_ids()) and 
    lead_id in (select id from leads where assigned_to = auth.uid())
);

-- =====================================================================
-- TASK 4: AI Telemetry
-- =====================================================================

create table ai_agent_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    agent_type text not null,
    model text not null,
    input_payload jsonb,
    output_payload jsonb,
    tokens_used integer,
    cost_cents integer,
    approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'auto_approved')),
    run_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index on ai_agent_runs(organization_id);

alter table ai_agent_runs enable row level security;
create policy ai_agent_runs_manager on ai_agent_runs for all using (
    organization_id in (select app.current_org_ids()) and app.is_manager()
);
-- Reps shouldn't usually view global telemetry, but maybe their own? We'll just grant to managers.

-- =============================================================================
-- DELTA RIDGE SOCIAL GROWTH OS - PHASE 1 FOUNDATION
-- =============================================================================
-- Establishes the underlying tables for social integrations, unified inbox, 
-- brand intelligence, and background processing.
-- =============================================================================

-- 1. Integration Tokens & Health (OAuth & Social Connectors)
create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  platform text not null check (platform in ('meta', 'google_business', 'tiktok', 'linkedin', 'youtube')),
  platform_account_id text not null,
  account_name text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes jsonb,
  is_active boolean default true,
  health_status text default 'healthy' check (health_status in ('healthy', 'degraded', 'disconnected', 'rate_limited')),
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  unique (organization_id, platform, platform_account_id)
);

create table if not exists social_webhooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  platform text not null,
  event_type text not null,
  payload jsonb not null,
  processing_status text default 'pending' check (processing_status in ('pending', 'processing', 'success', 'failed', 'dead_letter')),
  error_message text,
  retry_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Social Identity Resolution
create table if not exists social_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  platform text not null,
  platform_user_id text not null,
  platform_username text,
  display_name text,
  profile_url text,
  customer_id uuid references customers(id), -- Nullable until resolved
  confidence_score numeric(4,2), -- 0.00 to 100.00 mapping confidence
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, platform, platform_user_id)
);

-- 3. Unified Social Inbox
create table if not exists social_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  social_account_id uuid not null references social_accounts(id),
  social_profile_id uuid not null references social_profiles(id),
  lead_id uuid references leads(id),
  status text default 'open' check (status in ('open', 'snoozed', 'resolved', 'bot_handling')),
  intent_category text check (intent_category in ('emergency', 'hot', 'warm', 'storm', 'research', 'nurture', 'existing', 'unqualified')),
  assigned_to uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists social_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  conversation_id uuid not null references social_conversations(id),
  platform_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null check (message_type in ('text', 'image', 'video', 'system')),
  content text,
  attachments jsonb,
  is_ai_generated boolean default false,
  sent_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz default now(),
  unique (conversation_id, platform_message_id)
);

-- 4. Brand Brain (Content & Knowledge)
create table if not exists brand_knowledge (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  category text not null check (category in ('founder_story', 'faq', 'policy', 'tone', 'service_area', 'competitor_rule')),
  topic text not null,
  content text not null,
  is_approved boolean default true,
  approved_by uuid,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. Content Calendar & Creative Assets
create table if not exists creative_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  asset_type text not null check (asset_type in ('image', 'video', 'copy', 'template')),
  provenance text not null check (provenance in ('real_photo', 'ai_enhanced', 'ai_generated', 'stock')),
  url text,
  content text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists content_calendar (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  campaign_id uuid references marketing_campaigns(id),
  social_account_id uuid references social_accounts(id),
  creative_asset_id uuid references creative_assets(id),
  post_type text not null check (post_type in ('organic', 'paid', 'story', 'reel', 'short', 'google_update')),
  content_pillar text check (content_pillar in ('education', 'founder', 'project', 'review', 'storm', 'community', 'offer', 'team')),
  status text default 'draft' check (status in ('draft', 'awaiting_approval', 'scheduled', 'published', 'failed')),
  scheduled_for timestamptz,
  published_at timestamptz,
  platform_post_id text,
  performance_metrics jsonb, -- e.g. impressions, clicks, attributed_revenue
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 6. Social Autonomy Controls (Kill Switches & Config)
create table if not exists social_autonomy_config (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  auto_post_approved boolean default false,
  auto_respond_basic boolean default false,
  auto_book_appointments boolean default false,
  auto_launch_storm_campaigns boolean default false,
  max_daily_ad_spend integer default 0,
  require_approval_negative_reviews boolean default true,
  master_kill_switch boolean default false, -- If true, ALL outbound automated social halts
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id)
);

-- =============================================================================
-- RLS Policies
-- =============================================================================

alter table social_accounts enable row level security;
create policy social_accounts_org_access on social_accounts
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table social_webhooks enable row level security;
create policy social_webhooks_org_access on social_webhooks
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table social_profiles enable row level security;
create policy social_profiles_org_access on social_profiles
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table social_conversations enable row level security;
create policy social_conversations_org_access on social_conversations
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table social_messages enable row level security;
create policy social_messages_org_access on social_messages
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table brand_knowledge enable row level security;
create policy brand_knowledge_org_access on brand_knowledge
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table creative_assets enable row level security;
create policy creative_assets_org_access on creative_assets
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table content_calendar enable row level security;
create policy content_calendar_org_access on content_calendar
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

alter table social_autonomy_config enable row level security;
create policy social_autonomy_config_org_access on social_autonomy_config
  for all using (organization_id in (select app.current_org_ids()))
  with check (organization_id in (select app.current_org_ids()));

-- Webhook Retry RPC
create or replace function increment_webhook_retry(webhook_id uuid, error_msg text) returns void as $$
begin
  update social_webhooks
  set processing_status = case when retry_count >= 3 then 'dead_letter' else 'pending' end,
      error_message = error_msg,
      retry_count = retry_count + 1,
      updated_at = now()
  where id = webhook_id;
end;
$$ language plpgsql;

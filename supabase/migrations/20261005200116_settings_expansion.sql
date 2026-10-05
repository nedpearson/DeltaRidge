-- =============================================================================
-- Migration: Full Settings Control Plane Expansion
-- =============================================================================

alter table organization_settings
  add column if not exists leads_settings jsonb not null default '{"assignment_mode": "manual", "stale_lead_days": 14}'::jsonb,
  add column if not exists communications_settings jsonb not null default '{"enable_sms": false, "enable_email": true, "business_hours_only": true}'::jsonb,
  add column if not exists notifications_settings jsonb not null default '{"notify_on_new_lead": true, "notify_on_storm": true, "notify_on_failed_job": true}'::jsonb,
  add column if not exists insurance_settings jsonb not null default '{"allow_document_upload": true, "require_human_review": true}'::jsonb,
  add column if not exists privacy_settings jsonb not null default '{"retention_days": 365}'::jsonb,
  add column if not exists security_settings jsonb not null default '{"require_mfa": false, "session_timeout_minutes": 120}'::jsonb;

-- Add constraints
alter table organization_settings
  add constraint leads_settings_schema check (jsonb_typeof(leads_settings) = 'object'),
  add constraint communications_settings_schema check (jsonb_typeof(communications_settings) = 'object'),
  add constraint notifications_settings_schema check (jsonb_typeof(notifications_settings) = 'object'),
  add constraint insurance_settings_schema check (jsonb_typeof(insurance_settings) = 'object'),
  add constraint privacy_settings_schema check (jsonb_typeof(privacy_settings) = 'object'),
  add constraint security_settings_schema check (jsonb_typeof(security_settings) = 'object');


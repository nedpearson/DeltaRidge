-- =============================================================================
-- 0027  The credential the Zapier webhook presents
-- =============================================================================
-- The inbound endpoint has to answer two questions about every request: is this
-- really from our Zap, and which organisation is it for. One secret answers
-- both, so the token IS the organisation's identity and there is no org id in
-- the URL for somebody to change.
--
-- Only the hash is stored. The token is generated in the browser, shown to the
-- person once, and never recoverable — not by support, not by an admin, not by
-- reading this table. A hint (last four characters) exists so somebody can tell
-- which token is in a Zap without being able to reconstruct it.
--
-- No salt, deliberately: the token is 32 bytes of CSPRNG output, so there is no
-- dictionary to defend against, and a salt would only prevent the endpoint from
-- finding the row by hash in one indexed lookup.
--
-- Rollback:
--   alter table roofr_settings
--     drop column if exists webhook_secret_hash,
--     drop column if exists webhook_secret_hint,
--     drop column if exists webhook_rotated_at;
-- =============================================================================

alter table roofr_settings
  add column if not exists webhook_secret_hash text,
  add column if not exists webhook_secret_hint text,
  add column if not exists webhook_rotated_at timestamptz;

create unique index if not exists roofr_settings_webhook_hash_unique
  on roofr_settings (webhook_secret_hash) where webhook_secret_hash is not null;

comment on column roofr_settings.webhook_secret_hash is
  'SHA-256 of the bearer token the Zap sends, hex, lowercase. The token itself '
  'is never stored anywhere and cannot be recovered.';
comment on column roofr_settings.webhook_secret_hint is
  'Last four characters, so a person can identify a token without holding it.';

ALTER TABLE social_accounts
ADD COLUMN IF NOT EXISTS connection_status text DEFAULT 'connected',
ADD COLUMN IF NOT EXISTS token_status text DEFAULT 'valid',
ADD COLUMN IF NOT EXISTS last_successful_publish timestamptz,
ADD COLUMN IF NOT EXISTS last_error text,
ADD COLUMN IF NOT EXISTS webhook_state text DEFAULT 'active';

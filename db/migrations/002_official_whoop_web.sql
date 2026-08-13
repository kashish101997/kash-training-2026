ALTER TABLE integration_oauth_states
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'strava';

CREATE INDEX IF NOT EXISTS integration_oauth_states_provider_expiry
  ON integration_oauth_states(provider, expires_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_leases (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  lease_id uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  PRIMARY KEY (account_id, provider)
);

CREATE TABLE IF NOT EXISTS integration_sync_state (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_tokens_provider_account
  ON oauth_tokens(provider, account_id);

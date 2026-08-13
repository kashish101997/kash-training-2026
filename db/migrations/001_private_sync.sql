CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_entities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  entity_id text NOT NULL,
  revision bigint NOT NULL,
  tombstone boolean NOT NULL DEFAULT false,
  encrypted_payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  sequence bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  entity_id text NOT NULL,
  revision bigint NOT NULL,
  tombstone boolean NOT NULL DEFAULT false,
  encrypted_payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_changes_account_sequence ON sync_changes(account_id, sequence);

CREATE TABLE IF NOT EXISTS sync_mutations (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mutation_id uuid NOT NULL,
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
  state_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_account_id text,
  encrypted_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, provider)
);

CREATE TABLE IF NOT EXISTS integration_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  event_kind text NOT NULL,
  encrypted_payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS integration_events_retry ON integration_events(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS integration_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_id text NOT NULL,
  external_id text,
  status text NOT NULL,
  encrypted_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  actor_kind text NOT NULL,
  action text NOT NULL,
  entity_kind text,
  entity_id text,
  revision bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);


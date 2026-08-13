-- Kash OS uses the existing encrypted sync entity/change tables for practices,
-- Health Shortcut samples, and push subscriptions. This migration only adds
-- indexes that keep daily practice and source-UUID lookups fast.
CREATE INDEX IF NOT EXISTS sync_entities_kind_updated
  ON sync_entities(account_id, kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entity_lookup
  ON audit_log(account_id, entity_kind, entity_id, created_at DESC);

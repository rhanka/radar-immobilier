-- L3 (immo #861) — atomic finalization coordination (spec r2 §3.1 A4).
--
-- Additive only: no ALTER/DROP of existing objects. Two coordinator-owned
-- tables. artifacts.operation_keys is the per-key serialization row keyed by
-- (storage_scope_id, internal_key); it carries no success or authorization
-- assertion. artifacts.operation_receipts holds exactly one success row per
-- (storage_scope_id, internal_key) with the command codec, command hash and
-- receipt; the primary key is the uniqueness fence. This migration is
-- distinct from artifacts.idempotency_keys, whose success-row count MUST
-- stay unchanged after a denial. The host applies this file through its
-- existing journal after 0002_lifecycle.sql.

CREATE TABLE IF NOT EXISTS artifacts.operation_keys (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, internal_key)
);

CREATE TABLE IF NOT EXISTS artifacts.operation_receipts (
  storage_scope_id TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  command_codec TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (storage_scope_id, internal_key)
);
-- Radar-owned policy fencing and provisional quota accounting.
CREATE TABLE IF NOT EXISTS artifacts.host_policy (
  storage_scope_id TEXT PRIMARY KEY REFERENCES artifacts.storage_scopes(id),
  revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts.host_quotas (
  storage_scope_id TEXT PRIMARY KEY REFERENCES artifacts.storage_scopes(id),
  operation_limit BIGINT NOT NULL CHECK (operation_limit >= 0),
  byte_limit BIGINT NOT NULL CHECK (byte_limit >= 0),
  operations_used BIGINT NOT NULL DEFAULT 0 CHECK (operations_used >= 0),
  bytes_used BIGINT NOT NULL DEFAULT 0 CHECK (bytes_used >= 0)
);
CREATE TABLE IF NOT EXISTS artifacts.host_failures (
  invocation_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  reason TEXT NOT NULL,
  status INTEGER NOT NULL,
  at_ms BIGINT NOT NULL
);

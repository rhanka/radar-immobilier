-- L12 (artefacts-ouverture) — per-actor durable ceilings and the shared
-- per-minute bound (conception §2/§3 L1).
--
-- Additive only: no ALTER/DROP of existing objects. The coordinator-owned
-- artifacts.host_actor_quotas holds one durable ceiling row per
-- (storage_scope_id, actor_id); the row auto-provisions from the global
-- host_quotas row on first commit, so no manual step per user is required,
-- and a missing global row provisions nothing (the commit stays blocked).
-- artifacts.host_actor_rate holds one counter row per
-- (storage_scope_id, actor_id, window_start) for the shared per-minute bound;
-- attempts are reserved before S3 in autocommit and never refunded; stale
-- windows are deleted by admission, independently of durable commit quotas.
-- Replayable: every
-- statement is IF NOT EXISTS / ON CONFLICT guarded.
CREATE TABLE IF NOT EXISTS artifacts.host_actor_quotas (
  storage_scope_id TEXT NOT NULL REFERENCES artifacts.storage_scopes(id),
  actor_id TEXT NOT NULL,
  operation_limit BIGINT NOT NULL CHECK (operation_limit >= 0),
  byte_limit BIGINT NOT NULL CHECK (byte_limit >= 0),
  operations_used BIGINT NOT NULL DEFAULT 0 CHECK (operations_used >= 0),
  bytes_used BIGINT NOT NULL DEFAULT 0 CHECK (bytes_used >= 0),
  PRIMARY KEY (storage_scope_id, actor_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.host_actor_rate (
  storage_scope_id TEXT NOT NULL REFERENCES artifacts.storage_scopes(id),
  actor_id TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (storage_scope_id, actor_id, window_start)
);

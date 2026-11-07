-- Live invitations (A-LIVE v2 S07, plan r3.1 Δ4), immo-owned: explicit,
-- revocable, session- and generation-bound invited live readers of one
-- personal git binding. Rows grant reading only (live_read, live_status and
-- the content-host live gate), never editing or publication, and never touch
-- artifacts.artifact_access (the artifacts access enum is not widened).
-- Additive only; rows are kept after revocation or expiry for audit.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.live_invitations (
  invitation_id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation > 0),
  live_session_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  grantor_id TEXT NOT NULL CHECK (grantor_id <> invitee_id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  revoked_at TIMESTAMPTZ NULL,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts (id, storage_scope_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS live_invitations_by_binding
  ON artifacts.live_invitations (storage_scope_id, artifact_id, binding_generation, invitee_id);

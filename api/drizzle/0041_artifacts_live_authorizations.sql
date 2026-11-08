-- Live authorizations (A-LIVE §8.2, W9 s-archi 2026-11-07), immo-owned: the
-- session-bound live authorization record the content-host live gate
-- requires in addition to the baskets reader consent (necessary, not
-- sufficient). One row per (session, generation, principal, invitation):
-- the binding owner's row is created on the first admitted live open, an
-- invitee's row only on explicit acceptance. A row is void when the
-- controller names another session or generation, on revocation and, for an
-- invitee, at the invitation expiry. It grants no data right and never
-- touches artifacts.artifact_access. Additive only; rows are kept for audit.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.live_authorizations (
  authorization_id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  session_id TEXT NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  binding_generation BIGINT NOT NULL CHECK (binding_generation > 0),
  principal_id TEXT NOT NULL CHECK (principal_id <> ''),
  role TEXT NOT NULL CHECK (role IN ('binding_owner', 'invitee')),
  invitation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CHECK ((role = 'binding_owner' AND invitation_id = '' AND expires_at IS NULL)
    OR (role = 'invitee' AND invitation_id <> '' AND expires_at IS NOT NULL)),
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts (id, storage_scope_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS live_authorizations_by_session
  ON artifacts.live_authorizations (storage_scope_id, artifact_id, session_id, binding_generation, principal_id, invitation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS live_authorizations_by_invitation
  ON artifacts.live_authorizations (storage_scope_id, artifact_id, invitation_id);

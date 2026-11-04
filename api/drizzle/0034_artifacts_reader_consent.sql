-- Reader consent LOT 1 (immo side of generic 0008_reader_consent.sql):
-- persistent reader consent rows, one per (scope, reader, artifact, scope,
-- version). A live row plus fresh rights authorizes the opening bypass; rows
-- never record data use (no basket identifier, no query, no page data, no
-- session/device/network data). Revocation keeps history: re-grant after
-- revoke mints a new row. Additive only: IF NOT EXISTS guards, no nullable
-- owner column participates in uniqueness, storage_scope_id is part of every
-- unique key so isolation is structural.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.reader_consents (
  consent_id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  reader_account_id TEXT NOT NULL,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  scope_id TEXT NOT NULL,
  scope_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_via TEXT NOT NULL DEFAULT 'reader_screen' CHECK (granted_via = 'reader_screen'),
  revoked_at TIMESTAMPTZ NULL,
  revoked_by TEXT NULL CHECK (revoked_by IN ('self', 'admin', 'cascade'))
);
--> statement-breakpoint
-- At most one live row per (scope, reader, artifact, scope, version);
-- re-grant after revoke mints a new row, history stays auditable.
CREATE UNIQUE INDEX IF NOT EXISTS reader_consents_live_uniq ON artifacts.reader_consents
  (storage_scope_id, reader_account_id, artifact_id, scope_id, scope_version)
  WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reader_consents_by_reader ON artifacts.reader_consents
  (storage_scope_id, reader_account_id, granted_at, consent_id);
--> statement-breakpoint
-- Append-only audit, no content (actor, surface and version only).
CREATE TABLE IF NOT EXISTS artifacts.reader_consent_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consent_id UUID NOT NULL,
  storage_scope_id TEXT NOT NULL,
  reader_account_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  scope_id TEXT NOT NULL,
  scope_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  actor TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('screen', 'api', 'mcp', 'cascade')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reader_consent_events_by_artifact ON artifacts.reader_consent_events
  (storage_scope_id, artifact_id, id);

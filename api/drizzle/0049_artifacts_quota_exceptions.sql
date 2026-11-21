-- AQX — admin-managed artifact quota exceptions.
--
-- Additive only: no ALTER/DROP of existing objects. Two radar-owned tables.
-- artifacts.host_actor_page_text_exceptions holds at most one page-text
-- budget exception per (storage_scope_id, actor_id): the per-file and
-- per-release page-text ceiling (HTML/CSS/JS/JSON) granted to that actor,
-- capped by the hard system maximum of 10 MiB (10485760 bytes). An expired
-- row grants nothing; absence means the 5 MiB default applies.
-- artifacts.host_quota_admin_events is the append-only audit trail of every
-- admin quota action (who, when, old/new values, reason). Replayable: every
-- statement is IF NOT EXISTS guarded.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.host_actor_page_text_exceptions (
  storage_scope_id TEXT NOT NULL REFERENCES artifacts.storage_scopes (id),
  actor_id TEXT NOT NULL,
  max_bytes BIGINT NOT NULL CHECK (max_bytes > 0 AND max_bytes <= 10485760),
  expires_at TIMESTAMPTZ NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  PRIMARY KEY (storage_scope_id, actor_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.host_quota_admin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_scope_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  admin_sub TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('actor_quota', 'scope_quota', 'page_text_exception',
    'expire_open_uploads')),
  old_values JSONB NULL,
  new_values JSONB NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS host_quota_admin_events_by_actor
  ON artifacts.host_quota_admin_events (storage_scope_id, actor_id, created_at);

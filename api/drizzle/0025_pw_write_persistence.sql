-- PW-D write persistence: intents, single-use challenges, key reservations,
-- receipt links, tombstones, authority fences, quota ledger, audit, outbox.
CREATE TABLE IF NOT EXISTS pw_write_intents (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invocation_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  operation text NOT NULL CHECK (operation IN (
    'facets.signals.personal.select.v1', 'facets.signals.personal.deselect.v1',
    'facets.signals.personal.discard.v1', 'facets.signals.personal.restore.v1',
    'facets.signals.workspace.discard.v1', 'facets.signals.workspace.restore.v1')),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  principal jsonb NOT NULL,
  artifact_ref jsonb NOT NULL,
  authority_references jsonb NOT NULL,
  challenge_key_id text NOT NULL CHECK (challenge_key_id <> ''),
  page_session_id text NOT NULL CHECK (page_session_id <> ''),
  page_instance_id text NOT NULL CHECK (page_instance_id <> ''),
  grant_reference text NOT NULL CHECK (grant_reference <> ''),
  city_slug text NOT NULL CHECK (city_slug <> ''),
  target jsonb NOT NULL,
  command jsonb NOT NULL,
  operation_digest text NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  command_key uuid NOT NULL,
  expected_projection_token text NOT NULL CHECK (expected_projection_token ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  execution_state text NOT NULL DEFAULT 'pending' CHECK (execution_state IN (
    'pending', 'committed', 'rejected', 'expired')),
  challenge_id text NOT NULL UNIQUE CHECK (challenge_id ~ '^[a-f0-9]{64}$'),
  challenge_state text NOT NULL DEFAULT 'pending' CHECK (challenge_state IN ('pending', 'consumed')),
  consumed_at timestamptz,
  revoked_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_key_reservations (
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  intent_id uuid NOT NULL UNIQUE REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  operation_digest text NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, command_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pw_write_intents_actor_key_idx ON pw_write_intents (actor_id, command_key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_receipt_links (
  intent_id uuid PRIMARY KEY REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_id, command_key) REFERENCES facet_commands(owner_id, command_key) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_intent_tombstones (
  intent_id uuid PRIMARY KEY REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 512)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_authority_fences (
  kind text NOT NULL CHECK (kind IN (
    'tier', 'grant', 'reader', 'page_session', 'delegation', 'release', 'policy')),
  reference text NOT NULL CHECK (reference <> '' AND char_length(reference) <= 512),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 512),
  PRIMARY KEY (kind, reference)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_quota_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('attempt', 'admission', 'prepare', 'status')),
  bucket text NOT NULL CHECK (bucket <> '' AND char_length(bucket) <= 512),
  intent_id uuid REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pw_write_quota_ledger_bucket_idx ON pw_write_quota_ledger (kind, bucket, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  intent_id uuid NOT NULL REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  invocation_id uuid NOT NULL,
  command_id uuid,
  operation text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  target jsonb,
  scope text CHECK (scope IS NULL OR scope IN ('personal', 'workspace')),
  artifact_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  grant_ref text,
  principal jsonb NOT NULL,
  operation_digest text NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  intent_digest text CHECK (intent_digest IS NULL OR intent_digest ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN (
    'committed', 'replay_denied', 'denied', 'unknown', 'receipt_read', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pw_write_audit_intent_idx ON pw_write_audit (intent_id, decided_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pw_write_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES pw_write_intents(intent_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('write_committed', 'write_revoked', 'write_rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pw_write_outbox_pending_idx ON pw_write_outbox (created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint

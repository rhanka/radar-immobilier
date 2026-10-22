-- 6J lot destination, commands and preserved history. Additive only.
-- New tables: destination gate, import runs/evidence, lot capability
-- grants/events. Existing tables, indexes and triggers are untouched
-- except widening named checks that would otherwise forbid lot streams
-- and lot events; every statement below is replayable on a schema that
-- already has it. Signal rows keep their exact historical guarantees:
-- every widened predicate preserves the previous behavior when
-- target_type = 'signal'. prospect_marks is not modified.
CREATE TABLE IF NOT EXISTS lot_destination_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  selection_basket text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_lot_destination_state_basket CHECK (
    enabled = false OR (selection_basket IS NOT NULL AND selection_basket <> ''))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lot_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  import_key uuid NOT NULL,
  manifest_sha text NOT NULL CHECK (manifest_sha ~ '^[a-f0-9]{64}$'),
  mapping_version text NOT NULL CHECK (mapping_version <> ''),
  importer_version text NOT NULL CHECK (importer_version <> ''),
  source_snapshot_id text NOT NULL CHECK (source_snapshot_id ~ '^[a-f0-9]{64}$'),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'complete' CHECK (status = 'complete'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lot_import_runs_workspace_key UNIQUE (workspace_id, import_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lot_source_rows (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK (source_id <> ''),
  chain_id text NOT NULL CHECK (chain_id <> ''),
  native_target text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('mapped', 'conflict', 'unresolved', 'pending')),
  diagnostics text[] NOT NULL DEFAULT '{}',
  destination jsonb,
  observed jsonb NOT NULL,
  manifest_sha text NOT NULL CHECK (manifest_sha ~ '^[a-f0-9]{64}$'),
  import_run_id uuid REFERENCES lot_import_runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_id)
);
CREATE INDEX IF NOT EXISTS lot_source_rows_chain_idx
  ON lot_source_rows (workspace_id, chain_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lot_capability_grants (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  capability text NOT NULL CHECK (capability IN ('lot_select', 'lot_pipeline', 'lot_market')),
  granted boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> '' AND char_length(reason) <= 512),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_id, capability)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lot_capability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  capability text NOT NULL CHECK (capability IN ('lot_select', 'lot_pipeline', 'lot_market')),
  kind text NOT NULL CHECK (kind IN ('capability_granted', 'capability_revoked')),
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lot_capability_events_workspace_idx
  ON lot_capability_events (workspace_id, created_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_lot_capability_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lot capability events are append-only';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER lot_capability_events_immutable
  BEFORE UPDATE OR DELETE ON lot_capability_events FOR EACH ROW EXECUTE FUNCTION guard_lot_capability_event();
CREATE OR REPLACE TRIGGER lot_capability_events_no_truncate
  BEFORE TRUNCATE ON lot_capability_events FOR EACH STATEMENT EXECUTE FUNCTION guard_lot_capability_event();
--> statement-breakpoint
-- Import-only archive reason provenance. Ordinary writers never use it.
INSERT INTO facet_reason_codes (profile_id, code, verdict) VALUES
  ('lot-import-v1', 'legacy-unknown', 'non_pertinent')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

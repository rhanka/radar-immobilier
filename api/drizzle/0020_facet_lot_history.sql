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
-- Lot event columns. All nullable so existing signal rows are unaffected.
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS mode text;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS observed_lot_version uuid;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS asking_price numeric(14,2);
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS listing_url text;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS pipeline_status text;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS source_author text;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS source_created_at timestamptz;
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS import_run_id uuid
  REFERENCES lot_import_runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Widen event checks: signal behavior preserved, lot rules added.
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS facet_events_target_type_check;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS facet_events_node_type_check;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS facet_events_facet_check;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS chk_facet_events_basket;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS chk_facet_events_classified_reason;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS chk_facet_events_workspace_archive_6i;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_target_lot_6j') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_target_lot_6j CHECK (
      (target_type = 'signal' AND node_type IN ('Signal', 'DesignationEvent')
        AND mode IS NULL AND observed_lot_version IS NULL
        AND asking_price IS NULL AND listing_url IS NULL AND pipeline_status IS NULL
        AND source_author IS NULL AND source_created_at IS NULL AND import_run_id IS NULL)
      OR (target_type = 'lot' AND node_type = 'Lot' AND node_id <> ''
        AND mode IS NOT NULL AND mode IN ('real', 'simulation') AND observed_lot_version IS NOT NULL
        AND (scope = 'workspace' OR facet = 'archive')));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_facet_lot_6j') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_facet_lot_6j CHECK (
      (target_type = 'signal' AND facet IN ('selection', 'archive'))
      OR (target_type = 'lot' AND facet IN ('selection', 'archive', 'pipeline', 'market')));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_basket') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_basket CHECK (
      (target_type = 'signal' AND ((facet = 'selection' AND basket IS NOT NULL AND basket IN ('pertinent', 'a_surveiller'))
        OR (facet = 'archive' AND basket IS NULL)))
      OR (target_type = 'lot' AND ((facet = 'selection' AND basket IS NOT NULL AND basket <> '')
        OR (facet IN ('archive', 'pipeline', 'market') AND basket IS NULL))));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_classified_reason') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_classified_reason CHECK (
      (target_type = 'signal' AND ((profile_id IS NULL AND reason_code IS NULL AND verdict IS NULL)
        OR (profile_id IS NOT NULL AND reason_code IS NOT NULL AND verdict IS NOT NULL
          AND ((facet = 'selection' AND verdict = basket) OR (facet = 'archive' AND verdict = 'non_pertinent')))))
      OR (target_type = 'lot' AND (
        (facet IN ('selection', 'pipeline', 'market') AND profile_id IS NULL AND reason_code IS NULL AND verdict IS NULL)
        OR (facet = 'archive' AND profile_id IS NOT NULL AND reason_code IS NOT NULL AND verdict IS NOT NULL AND verdict = 'non_pertinent'
          AND ((profile_id = 'lot-import-v1' AND reason_code = 'legacy-unknown' AND import_run_id IS NOT NULL)
            OR profile_id <> 'lot-import-v1')))));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_workspace_archive_6i') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_workspace_archive_6i CHECK (
      scope <> 'workspace'
      OR (target_type = 'signal' AND facet = 'archive' AND basket IS NULL)
      OR (target_type = 'lot' AND facet IN ('selection', 'archive', 'pipeline', 'market')));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_market_6j') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_market_6j CHECK (
      target_type <> 'lot'
      OR (facet = 'market' AND pipeline_status IS NULL
        AND (asking_price IS NULL OR (asking_price >= 0.01 AND asking_price <= 999999999999.99))
        AND (state <> 'inactive' OR (asking_price IS NULL AND listing_url IS NULL)))
      OR (facet = 'pipeline' AND asking_price IS NULL AND listing_url IS NULL
        AND ((state = 'inactive' AND pipeline_status IS NULL)
          OR (state = 'active' AND pipeline_status IS NOT NULL AND pipeline_status IN ('sollicite', 'lettre_envoyee'))))
      OR (facet IN ('selection', 'archive') AND asking_price IS NULL AND listing_url IS NULL
        AND pipeline_status IS NULL));
  END IF;
END $$;
--> statement-breakpoint
-- Lot streams carry an explicit mode; signal streams keep mode null.
ALTER TABLE facet_streams ADD COLUMN IF NOT EXISTS mode text;
--> statement-breakpoint
ALTER TABLE facet_streams DROP CONSTRAINT IF EXISTS facet_streams_target_type_check;
--> statement-breakpoint
ALTER TABLE facet_streams DROP CONSTRAINT IF EXISTS facet_streams_node_type_check;
--> statement-breakpoint
ALTER TABLE facet_streams DROP CONSTRAINT IF EXISTS facet_streams_facet_check;
--> statement-breakpoint
ALTER TABLE facet_streams DROP CONSTRAINT IF EXISTS chk_facet_streams_basket;
--> statement-breakpoint
ALTER TABLE facet_streams DROP CONSTRAINT IF EXISTS facet_streams_identity_key;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_streams_target_lot_6j') THEN
    ALTER TABLE facet_streams ADD CONSTRAINT chk_facet_streams_target_lot_6j CHECK (
      (target_type = 'signal' AND node_type IN ('Signal', 'DesignationEvent') AND mode IS NULL)
      OR (target_type = 'lot' AND node_type = 'Lot' AND mode IS NOT NULL AND mode IN ('real', 'simulation')
        AND (scope = 'workspace' OR facet = 'archive')));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_streams_facet_lot_6j') THEN
    ALTER TABLE facet_streams ADD CONSTRAINT chk_facet_streams_facet_lot_6j CHECK (
      (target_type = 'signal' AND facet IN ('selection', 'archive'))
      OR (target_type = 'lot' AND facet IN ('selection', 'archive', 'pipeline', 'market')));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_streams_basket') THEN
    ALTER TABLE facet_streams ADD CONSTRAINT chk_facet_streams_basket CHECK (
      (facet = 'selection' AND basket IS NOT NULL AND basket <> ''
        AND ((target_type = 'signal' AND basket IN ('pertinent', 'a_surveiller')) OR target_type = 'lot'))
      OR (facet = 'archive' AND basket IS NULL)
      OR (target_type = 'lot' AND facet IN ('pipeline', 'market') AND basket IS NULL));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facet_streams_identity_key') THEN
    ALTER TABLE facet_streams ADD CONSTRAINT facet_streams_identity_key UNIQUE NULLS NOT DISTINCT
      (workspace_id, scope, owner_id, target_type, mode, city_slug, node_type, node_id, facet, basket);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facet_events_lot_target_idx
  ON facet_events (city_slug, node_type, node_id)
  WHERE target_type = 'lot' AND superseded_by IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facet_events_lot_import_idx
  ON facet_events (import_run_id) WHERE import_run_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_lot_source_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lot source evidence is immutable';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER lot_source_rows_immutable
  BEFORE UPDATE OR DELETE ON lot_source_rows FOR EACH ROW EXECUTE FUNCTION guard_lot_source_evidence();
CREATE OR REPLACE TRIGGER lot_source_rows_no_truncate
  BEFORE TRUNCATE ON lot_source_rows FOR EACH STATEMENT EXECUTE FUNCTION guard_lot_source_evidence();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_lot_stream_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM facet_events e JOIN facet_streams s ON s.id = NEW.stream_id
      WHERE e.id = NEW.event_id AND e.mode IS DISTINCT FROM s.mode
  ) THEN
    RAISE EXCEPTION 'lot stream mode mismatch';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_bindings_mode
  BEFORE INSERT ON facet_event_bindings FOR EACH ROW EXECUTE FUNCTION guard_lot_stream_mode();

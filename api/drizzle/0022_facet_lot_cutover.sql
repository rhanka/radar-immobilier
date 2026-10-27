-- 6K guarded lot cutover and legacy-write protection. Additive only.
-- New tables: per-workspace cutover state, append-only cutover events,
-- explicit D5 dispositions recorded against a manifest, and source-writer
-- coverage attestations. A database fence blocks legacy prospect_marks
-- writes while a cutover barrier is committed or the destination is open.
-- No legacy row is modified; prospect_notes and contacts are untouched.
-- Every statement below is replayable on a schema that already has it.
CREATE TABLE IF NOT EXISTS lot_cutover_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  maintenance_barrier boolean NOT NULL DEFAULT false,
  destination_open boolean NOT NULL DEFAULT false,
  manifest_sha text CHECK (manifest_sha IS NULL OR manifest_sha ~ '^[a-f0-9]{64}$'),
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_lot_cutover_open_implies_barrier CHECK (
    destination_open = false OR maintenance_barrier = true)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lot_cutover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN (
    'commit-barrier', 'stop-publishers', 'close-readers', 'destroy-buffers',
    'recompute-manifest', 'reconcile-heads', 'switch-authority',
    'verify-reads', 'open-destination', 'd5-dispositions')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lot_cutover_events_workspace_idx
  ON lot_cutover_events (workspace_id, created_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_lot_cutover_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lot cutover events are append-only';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER lot_cutover_events_immutable
  BEFORE UPDATE OR DELETE ON lot_cutover_events FOR EACH ROW EXECUTE FUNCTION guard_lot_cutover_events();
CREATE OR REPLACE TRIGGER lot_cutover_events_no_truncate
  BEFORE TRUNCATE ON lot_cutover_events FOR EACH STATEMENT EXECUTE FUNCTION guard_lot_cutover_events();
--> statement-breakpoint
-- Explicit D5 dispositions: one decision per conflicted target recorded
-- against the exact manifest digest. Immutable: a new manifest or a
-- revised decision is a new row set, never an overwrite.
CREATE TABLE IF NOT EXISTS lot_d5_dispositions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  manifest_sha text NOT NULL CHECK (manifest_sha ~ '^[a-f0-9]{64}$'),
  target_key text NOT NULL CHECK (target_key <> '' AND char_length(target_key) <= 512),
  decision text NOT NULL CHECK (decision IN ('activate', 'keep-pending')),
  source_id text CHECK (source_id IS NULL OR (source_id <> '' AND char_length(source_id) <= 512)),
  reason text NOT NULL CHECK (reason <> '' AND char_length(reason) <= 1024),
  recorded_by uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, manifest_sha, target_key),
  CONSTRAINT chk_lot_d5_activate_names_head CHECK (
    decision <> 'activate' OR source_id IS NOT NULL)
);
--> statement-breakpoint
-- Replay guard: a pre-constraint 0022 row set gains the column lazily.
ALTER TABLE lot_d5_dispositions ADD COLUMN IF NOT EXISTS source_id text
  CHECK (source_id IS NULL OR (source_id <> '' AND char_length(source_id) <= 512));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_lot_d5_dispositions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lot D5 dispositions are immutable';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER lot_d5_dispositions_immutable
  BEFORE UPDATE OR DELETE ON lot_d5_dispositions FOR EACH ROW EXECUTE FUNCTION guard_lot_d5_dispositions();
CREATE OR REPLACE TRIGGER lot_d5_dispositions_no_truncate
  BEFORE TRUNCATE ON lot_d5_dispositions FOR EACH STATEMENT EXECUTE FUNCTION guard_lot_d5_dispositions();
--> statement-breakpoint
-- Source-writer coverage attestations: every supported lot_versions writer
-- must be recorded as covered before 6K activation. Seeded uncovered;
-- deployment qualifies each writer against the serialization protocol.
CREATE TABLE IF NOT EXISTS lot_source_writer_coverage (
  writer text PRIMARY KEY CHECK (writer <> '' AND char_length(writer) <= 256),
  covered boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 1024)
);
--> statement-breakpoint
INSERT INTO lot_source_writer_coverage (writer, covered, reason) VALUES
  ('geo/ogc-pull', false, 'seeded uncovered by 0022'),
  ('geo/populate-geo', false, 'seeded uncovered by 0022'),
  ('exploitation/projection', false, 'seeded uncovered by 0022')
ON CONFLICT (writer) DO NOTHING;
--> statement-breakpoint
-- Legacy-write fence: while any workspace holds a committed barrier or an
-- open destination, no legacy prospect_marks row may be inserted or
-- updated. The route layer maps this to 503 (barrier) or 410 (retired);
-- this trigger is the backstop, including for direct writers.
CREATE TABLE IF NOT EXISTS lot_legacy_fence (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO lot_legacy_fence(singleton) VALUES (true) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_prospect_marks_cutover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fenced boolean;
BEGIN
  -- Lock an existing row: old repeatable-read writers get a serialization
  -- failure instead of missing a barrier inserted after their snapshot.
  SELECT enabled INTO STRICT fenced FROM lot_legacy_fence WHERE singleton FOR SHARE;
  IF fenced OR EXISTS (SELECT 1 FROM lot_cutover_state WHERE maintenance_barrier OR destination_open) THEN
    RAISE EXCEPTION 'lot_legacy_store_fenced:prospect_marks';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prospect_marks_cutover_fence ON prospect_marks;
--> statement-breakpoint
CREATE TRIGGER prospect_marks_cutover_fence
  BEFORE INSERT OR UPDATE OR DELETE ON prospect_marks FOR EACH ROW EXECUTE FUNCTION guard_prospect_marks_cutover();
CREATE OR REPLACE TRIGGER prospect_marks_cutover_no_truncate
  BEFORE TRUNCATE ON prospect_marks FOR EACH STATEMENT EXECUTE FUNCTION guard_prospect_marks_cutover();

-- Lot I2 (converged-r2 §2.1/§2.2 + owner Q1–Q3): G1 three-mode ACL, immo side.
--
-- access_mode becomes authoritative for reader evaluation. Legacy
-- is_public=true maps to 'platform', NEVER 'public' (zero artifacts become
-- anonymous through this migration). The named local CHECK closes the wide
-- audience to ('restricted','platform'): even a row written outside the API
-- can never turn anonymous. Public stays OFF with no code: no allowPublicSharing
-- capability exists in the immo profile and no SharingPolicyPort is
-- provided, so both locks of the generic double lock stay closed.
--
-- Full mirror of @sentropic/artifacts 0006_sharing.sql, adapted to the
-- closed immo belt (no 'public' value): append-only artifact_access_events
-- audit (same transaction as the set_access mutation), deterministic dedupe
-- of legacy multi-source grants, one-source-per-artifact unique index and
-- the two Q1 schema guards (source only in restricted mode, no widening
-- while a source grant lives). Object names are identical to the generic
-- migration so both apply idempotently in any order.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'restricted'
    CHECK (access_mode IN ('restricted', 'platform'));
--> statement-breakpoint
UPDATE artifacts.artifacts SET access_mode = 'platform' WHERE is_public = true AND access_mode = 'restricted';
--> statement-breakpoint
-- Deterministic local belt as a NAMED constraint, separate from the ADD
-- COLUMN above: if the column already exists (generic 0006 applied first,
-- whose inline CHECK allows 'public'), the ADD COLUMN is a no-op but this
-- block still enforces ('restricted','platform'). Multiple CHECKs AND, so a
-- pre-existing wider generic CHECK can never reopen 'public' here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_access_mode_immo_check') THEN
    ALTER TABLE artifacts.artifacts
      ADD CONSTRAINT artifacts_access_mode_immo_check CHECK (access_mode IN ('restricted', 'platform'));
  END IF;
END;
$$;
--> statement-breakpoint
-- Append-only access audit events (same transaction as the mutation).
CREATE TABLE IF NOT EXISTS artifacts.artifact_access_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  audience TEXT NOT NULL CHECK (audience IN ('user', 'platform', 'public')),
  principal_id TEXT,
  policy_revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS access_events_by_artifact ON artifacts.artifact_access_events (artifact_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION artifacts.reject_access_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: artifact_access_events is immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS artifact_access_events_append_only ON artifacts.artifact_access_events;
--> statement-breakpoint
CREATE TRIGGER artifact_access_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON artifacts.artifact_access_events
  FOR EACH STATEMENT EXECUTE FUNCTION artifacts.reject_access_event_mutation();
--> statement-breakpoint
-- Deterministic dedupe of legacy multi-source artifacts (see generic 0006
-- header): the oldest `source` grant per artifact stays `source`; later
-- duplicates demote to `read`. No row is deleted; ties on created_at break
-- on principal_id.
UPDATE artifacts.artifact_access AS dup
SET permission = 'read'
WHERE dup.permission = 'source'
  AND EXISTS (
    SELECT 1
    FROM artifacts.artifact_access AS keep
    WHERE keep.artifact_id = dup.artifact_id
      AND keep.permission = 'source'
      AND (keep.created_at, keep.principal_id) < (dup.created_at, dup.principal_id)
  );
--> statement-breakpoint
-- Owner Q1, schema level: at most one collab (source) grant per artifact.
CREATE UNIQUE INDEX IF NOT EXISTS artifact_access_one_source
  ON artifacts.artifact_access (artifact_id) WHERE permission = 'source';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION artifacts.reject_source_outside_restricted() RETURNS trigger AS $$
DECLARE
  current_mode TEXT;
BEGIN
  IF NEW.permission = 'source' THEN
    SELECT access_mode INTO current_mode FROM artifacts.artifacts WHERE id = NEW.artifact_id;
    IF current_mode IS DISTINCT FROM 'restricted' THEN
      RAISE EXCEPTION 'source grant requires restricted mode (artifact % is %)', NEW.artifact_id, current_mode;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS artifact_access_source_guard ON artifacts.artifact_access;
--> statement-breakpoint
CREATE TRIGGER artifact_access_source_guard
  BEFORE INSERT OR UPDATE OF permission ON artifacts.artifact_access
  FOR EACH ROW EXECUTE FUNCTION artifacts.reject_source_outside_restricted();
--> statement-breakpoint
-- Owner Q1, schema level: no mode widening while a collab (source) grant exists.
CREATE OR REPLACE FUNCTION artifacts.reject_widening_with_source_grant() RETURNS trigger AS $$
BEGIN
  IF (OLD.access_mode = 'restricted' AND NEW.access_mode IN ('platform', 'public'))
     OR (OLD.access_mode = 'platform' AND NEW.access_mode = 'public') THEN
    IF EXISTS (SELECT 1 FROM artifacts.artifact_access
               WHERE artifact_id = NEW.id AND permission = 'source') THEN
      RAISE EXCEPTION 'cannot widen access_mode of artifact % while a source grant exists', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS artifacts_widening_source_guard ON artifacts.artifacts;
--> statement-breakpoint
CREATE TRIGGER artifacts_widening_source_guard
  BEFORE UPDATE OF access_mode ON artifacts.artifacts
  FOR EACH ROW EXECUTE FUNCTION artifacts.reject_widening_with_source_grant();

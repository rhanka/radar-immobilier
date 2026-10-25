-- 6K cutover source protection: fence lot_versions writes while a cutover
-- barrier is committed and the destination is still closed. prospect_marks
-- is already fenced (legacy store retired); lot_versions is the live source
-- after opening, so this fence applies only to the barrier window:
-- maintenance_barrier committed, destination not yet open. A source writer
-- adding a version (even without marks) can no longer change the manifest
-- between reconciliation and opening, which removes the drift that used to
-- deadlock resume on idempotency_key_conflict. Old-snapshot writers take a
-- serialization failure on the fenced singleton instead of missing a
-- barrier committed after their snapshot. Every statement below is
-- replayable on a schema that already has it.
CREATE OR REPLACE FUNCTION guard_lot_versions_cutover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocked boolean;
BEGIN
  -- Lock the existing fence row: pre-barrier repeatable-read writers get
  -- a serialization failure instead of missing a barrier committed after
  -- their snapshot.
  PERFORM 1 FROM lot_legacy_fence WHERE singleton FOR SHARE;
  SELECT EXISTS (
    SELECT 1 FROM lot_cutover_state
    WHERE maintenance_barrier AND NOT destination_open
  ) INTO blocked;
  IF blocked THEN
    RAISE EXCEPTION 'lot_cutover_sources_fenced:lot_versions';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS lot_versions_cutover_fence ON lot_versions;
--> statement-breakpoint
CREATE TRIGGER lot_versions_cutover_fence
  BEFORE INSERT OR UPDATE OR DELETE ON lot_versions FOR EACH ROW EXECUTE FUNCTION guard_lot_versions_cutover();
CREATE OR REPLACE TRIGGER lot_versions_cutover_no_truncate
  BEFORE TRUNCATE ON lot_versions FOR EACH STATEMENT EXECUTE FUNCTION guard_lot_versions_cutover();

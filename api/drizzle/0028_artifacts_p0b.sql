-- @sentropic/artifacts P0b (0.2.5 or 0.3.0) terminal controls plus IMMO's trusted confirmation port.
ALTER TABLE artifacts.artifacts ADD COLUMN IF NOT EXISTS terminal_deleted_at TIMESTAMPTZ;
ALTER TABLE artifacts.artifacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE artifacts.artifacts ALTER COLUMN updated_at SET DEFAULT now();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION artifacts.reject_terminal_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.terminal_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'terminal artifact' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.terminal_deleted_at IS NOT NULL AND
    (NEW.terminal_deleted_at IS DISTINCT FROM OLD.terminal_deleted_at OR NEW.lifecycle_state NOT IN ('deleted', 'purged')
      OR NEW.renewed_at IS DISTINCT FROM OLD.renewed_at) THEN
    RAISE EXCEPTION 'terminal artifact' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER terminal_restore_guard BEFORE UPDATE ON artifacts.artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_restore();
CREATE TRIGGER terminal_identity_guard BEFORE DELETE ON artifacts.artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_restore();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION artifacts.reject_terminal_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM artifacts.artifacts WHERE id = NEW.artifact_id AND terminal_deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'terminal artifact' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER terminal_release_guard BEFORE INSERT ON artifacts.releases
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_publication();
CREATE TRIGGER terminal_pointer_guard BEFORE INSERT OR UPDATE ON artifacts.artifact_current
FOR EACH ROW EXECUTE FUNCTION artifacts.reject_terminal_publication();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION artifacts.record_publication_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE artifacts.artifacts SET updated_at = NEW.created_at WHERE id = NEW.artifact_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER publication_updated_at AFTER INSERT ON artifacts.releases
FOR EACH ROW EXECUTE FUNCTION artifacts.record_publication_update();
--> statement-breakpoint
CREATE TABLE artifacts.delete_confirmations (
  confirmation_ref UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL REFERENCES artifacts.storage_scopes(id),
  actor_id TEXT NOT NULL,
  -- Requested while the provider holds the artifact lock; no cross-transaction FK wait.
  artifact_id UUID NOT NULL,
  expected_release_id UUID,
  command_hash TEXT NOT NULL,
  internal_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storage_scope_id, internal_key, command_hash)
);

-- 6I workspace archive and moderator controls. Additive only.
-- Allows facet_events rows in workspace scope with a null business owner,
-- attributed to the acting moderator. Shared signal events stay
-- archive-only with a null basket. Existing tables, indexes, triggers,
-- and the 0018 stream authority are untouched; every statement below is
-- replayable on a schema that already has it.
ALTER TABLE facet_events ALTER COLUMN owner_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS chk_facet_events_actor_owner;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_actor_owner') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_actor_owner CHECK (
      (scope <> 'personal' OR (owner_id IS NOT NULL AND actor_id = owner_id))
      AND (scope <> 'workspace' OR (owner_id IS NULL AND actor_id IS NOT NULL)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS facet_events_scope_check;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facet_events_scope_check') THEN
    ALTER TABLE facet_events ADD CONSTRAINT facet_events_scope_check
      CHECK (scope IN ('personal', 'workspace'));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_facet_events_workspace_archive_6i') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_workspace_archive_6i CHECK (
      scope <> 'workspace' OR (facet = 'archive' AND basket IS NULL AND target_type = 'signal'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facet_events_workspace_archive_idx
  ON facet_events (city_slug, node_type, node_id)
  WHERE scope = 'workspace' AND facet = 'archive' AND state = 'active' AND superseded_by IS NULL;

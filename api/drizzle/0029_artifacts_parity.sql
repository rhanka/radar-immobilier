-- @sentropic/artifacts 0.2.6 migrations/0005_metadata.sql, additive only.
-- Policy activation is deliberately separate: applying schema keeps P0b active.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.artifacts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE artifacts.releases ADD COLUMN IF NOT EXISTS author_principal_id TEXT;
ALTER TABLE artifacts.releases ADD COLUMN IF NOT EXISTS parent_release_id UUID;
ALTER TABLE artifacts.releases ADD COLUMN IF NOT EXISTS reverted_from_release_id UUID;

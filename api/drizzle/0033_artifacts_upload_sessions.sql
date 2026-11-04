-- Lot files-parity (immo side of generic 0007_uploads.sql): durable upload
-- sessions bound to their artifact, storage scope and owner, with expires_at
-- for the enforced staging sweeper, plus the staged-file records that
-- commit_upload writes and publish_bundle references.
--
-- 0015 created artifacts.uploads as an ephemeral staging ledger (id,
-- max_size, size, mime_type, state, created_at) with no artifact binding and
-- no expiry. This migration ALTERs it instead of recreating it, mirroring
-- the generic 0007. Pre-existing rows belong to the never-wired append
-- surface: they are discarded (not deleted) so no stale session stays open.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.uploads
  ADD COLUMN IF NOT EXISTS artifact_id UUID REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS storage_scope_id TEXT REFERENCES artifacts.storage_scopes (id),
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
--> statement-breakpoint
-- Pre-existing rows have no artifact binding: close them, keep the audit trail.
UPDATE artifacts.uploads SET state = 'discarded' WHERE artifact_id IS NULL;
--> statement-breakpoint
-- 'expired' is set by the sweeper when expires_at passes with the session open.
-- The 0015 column CHECK auto-names to uploads_state_check; replace it.
ALTER TABLE artifacts.uploads DROP CONSTRAINT IF EXISTS uploads_state_check;
--> statement-breakpoint
ALTER TABLE artifacts.uploads
  ADD CONSTRAINT uploads_state_check CHECK (state IN ('open', 'committed', 'discarded', 'expired'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS uploads_by_expiry ON artifacts.uploads (state, expires_at)
  WHERE state = 'open';
--> statement-breakpoint
-- Staged files: one row per committed upload, referenced by publish_bundle
-- assets ({path, uploadId}). The blob itself is content-addressed under
-- artifacts/<scope>/blobs/sha256/<hex>; this row carries the manifest path.
CREATE TABLE IF NOT EXISTS artifacts.staged_files (
  upload_id UUID PRIMARY KEY REFERENCES artifacts.uploads (id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES artifacts.artifacts (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, path)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS staged_files_by_artifact ON artifacts.staged_files (artifact_id);

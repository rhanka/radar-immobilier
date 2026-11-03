-- Migration 0030: prod -> preprod admission sync (lot I1, converged R2 §2.6).
--
-- Preprod-side readable state only. Prod emits signed Ed25519 admission
-- snapshots (built from prod public.account_users, minimal identity fields);
-- preprod ingests them read-only. Nothing here connects to prod, and nothing
-- here writes towards prod.
--
--   account_users.admission_source IN ('local','prod_sync'): marks rows that
--     mirror a prod admission. Local preprod accounts ('local') are never
--     overwritten by the sync; only 'prod_sync' rows are status-propagated.
--   admission_sync_profiles: staging of the last verified snapshot per email
--     (email stored lowercased as PK, display form preserved separately).
--   admission_sync_state: per-key replay guard (monotonic issued_at).

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE account_users
  ADD COLUMN IF NOT EXISTS admission_source TEXT NOT NULL DEFAULT 'local';
--> statement-breakpoint
ALTER TABLE account_users
  DROP CONSTRAINT IF EXISTS account_users_admission_source_check;
--> statement-breakpoint
ALTER TABLE account_users
  ADD CONSTRAINT account_users_admission_source_check
  CHECK (admission_source IN ('local', 'prod_sync'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS account_users_prod_sync_email_uniq
  ON account_users (lower(email)) WHERE admission_source = 'prod_sync' AND email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admission_sync_profiles (
  email TEXT PRIMARY KEY,
  email_display TEXT,
  name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admission_sync_state (
  kid TEXT PRIMARY KEY,
  issued_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entries INT NOT NULL DEFAULT 0
);

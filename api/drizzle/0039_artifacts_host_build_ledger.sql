-- SG4b host build ledger (A-LIVE v2 §8.3-8.4, design D0), immo-owned: the
-- persisted G0 v3 §2.6 build job with its monotonic attempt fence, and the
-- host-signed handoff receipt stored under the job key in the SAME
-- transaction as the release, git release index and binding baseline.
-- Additive, replay-idempotent; no row is written while the git mode flag is off.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.host_build_jobs (
  job_id UUID PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  repo_id TEXT NOT NULL,
  branch TEXT NOT NULL CHECK (branch LIKE 'artifact/%'),
  sub_path TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation > 0),
  expected_current_release_id UUID NULL,
  executor TEXT NOT NULL CHECK (executor = 'sandbox'),
  requested_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('build_pending', 'building', 'published', 'build_failed', 'cancelled')),
  fence_run_id TEXT NULL,
  fence_attempt INTEGER NULL CHECK (fence_attempt IS NULL OR fence_attempt > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((fence_run_id IS NULL) = (fence_attempt IS NULL)),
  UNIQUE (storage_scope_id, requested_by, idempotency_key),
  FOREIGN KEY (artifact_id, storage_scope_id) REFERENCES artifacts.artifacts (id, storage_scope_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS host_build_jobs_by_artifact ON artifacts.host_build_jobs (storage_scope_id, artifact_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifacts.host_build_receipts (
  job_key TEXT PRIMARY KEY,
  storage_scope_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  job_id UUID NOT NULL REFERENCES artifacts.host_build_jobs (job_id),
  release_id UUID NOT NULL REFERENCES artifacts.releases (id),
  nonce TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- Pending-build reconciliation (@sentropic/artifacts 0.2.25): audit columns
-- for the terminal failure of a host build job. The package reconciler stamps
-- them through the job-store port (`markFailed`); the builder failure code is
-- also kept on the git binding `stateDetail` by the package store.
-- Additive, replay-idempotent; no row is written while the git mode flag is off.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.host_build_jobs ADD COLUMN IF NOT EXISTS code TEXT NULL;
--> statement-breakpoint
ALTER TABLE artifacts.host_build_jobs ADD COLUMN IF NOT EXISTS reason TEXT NULL;

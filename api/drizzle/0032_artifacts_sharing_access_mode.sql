-- Lot I2 (converged-r2 §2.1/§2.2 + owner Q1–Q3): G1 three-mode ACL, immo side.
--
-- access_mode becomes authoritative for reader evaluation. Legacy
-- is_public=true maps to 'platform', NEVER 'public' (zero artifacts become
-- anonymous through this migration). The CHECK closes the wide audience to
-- ('restricted','platform'): even a row written outside the API can never
-- turn anonymous. Public stays OFF with no code: no allowPublicSharing
-- capability exists in the immo profile and no SharingPolicyPort is
-- provided, so both locks of the generic double lock stay closed.
-- Nominative grants in artifacts.artifact_access coexist untouched.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE artifacts.artifacts
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'restricted'
    CHECK (access_mode IN ('restricted', 'platform'));
--> statement-breakpoint
UPDATE artifacts.artifacts SET access_mode = 'platform' WHERE is_public = true AND access_mode = 'restricted';

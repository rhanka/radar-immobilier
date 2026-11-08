-- Drop the immo live invitation table of 0038 (A-LIVE v2, #1030), empty on
-- every environment: live invitations become GENERIC in @sentropic/artifacts
-- 0.2.22 (package migration 0013_live_invitations creates its own
-- artifacts.live_invitations and artifacts.live_invitation_epochs, with a
-- column guard that refuses any other schema under the same name). Forward
-- only (0038 is never rewritten), idempotent, and refused if any row exists.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- Nested IF: PL/pgSQL plans the row check only once the table is known to exist
-- (a single AND expression would be planned against a missing relation on replay).
DO $$ BEGIN IF to_regclass('artifacts.live_invitations') IS NOT NULL THEN IF EXISTS (SELECT 1 FROM artifacts.live_invitations) THEN RAISE EXCEPTION 'live invitations not empty'; END IF; END IF; END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS artifacts.live_invitations_by_binding;
--> statement-breakpoint
DROP TABLE IF EXISTS artifacts.live_invitations;

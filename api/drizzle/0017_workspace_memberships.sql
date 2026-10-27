-- 6G workspace and membership authority. Explicit grants only: approval,
-- invitation, or global administration never implies membership or capability.
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  label text NOT NULL CHECK (label <> ''),
  scope text NOT NULL DEFAULT 'all-municipalities' CHECK (scope = 'all-municipalities'),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  moderate_archive boolean NOT NULL DEFAULT false,
  manage_members boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, account_id),
  CONSTRAINT chk_workspace_memberships_revoked_at CHECK ((status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'active' AND revoked_at IS NULL))
);
CREATE INDEX IF NOT EXISTS workspace_memberships_account_idx
  ON workspace_memberships (account_id) WHERE status = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('member_added', 'member_revoked',
    'capability_granted', 'capability_revoked')),
  capability text CHECK (capability IN ('moderate_archive', 'manage_members')),
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_workspace_membership_events_capability CHECK ((kind IN ('capability_granted', 'capability_revoked')
    AND capability IS NOT NULL) OR (kind IN ('member_added', 'member_revoked') AND capability IS NULL))
);
CREATE INDEX IF NOT EXISTS workspace_membership_events_workspace_idx
  ON workspace_membership_events (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS workspace_membership_events_account_idx
  ON workspace_membership_events (workspace_id, account_id, created_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_workspace_membership_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace membership events are append-only';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER workspace_membership_events_immutable
  BEFORE UPDATE OR DELETE ON workspace_membership_events FOR EACH ROW EXECUTE FUNCTION guard_workspace_membership_event();
CREATE OR REPLACE TRIGGER workspace_membership_events_no_truncate
  BEFORE TRUNCATE ON workspace_membership_events FOR EACH STATEMENT EXECUTE FUNCTION guard_workspace_membership_event();

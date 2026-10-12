-- Immo assignment and resource metadata only; canonical contents belong to cluster-mesh.
CREATE TABLE IF NOT EXISTS annotation_tenants (
  id text PRIMARY KEY CHECK (length(id) > 0),
  assignment_ref text NOT NULL CHECK (length(assignment_ref) > 0),
  assigned_by text NOT NULL CHECK (length(assigned_by) > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS annotation_workspaces (
  id text PRIMARY KEY CHECK (length(id) > 0),
  tenant_id text NOT NULL REFERENCES annotation_tenants(id) ON DELETE RESTRICT,
  assignment_ref text NOT NULL CHECK (length(assignment_ref) > 0),
  assigned_by text NOT NULL CHECK (length(assigned_by) > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS annotation_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  principal text NOT NULL CHECK (length(principal) > 0),
  capabilities text[] NOT NULL DEFAULT '{}',
  assignment_ref text NOT NULL CHECK (length(assignment_ref) > 0),
  assigned_by text NOT NULL CHECK (length(assigned_by) > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES annotation_workspaces(tenant_id, id) ON DELETE RESTRICT,
  CHECK (capabilities <@ ARRAY['read','comment','revise','assign','resolve-discussion',
    'review','contest','resolve-contest','shared-archive','shared-restore',
    'personal-archive','tombstone','purge','submit-to-ai']::text[])
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS annotation_memberships_active
  ON annotation_memberships(tenant_id, workspace_id, principal) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS annotation_resources (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  namespace text NOT NULL CHECK (length(namespace) > 0),
  kind text NOT NULL CHECK (length(kind) > 0),
  resource_id text NOT NULL CHECK (length(resource_id) > 0),
  source_version text NOT NULL CHECK (length(source_version) > 0),
  frozen_digest text NOT NULL CHECK (frozen_digest ~ '^[0-9a-f]{64}$'),
  current_digest text CHECK (current_digest ~ '^[0-9a-f]{64}$'),
  source_locator text NOT NULL CHECK (length(source_locator) > 0),
  assignment_ref text NOT NULL CHECK (length(assignment_ref) > 0),
  assigned_by text NOT NULL CHECK (length(assigned_by) > 0),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unavailable_at timestamptz,
  PRIMARY KEY (tenant_id, workspace_id, namespace, kind, resource_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES annotation_workspaces(tenant_id, id) ON DELETE RESTRICT
);
-- Retirement is a separate guarded operation after canonical receipt reconciliation.

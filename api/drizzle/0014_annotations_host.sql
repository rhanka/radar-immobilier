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
--> statement-breakpoint
CREATE TABLE annotation_assignment_history (
  sequence bigserial PRIMARY KEY,
  entity_kind text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  previous_state jsonb,
  assigned_state jsonb,
  database_actor text NOT NULL DEFAULT current_user,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION record_annotation_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'annotation_resources' AND TG_OP = 'UPDATE' AND
    (to_jsonb(NEW) - ARRAY['current_digest', 'unavailable_at']) <>
    (to_jsonb(OLD) - ARRAY['current_digest', 'unavailable_at']) THEN
    RAISE EXCEPTION 'Registered source snapshots are immutable; use an explicit linked resource';
  END IF;
  INSERT INTO annotation_assignment_history(entity_kind, operation, previous_state, assigned_state)
    VALUES (TG_TABLE_NAME, TG_OP,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER annotation_tenant_history AFTER INSERT OR UPDATE OR DELETE ON annotation_tenants
  FOR EACH ROW EXECUTE FUNCTION record_annotation_assignment();
--> statement-breakpoint
CREATE TRIGGER annotation_workspace_history AFTER INSERT OR UPDATE OR DELETE ON annotation_workspaces
  FOR EACH ROW EXECUTE FUNCTION record_annotation_assignment();
--> statement-breakpoint
CREATE TRIGGER annotation_membership_history AFTER INSERT OR UPDATE OR DELETE ON annotation_memberships
  FOR EACH ROW EXECUTE FUNCTION record_annotation_assignment();
--> statement-breakpoint
CREATE TRIGGER annotation_resource_history AFTER INSERT OR UPDATE OR DELETE ON annotation_resources
  FOR EACH ROW EXECUTE FUNCTION record_annotation_assignment();
--> statement-breakpoint
CREATE FUNCTION protect_annotation_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Annotation assignment history is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER annotation_history_immutable BEFORE UPDATE OR DELETE ON annotation_assignment_history
  FOR EACH ROW EXECUTE FUNCTION protect_annotation_assignment_history();
--> statement-breakpoint
CREATE TABLE annotation_resource_links (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  from_namespace text NOT NULL, from_kind text NOT NULL, from_id text NOT NULL,
  to_namespace text NOT NULL, to_kind text NOT NULL, to_id text NOT NULL,
  relation text NOT NULL CHECK (relation IN ('same-native-object', 'corrected-mapping')),
  evidence_ref text NOT NULL CHECK (length(evidence_ref) > 0),
  canonical_conversion_ref text,
  PRIMARY KEY (tenant_id, workspace_id, from_namespace, from_kind, from_id, to_namespace, to_kind, to_id),
  FOREIGN KEY (tenant_id, workspace_id, from_namespace, from_kind, from_id)
    REFERENCES annotation_resources(tenant_id, workspace_id, namespace, kind, resource_id),
  FOREIGN KEY (tenant_id, workspace_id, to_namespace, to_kind, to_id)
    REFERENCES annotation_resources(tenant_id, workspace_id, namespace, kind, resource_id)
);
--> statement-breakpoint
CREATE TRIGGER annotation_resource_link_history AFTER INSERT OR UPDATE OR DELETE ON annotation_resource_links
  FOR EACH ROW EXECUTE FUNCTION record_annotation_assignment();

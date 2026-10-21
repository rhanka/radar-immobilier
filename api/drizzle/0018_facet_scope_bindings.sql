-- 6H personal-state attachment and scoped activation. Additive only.
-- New tables: stream registry, immutable bindings, SQL terminal registry,
-- explicit per-account attachments with pending dispositions, receipt
-- contexts, and per-workspace activation state. Existing tables, indexes,
-- and triggers are untouched: facet_events_head_idx stays in place until
-- the protected activation operation replaces it (see activation.ts).
CREATE TABLE IF NOT EXISTS facet_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('personal', 'workspace')),
  owner_id uuid REFERENCES account_users(id) ON DELETE RESTRICT,
  target_type text NOT NULL DEFAULT 'signal' CHECK (target_type = 'signal'),
  city_slug text NOT NULL CHECK (city_slug <> ''),
  node_type text NOT NULL CHECK (node_type IN ('Signal', 'DesignationEvent')),
  node_id text NOT NULL CHECK (node_id <> ''),
  facet text NOT NULL CHECK (facet IN ('selection', 'archive')),
  basket text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_facet_streams_owner CHECK ((scope = 'personal' AND owner_id IS NOT NULL)
    OR (scope = 'workspace' AND owner_id IS NULL)),
  CONSTRAINT chk_facet_streams_basket CHECK ((facet = 'selection' AND basket IS NOT NULL AND basket IN ('pertinent', 'a_surveiller'))
      OR (facet = 'archive' AND basket IS NULL)),
  CONSTRAINT facet_streams_identity_key UNIQUE NULLS NOT DISTINCT
    (workspace_id, scope, owner_id, target_type, city_slug, node_type, node_id, facet, basket)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_event_bindings (
  event_id uuid PRIMARY KEY REFERENCES facet_events(id) ON DELETE RESTRICT,
  stream_id uuid NOT NULL REFERENCES facet_streams(id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facet_event_bindings_stream_key UNIQUE (stream_id, event_id)
);
CREATE INDEX IF NOT EXISTS facet_event_bindings_stream_idx
  ON facet_event_bindings (stream_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'facet event bindings are immutable';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_event_bindings_immutable
  BEFORE UPDATE OR DELETE ON facet_event_bindings FOR EACH ROW EXECUTE FUNCTION guard_facet_binding();
CREATE OR REPLACE TRIGGER facet_event_bindings_no_truncate
  BEFORE TRUNCATE ON facet_event_bindings FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_binding();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_heads (
  stream_id uuid PRIMARY KEY REFERENCES facet_streams(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL UNIQUE REFERENCES facet_events(id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facet_heads_binding_fk FOREIGN KEY (stream_id, event_id)
    REFERENCES facet_event_bindings (stream_id, event_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_head_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'facet heads support replacement only, never deletion';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_heads_no_delete
  BEFORE DELETE ON facet_heads FOR EACH ROW EXECUTE FUNCTION guard_facet_head_delete();
CREATE OR REPLACE TRIGGER facet_heads_no_truncate
  BEFORE TRUNCATE ON facet_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_head_delete();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_stream_attachments (
  account_id uuid PRIMARY KEY REFERENCES account_users(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('attached', 'pending-ambiguous')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason <> '' AND char_length(reason) <= 512),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facet_stream_attachments_workspace_idx
  ON facet_stream_attachments (workspace_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending-ambiguous' AND NEW.status = 'attached'
     AND OLD.account_id = NEW.account_id AND OLD.workspace_id = NEW.workspace_id
     AND OLD.actor_id = NEW.actor_id AND OLD.created_at = NEW.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'facet stream attachments allow only pending-to-attached qualification';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_stream_attachments_guarded
  BEFORE UPDATE OR DELETE ON facet_stream_attachments FOR EACH ROW EXECUTE FUNCTION guard_facet_attachment();
CREATE OR REPLACE TRIGGER facet_stream_attachments_no_truncate
  BEFORE TRUNCATE ON facet_stream_attachments FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_attachment();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_command_contexts (
  owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('resolved', 'pending')),
  command_digest text CHECK (command_digest ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, command_key),
  FOREIGN KEY (owner_id, command_key) REFERENCES facet_commands(owner_id, command_key) ON DELETE RESTRICT
);

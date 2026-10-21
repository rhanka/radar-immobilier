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
CREATE INDEX IF NOT EXISTS facet_command_contexts_workspace_idx
  ON facet_command_contexts (workspace_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_command_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'facet command contexts are immutable';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_command_contexts_immutable
  BEFORE UPDATE OR DELETE ON facet_command_contexts FOR EACH ROW EXECUTE FUNCTION guard_facet_command_context();
CREATE OR REPLACE TRIGGER facet_command_contexts_no_truncate
  BEFORE TRUNCATE ON facet_command_contexts FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_command_context();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_activation_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,
  writer_epoch text NOT NULL DEFAULT 'legacy' CHECK (writer_epoch IN ('legacy', 'scoped')),
  maintenance_barrier boolean NOT NULL DEFAULT false,
  old_index_dropped boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Frozen pre-cutover exceptions may be qualified later, but never advanced unbound.
CREATE TABLE IF NOT EXISTS facet_unresolved_events (
  event_id uuid PRIMARY KEY REFERENCES facet_events(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_streams_immutable
  BEFORE UPDATE OR DELETE ON facet_streams FOR EACH ROW EXECUTE FUNCTION guard_facet_binding();
CREATE OR REPLACE TRIGGER facet_streams_no_truncate
  BEFORE TRUNCATE ON facet_streams FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_binding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_facet_stream(p_stream uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  terminal uuid;
  total integer;
  reached integer;
BEGIN
  PERFORM id FROM facet_streams WHERE id = p_stream FOR UPDATE;
  SELECT count(*) INTO total FROM facet_event_bindings WHERE stream_id = p_stream;
  IF total = 0 THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM facet_event_bindings b JOIN facet_events e ON e.id = b.event_id
    JOIN facet_streams s ON s.id = b.stream_id WHERE b.stream_id = p_stream
    AND (e.scope, e.owner_id, e.target_type, e.city_slug, e.node_type, e.node_id, e.facet, e.basket)
      IS DISTINCT FROM (s.scope, s.owner_id, s.target_type, s.city_slug, s.node_type, s.node_id, s.facet, s.basket)
  ) THEN RAISE EXCEPTION 'facet stream identity mismatch'; END IF;
  IF (SELECT count(*) FROM facet_event_bindings b JOIN facet_events e ON e.id = b.event_id
      WHERE b.stream_id = p_stream AND e.superseded_by IS NULL) <> 1 THEN
    RAISE EXCEPTION 'facet stream requires exactly one terminal';
  END IF;
  SELECT e.id INTO terminal FROM facet_event_bindings b JOIN facet_events e ON e.id = b.event_id
    WHERE b.stream_id = p_stream AND e.superseded_by IS NULL;
  IF NOT EXISTS (SELECT 1 FROM facet_heads WHERE stream_id = p_stream AND event_id = terminal) THEN
    RAISE EXCEPTION 'facet head must register the terminal';
  END IF;
  IF EXISTS (
    SELECT 1 FROM facet_event_bindings b JOIN facet_events e ON e.id = b.event_id
    LEFT JOIN facet_event_bindings pb ON pb.event_id = e.supersedes
    LEFT JOIN facet_events parent ON parent.id = e.supersedes
    LEFT JOIN facet_event_bindings nb ON nb.event_id = e.superseded_by
    LEFT JOIN facet_events child ON child.id = e.superseded_by
    WHERE b.stream_id = p_stream AND
      ((e.supersedes IS NOT NULL AND (pb.stream_id IS DISTINCT FROM p_stream OR parent.superseded_by IS DISTINCT FROM e.id))
       OR (e.superseded_by IS NOT NULL AND (nb.stream_id IS DISTINCT FROM p_stream OR child.supersedes IS DISTINCT FROM e.id)))
  ) THEN RAISE EXCEPTION 'facet chain must be complete and reciprocal'; END IF;
  IF EXISTS (
    SELECT 1 FROM facet_event_bindings b JOIN facet_events e
      ON e.supersedes = b.event_id OR e.superseded_by = b.event_id
    LEFT JOIN facet_event_bindings other ON other.event_id = e.id
    WHERE b.stream_id = p_stream AND other.stream_id IS DISTINCT FROM p_stream
  ) THEN RAISE EXCEPTION 'facet chain crosses an unresolved or different stream'; END IF;
  WITH RECURSIVE chain(id, supersedes) AS (
    SELECT id, supersedes FROM facet_events WHERE id = terminal
    UNION SELECT e.id, e.supersedes FROM facet_events e JOIN chain c ON e.id = c.supersedes
  ) SELECT count(*) INTO reached FROM chain;
  IF reached <> total THEN RAISE EXCEPTION 'facet chain must be connected and acyclic'; END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_scoped_event_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bound_stream uuid;
BEGIN
  SELECT stream_id INTO bound_stream FROM facet_event_bindings WHERE event_id = NEW.id;
  IF bound_stream IS NOT NULL THEN
    PERFORM check_facet_stream(bound_stream);
  ELSIF EXISTS (SELECT 1 FROM facet_activation_state WHERE old_index_dropped) THEN
    IF TG_OP <> 'INSERT' OR NOT EXISTS (SELECT 1 FROM facet_unresolved_events WHERE event_id = NEW.id) THEN
      RAISE EXCEPTION 'scoped facet event committed without a stream binding';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS facet_events_scoped_binding ON facet_events;
CREATE CONSTRAINT TRIGGER facet_events_scoped_binding
  AFTER INSERT OR UPDATE ON facet_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_scoped_event_binding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_facet_registry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM check_facet_stream(NEW.stream_id);
  IF TG_OP = 'UPDATE' AND OLD.stream_id IS DISTINCT FROM NEW.stream_id THEN
    RAISE EXCEPTION 'facet head stream is immutable';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS facet_bindings_integrity ON facet_event_bindings;
CREATE CONSTRAINT TRIGGER facet_bindings_integrity AFTER INSERT ON facet_event_bindings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_facet_registry();
DROP TRIGGER IF EXISTS facet_heads_integrity ON facet_heads;
CREATE CONSTRAINT TRIGGER facet_heads_integrity AFTER INSERT OR UPDATE ON facet_heads
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_facet_registry();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_facet_receipt_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM facet_activation_state WHERE old_index_dropped)
    AND NOT EXISTS (SELECT 1 FROM facet_command_contexts c WHERE c.owner_id = NEW.owner_id
      AND c.command_key = NEW.command_key AND c.status = 'resolved' AND c.command_digest = NEW.command_digest) THEN
    RAISE EXCEPTION 'scoped facet receipt requires context';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS facet_receipts_scoped_context ON facet_commands;
CREATE CONSTRAINT TRIGGER facet_receipts_scoped_context AFTER INSERT ON facet_commands
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_facet_receipt_context();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION facet_swap_head_enforcement(p_workspace_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  barrier boolean;
  stream record;
BEGIN
  LOCK TABLE facet_events, facet_commands, facet_streams, facet_event_bindings, facet_heads
    IN ACCESS EXCLUSIVE MODE;
  SELECT maintenance_barrier INTO barrier FROM facet_activation_state
    WHERE workspace_id = p_workspace_id AND xmin::text::bigint <> txid_current();
  IF barrier IS NULL OR barrier = false THEN
    RAISE EXCEPTION 'facet activation requires a committed maintenance barrier';
  END IF;
  FOR stream IN SELECT id FROM facet_streams ORDER BY id LOOP
    PERFORM check_facet_stream(stream.id);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM facet_activation_state WHERE old_index_dropped) THEN
    INSERT INTO facet_unresolved_events SELECT e.id FROM facet_events e
      LEFT JOIN facet_event_bindings b ON b.event_id = e.id WHERE b.event_id IS NULL ON CONFLICT DO NOTHING;
  END IF;
  DROP INDEX IF EXISTS facet_events_head_idx;
  UPDATE facet_activation_state
    SET writer_epoch = 'scoped', old_index_dropped = true, updated_at = now()
    WHERE workspace_id = p_workspace_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM facet_activation_state WHERE old_index_dropped) THEN
    RAISE EXCEPTION 'facet unresolved inventory is frozen';
  END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'facet inventory is append-only'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_unresolved_frozen BEFORE INSERT OR UPDATE OR DELETE
  ON facet_unresolved_events FOR EACH ROW EXECUTE FUNCTION guard_facet_inventory();
CREATE OR REPLACE TRIGGER facet_unresolved_no_truncate BEFORE TRUNCATE
  ON facet_unresolved_events FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_binding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fence_facet_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM facet_activation_state WHERE maintenance_barrier AND writer_epoch = 'legacy') THEN
    RAISE EXCEPTION 'facet maintenance barrier is closed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_events_maintenance BEFORE INSERT OR UPDATE
  ON facet_events FOR EACH ROW EXECUTE FUNCTION fence_facet_maintenance();
CREATE OR REPLACE TRIGGER facet_commands_maintenance BEFORE INSERT
  ON facet_commands FOR EACH ROW EXECUTE FUNCTION fence_facet_maintenance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.writer_epoch <> 'legacy' OR NEW.old_index_dropped) THEN
    RAISE EXCEPTION 'facet epoch must start as legacy';
  END IF;
  IF TG_OP = 'UPDATE' AND ((OLD.old_index_dropped AND NOT NEW.old_index_dropped)
    OR (OLD.writer_epoch = 'scoped' AND NEW.writer_epoch <> 'scoped')) THEN
    RAISE EXCEPTION 'facet epoch cannot revert after cutover';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_epoch_monotonic BEFORE INSERT OR UPDATE
  ON facet_activation_state FOR EACH ROW EXECUTE FUNCTION guard_facet_epoch();
CREATE OR REPLACE TRIGGER facet_epoch_no_delete BEFORE DELETE
  ON facet_activation_state FOR EACH ROW EXECUTE FUNCTION guard_facet_binding();
CREATE OR REPLACE TRIGGER facet_epoch_no_truncate BEFORE TRUNCATE
  ON facet_activation_state FOR EACH STATEMENT EXECUTE FUNCTION guard_facet_binding();

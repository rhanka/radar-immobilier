-- MCP state is scoped. The global AI annotation remains a separate input.
ALTER TABLE signal_class_annotations DROP CONSTRAINT signal_class_annotations_source_check;
ALTER TABLE signal_class_annotations ADD CONSTRAINT signal_class_annotations_source_check
  CHECK (source IN ('ai','manual','mcp'));
ALTER TABLE facet_events DROP CONSTRAINT facet_events_source_check;
ALTER TABLE facet_events ADD CONSTRAINT facet_events_source_check CHECK (source IN ('ai','manual','mcp'));
--> statement-breakpoint
CREATE TABLE signal_mcp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id uuid NOT NULL REFERENCES account_users(id),
  scope text NOT NULL CHECK (scope IN ('personal','workspace')),
  city_slug text NOT NULL, node_type text NOT NULL CHECK (node_type IN ('Signal','DesignationEvent')), node_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('class','feedback','note')),
  source text NOT NULL CHECK (source IN ('mcp','manual')),
  model text, client_id text, validation text NOT NULL CHECK (validation IN ('auto','human')),
  classe text CHECK (classe IN ('pertinent','a_surveiller','ecarte','non_classe')),
  reason_code text, reason text, text text CHECK (length(text) BETWEEN 1 AND 2000),
  verdict text CHECK (verdict IN ('up','down')),
  previous_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source <> 'mcp' OR (length(btrim(model)) > 0 AND length(btrim(client_id)) > 0)),
  CHECK ((kind='note' AND text IS NOT NULL AND classe IS NULL) OR
    (kind IN ('class','feedback') AND classe IS NOT NULL AND length(btrim(reason)) > 0)),
  CHECK (classe IS DISTINCT FROM 'non_classe' OR validation='human')
);
CREATE INDEX signal_mcp_events_target_idx ON signal_mcp_events(workspace_id,city_slug,node_type,node_id,created_at DESC);
CREATE TABLE signal_mcp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sub text NOT NULL, client_id text NOT NULL,
  model text, tool text NOT NULL, input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signal_mcp_audit_rate_idx ON signal_mcp_audit(sub,created_at DESC);
CREATE TRIGGER signal_mcp_events_immutable BEFORE UPDATE OR DELETE ON signal_mcp_events
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
CREATE TRIGGER signal_mcp_events_no_truncate BEFORE TRUNCATE ON signal_mcp_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();
CREATE TRIGGER signal_mcp_audit_immutable BEFORE UPDATE OR DELETE ON signal_mcp_audit
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
CREATE TRIGGER signal_mcp_audit_no_truncate BEFORE TRUNCATE ON signal_mcp_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();
--> statement-breakpoint
-- SECURITY INVOKER throughout. The caller supplies verified identity, never tool arguments.
CREATE FUNCTION signal_mcp_read(p_sub text, p_ref jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid; wid uuid := (p_ref->>'workspaceId')::uuid; events jsonb; ai jsonb; manual jsonb;
  current_class jsonb; history jsonb; version text; notes jsonb; feedback jsonb;
BEGIN
  SELECT id INTO actor FROM account_users WHERE sub=p_sub AND status='approved';
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_memberships
    WHERE workspace_id=wid AND account_id=actor AND status='active') THEN
    RETURN jsonb_build_object('error','workspace_membership_required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM graph_nodes WHERE city_slug=p_ref->>'citySlug'
    AND type=p_ref->>'type' AND id=p_ref->>'id') THEN RETURN jsonb_build_object('error','signal_not_found'); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id DESC),'[]') INTO events
    FROM signal_mcp_events e WHERE workspace_id=wid AND city_slug=p_ref->>'citySlug'
      AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' AND (scope='workspace' OR actor_id=actor);
  SELECT to_jsonb(a) INTO ai FROM signal_class_annotations a WHERE city_slug=p_ref->>'citySlug'
    AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' AND source='ai';
  SELECT to_jsonb(e) INTO manual FROM facet_events e
    JOIN facet_event_bindings b ON b.event_id=e.id JOIN facet_streams s ON s.id=b.stream_id
    WHERE s.workspace_id=wid AND e.city_slug=p_ref->>'citySlug' AND e.node_type=p_ref->>'type'
      AND e.node_id=p_ref->>'id' AND e.source='manual' AND (s.scope='workspace' OR s.owner_id=actor)
    ORDER BY (e.facet='archive' AND e.state='active' AND e.superseded_by IS NULL) DESC,
      (e.state='active' AND e.superseded_by IS NULL) DESC,e.created_at DESC,e.id DESC LIMIT 1;
  SELECT value INTO current_class FROM jsonb_array_elements(events)
    WHERE value->>'kind' IN ('class','feedback')
    ORDER BY (value->>'validation'='human') DESC,(value->>'created_at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF current_class->>'validation'='auto' AND (ai->>'updated_at')::timestamptz > (current_class->>'created_at')::timestamptz
    THEN current_class := NULL; END IF;
  IF manual IS NOT NULL THEN
    current_class := manual || jsonb_build_object('classe',CASE WHEN manual->>'state'='inactive' THEN 'non_classe'
      WHEN manual->>'facet'='archive' THEN 'ecarte' ELSE manual->>'basket' END,'validation','human');
  ELSE current_class := coalesce(current_class,ai); END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO notes FROM jsonb_array_elements(events) WHERE value->>'kind'='note';
  SELECT coalesce(jsonb_agg(value),'[]') INTO feedback FROM jsonb_array_elements(events) WHERE value->>'kind'='feedback';
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC,h.id DESC),'[]') INTO history
    FROM (SELECT * FROM signal_class_annotation_history WHERE city_slug=p_ref->>'citySlug'
      AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' ORDER BY created_at DESC,id DESC LIMIT 20) h;
  version := md5(jsonb_build_array(events,ai,manual)::text);
  RETURN jsonb_build_object('version',version,'current',current_class,'ai',ai,
    'ambiguous',coalesce(current_class->>'classe'='non_classe',true),'history',history,
    'mcpHistory',events,'feedback',feedback,'notes',notes);
END $$;

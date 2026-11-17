-- MCP state is scoped. The global AI annotation remains a separate input.
-- Nothing writes source='mcp' into signal_class_annotations or facet_events:
-- MCP rows live only in signal_mcp_events, so their source CHECKs stay as
-- earlier migrations defined them (no widening here).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_mcp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id uuid NOT NULL REFERENCES account_users(id),
  scope text NOT NULL CHECK (scope IN ('personal','workspace')),
  city_slug text NOT NULL, node_type text NOT NULL CHECK (node_type IN ('Signal','DesignationEvent')), node_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('class','feedback','note')),
  source text NOT NULL CHECK (source IN ('mcp','manual')),
  model text, client_id text, oauth_sub text NOT NULL, validation text NOT NULL CHECK (validation IN ('auto','human')),
  pending_human boolean NOT NULL DEFAULT false,
  linked_event_id uuid REFERENCES signal_mcp_events(id),
  classe text CHECK (classe IN ('pertinent','a_surveiller','ecarte','non_classe')),
  reason_code text, reason text, text text CHECK (length(text) BETWEEN 1 AND 2000),
  verdict text CHECK (verdict IN ('up','down')),
  previous_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source <> 'mcp' OR (length(btrim(model)) > 0 AND length(btrim(client_id)) > 0)),
  CHECK ((source='mcp' AND validation='auto' AND linked_event_id IS NULL) OR
    (source='manual' AND validation='human' AND NOT pending_human AND (kind='note' OR linked_event_id IS NOT NULL))),
  CHECK ((kind='note' AND text IS NOT NULL AND classe IS NULL) OR
    (kind IN ('class','feedback') AND classe IS NOT NULL AND length(btrim(reason)) > 0)),
  CHECK (classe IS DISTINCT FROM 'non_classe' OR validation='human' OR pending_human)
);
CREATE INDEX IF NOT EXISTS signal_mcp_events_target_idx ON signal_mcp_events(workspace_id,city_slug,node_type,node_id,created_at DESC);
CREATE TABLE IF NOT EXISTS signal_mcp_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sub text NOT NULL, client_id text NOT NULL,
  model text, tool text NOT NULL, input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  result text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS signal_mcp_audit_rate_idx ON signal_mcp_audit(sub,created_at DESC);
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS city_slug text;
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS node_type text;
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS node_id text;
CREATE INDEX IF NOT EXISTS signal_class_annotation_history_city_idx
  ON signal_class_annotation_history(city_slug,node_type,node_id,created_at DESC);
DROP TRIGGER IF EXISTS signal_mcp_events_immutable ON signal_mcp_events;
CREATE TRIGGER signal_mcp_events_immutable BEFORE UPDATE OR DELETE ON signal_mcp_events
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_mcp_events_no_truncate ON signal_mcp_events;
CREATE TRIGGER signal_mcp_events_no_truncate BEFORE TRUNCATE ON signal_mcp_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_mcp_audit_immutable ON signal_mcp_audit;
CREATE TRIGGER signal_mcp_audit_immutable BEFORE UPDATE OR DELETE ON signal_mcp_audit
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_mcp_audit_no_truncate ON signal_mcp_audit;
CREATE TRIGGER signal_mcp_audit_no_truncate BEFORE TRUNCATE ON signal_mcp_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();
--> statement-breakpoint
-- SECURITY DEFINER with a fixed search_path: the restricted MCP role gets
-- EXECUTE on these functions only, never direct table privileges. The caller
-- supplies verified identity, never tool arguments.
CREATE OR REPLACE FUNCTION signal_mcp_read(p_sub text, p_ref jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor uuid; wid uuid := (p_ref->>'workspaceId')::uuid; events jsonb; ai jsonb; manual jsonb;
  current_class jsonb; shared_class jsonb; pending_shared jsonb; history jsonb; version text; notes jsonb; feedback jsonb; ui_feedback jsonb; graph_version text;
BEGIN
  SELECT id INTO actor FROM account_users WHERE sub=p_sub AND status='approved';
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_memberships
    WHERE workspace_id=wid AND account_id=actor AND status='active') THEN
    RETURN jsonb_build_object('error','workspace_membership_required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM facet_activation_state WHERE workspace_id=wid
    AND writer_epoch='scoped' AND NOT maintenance_barrier) THEN
    RETURN jsonb_build_object('error','scoped_epoch_required');
  END IF;
  IF EXISTS (SELECT 1 FROM facet_events e LEFT JOIN facet_event_bindings b ON b.event_id=e.id
    WHERE e.owner_id=actor AND b.event_id IS NULL) THEN
    RETURN jsonb_build_object('error','personal_history_unresolved');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM graph_nodes WHERE city_slug=p_ref->>'citySlug'
    AND type=p_ref->>'type' AND id=p_ref->>'id') THEN RETURN jsonb_build_object('error','signal_not_found'); END IF;
  SELECT md5(jsonb_build_array(label,props,source_ref)::text) INTO graph_version FROM graph_nodes
    WHERE city_slug=p_ref->>'citySlug' AND type=p_ref->>'type' AND id=p_ref->>'id';
  -- Other actors' identity fields are never projected to a member: only the
  -- viewer's own events keep oauth_sub, client_id and actor_id.
  SELECT coalesce(jsonb_agg(CASE WHEN e.actor_id=actor THEN to_jsonb(e)
      ELSE to_jsonb(e) - 'oauth_sub' - 'client_id' - 'actor_id' END
      ORDER BY e.created_at DESC,e.id DESC),'[]') INTO events
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
    WHERE value->>'kind' IN ('class','feedback') AND value->>'scope'='personal'
    ORDER BY (value->>'validation'='human') DESC,(value->>'scope'='workspace' AND value->>'classe'='ecarte') DESC,
      (value->>'created_at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF current_class->>'validation'='auto' AND (ai->>'updated_at')::timestamptz > (current_class->>'created_at')::timestamptz
    THEN current_class := NULL; END IF;
  IF manual IS NOT NULL THEN
    current_class := manual || jsonb_build_object('classe',CASE WHEN manual->>'state'='inactive' THEN 'non_classe'
      WHEN manual->>'facet'='archive' THEN 'ecarte' ELSE manual->>'basket' END,'validation','human');
  ELSE current_class := coalesce(current_class,ai); END IF;
  -- A manual journal entry wins older UI heads; a shared archive wins all personal state.
  SELECT value INTO shared_class FROM jsonb_array_elements(events)
    WHERE value->>'kind' IN ('class','feedback') AND value->>'source'='manual' AND value->>'scope'='personal'
    ORDER BY (value->>'created_at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF shared_class IS NOT NULL AND (manual IS NULL OR
    (NOT (manual->>'facet'='archive' AND manual->>'state'='active' AND manual->>'superseded_by' IS NULL) AND
    (shared_class->>'created_at')::timestamptz > (manual->>'created_at')::timestamptz)) THEN current_class := shared_class; END IF;
  -- A workspace-scope MCP event becomes effective only once a browser
  -- (manual, linked) event confirms it; until then it stays pending and
  -- never hides or classes the signal for the workspace.
  SELECT o.value INTO shared_class FROM jsonb_array_elements(events) AS o(value)
    WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
      AND (o.value->>'source'='manual' OR EXISTS (SELECT 1 FROM jsonb_array_elements(events) AS c(value)
        WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual'))
    ORDER BY (o.value->>'created_at')::timestamptz DESC,o.value->>'id' DESC LIMIT 1;
  IF shared_class->>'classe'='ecarte' THEN current_class := shared_class; END IF;
  SELECT o.value INTO pending_shared FROM jsonb_array_elements(events) AS o(value)
    WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace' AND o.value->>'source'='mcp'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(events) AS c(value)
        WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual')
    ORDER BY (o.value->>'created_at')::timestamptz DESC,o.value->>'id' DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(value),'[]') INTO notes FROM jsonb_array_elements(events) WHERE value->>'kind'='note';
  SELECT coalesce(jsonb_agg(value),'[]') INTO feedback FROM jsonb_array_elements(events) WHERE value->>'kind'='feedback';
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at DESC,h.id DESC),'[]') INTO history
    FROM (SELECT * FROM signal_class_annotation_history WHERE city_slug=p_ref->>'citySlug'
      AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' ORDER BY created_at DESC,id DESC LIMIT 20) h;
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC,f.id DESC),'[]') INTO ui_feedback
    FROM signal_class_feedback f WHERE workspace_id=wid AND city_slug=p_ref->>'citySlug'
      AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' AND (scope='workspace' OR actor_id=actor);
  version := md5(jsonb_build_array(events,ai,manual,graph_version)::text);
  IF current_class IS NOT NULL THEN current_class := current_class || jsonb_build_object(
    'reason',current_class->'reason','model',current_class->'model','effort',current_class->'effort',
    'inputSha256',current_class->'input_sha256',
    'reasonCode',current_class->'reason_code','mcpClientId',current_class->'client_id',
    'user',current_class->'oauth_sub','promptId',current_class->'prompt_id',
    'promptSha256',current_class->'prompt_sha256','pipelineRunId',current_class->'pipeline_run_id',
    'createdAt',current_class->'created_at','updatedAt',coalesce(current_class->'updated_at',current_class->'created_at'),
    'validation',coalesce(current_class->>'validation',CASE WHEN current_class->>'source'='ai' THEN 'auto' ELSE 'human' END)); END IF;
  RETURN jsonb_build_object('version',version,'current',current_class,'ai',ai,
    'canConfirm',current_class->>'actor_id'=actor::text OR pending_shared->>'actor_id'=actor::text,
    'moderateArchive',EXISTS (SELECT 1 FROM workspace_memberships WHERE workspace_id=wid AND account_id=actor AND status='active' AND moderate_archive),
    'ambiguous',coalesce((current_class->>'ambiguous')::boolean,current_class->>'classe'='non_classe',true),'history',history,
    'mcpHistory',events,'feedback',feedback || ui_feedback,'notes',notes,'pendingShared',pending_shared);
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS signal_mcp_result(text,text,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION signal_mcp_result(p_sub text,p_client text,p_model text,p_tool text,p_hash text,p_result jsonb,p_ref jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  INSERT INTO signal_mcp_audit(sub,client_id,model,tool,input_hash,result,workspace_id,city_slug,node_type,node_id)
    VALUES(p_sub,p_client,p_model,p_tool,p_hash,coalesce(p_result->>'error','written'),
      (p_ref->>'workspaceId')::uuid,p_ref->>'citySlug',p_ref->>'type',p_ref->>'id');
  RETURN p_result;
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_read(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION signal_mcp_result(text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signal_mcp_write_core(p_sub text,p_client text,p_tool text,p_body jsonb,p_validation text,
  p_version text,p_hash text,p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE ref jsonb := p_body->'signalRef'; wid uuid := (ref->>'workspaceId')::uuid;
  actor uuid; state jsonb; next_class text; v_code text := p_body->>'reasonCode';
  why text := btrim(p_body->>'reason'); model_name text := btrim(p_body->>'model');
  note text; event_id uuid; kind_name text; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-mcp-rate:' || p_sub,0));
  IF (SELECT count(*) FROM signal_mcp_audit WHERE sub=p_sub AND created_at>clock_timestamp()-interval '1 minute') >= 30 THEN
    RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,jsonb_build_object('error','rate_limited'),ref);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(array_to_json(ARRAY['workspace',wid::text])::text,0));
  PERFORM pg_advisory_xact_lock(hashtext('graph-city:' || (ref->>'citySlug')));
  PERFORM pg_advisory_xact_lock(hashtextextended(array_to_json(ARRAY['class-annotation',
    ref->>'citySlug',ref->>'type',ref->>'id'])::text,0));
  SELECT id INTO actor FROM account_users WHERE sub=p_sub AND status='approved' FOR SHARE;
  state := signal_mcp_read(p_sub,ref);
  BEGIN
    IF state ? 'error' THEN result := state;
    ELSIF p_source NOT IN ('mcp','manual') OR p_validation NOT IN ('auto','human')
      OR (p_source='mcp' AND p_validation<>'auto')
      OR (p_source='manual' AND p_tool<>'annotate_signal') OR ref->>'scope' NOT IN ('personal','workspace') THEN
      result := jsonb_build_object('error','invalid_signal_command');
    ELSIF p_source='mcp' AND (coalesce(model_name,'')='' OR coalesce(p_client,'')='') THEN
      result := jsonb_build_object('error','model_and_client_required');
    ELSIF p_version IS DISTINCT FROM state->>'version' THEN result := jsonb_build_object('error','annotation_version_conflict');
    ELSIF NOT EXISTS (SELECT 1 FROM facet_activation_state WHERE workspace_id=wid
      AND writer_epoch='scoped' AND NOT maintenance_barrier) THEN
      result := jsonb_build_object('error','scoped_epoch_required');
    ELSIF ref->>'scope'='workspace' AND NOT EXISTS (SELECT 1 FROM workspace_memberships
      WHERE workspace_id=wid AND account_id=actor AND status='active' AND moderate_archive) THEN
      result := jsonb_build_object('error','workspace_capability_required');
    ELSE
      kind_name := CASE p_tool WHEN 'classify_signal' THEN 'class'
        WHEN 'confirm_classification' THEN 'feedback' WHEN 'annotate_signal' THEN 'note' END;
      next_class := CASE WHEN p_tool='confirm_classification' AND p_body->>'verdict'='up'
        THEN state->'current'->>'classe' ELSE coalesce(p_body->>'newClasse',p_body->>'classe') END;
      IF kind_name='note' THEN
        note := btrim(regexp_replace(regexp_replace(p_body->>'text','<[^>]*>','','g'),'[\x00-\x08\x0B-\x1F\x7F]','','g'));
        IF length(p_body->>'text')>2000 OR coalesce(note,'')='' THEN RAISE EXCEPTION 'invalid_note'; END IF;
      ELSE
        IF p_tool='confirm_classification' THEN
          IF NOT coalesce((p_body->>'pendingHuman')::boolean,false) THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
          IF p_body->>'verdict' NOT IN ('up','down') THEN RAISE EXCEPTION 'invalid_verdict'; END IF;
          IF p_body->>'verdict'='down' AND (next_class IS NULL OR next_class='non_classe'
            OR next_class=state->'current'->>'classe' OR v_code IS NULL) THEN RAISE EXCEPTION 'reclassification_required'; END IF;
          IF p_body->>'verdict'='up' THEN
            v_code := state->'current'->>'reason_code'; why := 'Validated: ' || coalesce(state->'current'->>'reason','');
            IF next_class='ecarte' AND v_code IS NULL THEN RAISE EXCEPTION 'reason_code_required'; END IF;
          END IF;
        END IF;
        IF next_class IS NULL OR next_class NOT IN ('pertinent','a_surveiller','ecarte','non_classe')
          OR coalesce(why,'')='' OR length(why)>2000 THEN RAISE EXCEPTION 'invalid_classification'; END IF;
        IF next_class='non_classe' THEN
          IF NOT coalesce((p_body->>'pendingHuman')::boolean,false) THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
          IF NOT EXISTS (SELECT 1 FROM facet_reason_codes WHERE profile_id='immo-steve-2026-09'
            AND facet_reason_codes.code=v_code) THEN RAISE EXCEPTION 'invalid_reason_code'; END IF;
        ELSIF NOT (p_tool='confirm_classification' AND p_body->>'verdict'='up') AND NOT EXISTS (
          SELECT 1 FROM facet_reason_codes WHERE profile_id='immo-steve-2026-09' AND facet_reason_codes.code=v_code
            AND verdict=CASE next_class WHEN 'ecarte' THEN 'non_pertinent' ELSE next_class END) THEN
          RAISE EXCEPTION 'invalid_reason_code';
        END IF;
        IF ref->>'scope'='workspace' AND next_class<>'ecarte' THEN RAISE EXCEPTION 'workspace_archive_only'; END IF;
        IF state->'current'->>'scope'='workspace' AND ref->>'scope'='personal' AND next_class<>'ecarte' THEN
          RAISE EXCEPTION 'workspace_archive_only'; END IF;
        IF state->'pendingShared' <> 'null'::jsonb AND ref->>'scope'='personal' AND next_class<>'ecarte' THEN
          RAISE EXCEPTION 'workspace_archive_only'; END IF;
        IF state->'current'->>'source'='manual' OR (p_validation='auto' AND state->'current'->>'validation'='human') THEN
          RAISE EXCEPTION 'classification_priority_conflict';
        END IF;
      END IF;
      INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,
        model,client_id,oauth_sub,validation,pending_human,classe,reason_code,reason,text,verdict,previous_version)
        VALUES(wid,actor,ref->>'scope',ref->>'citySlug',ref->>'type',ref->>'id',kind_name,p_source,
          model_name,p_client,p_sub,p_validation,coalesce((p_body->>'pendingHuman')::boolean,false),next_class,v_code,why,note,p_body->>'verdict',p_version) RETURNING id INTO event_id;
      IF ref->>'scope'='personal' THEN
        INSERT INTO personal_projection_revisions(workspace_id,owner_id,city_slug,mode,revision)
          VALUES(wid,actor,ref->>'citySlug','signal',1) ON CONFLICT(workspace_id,owner_id,city_slug,mode)
          DO UPDATE SET revision=personal_projection_revisions.revision+1,updated_at=now();
      ELSE
        INSERT INTO workspace_projection_revisions(workspace_id,city_slug,mode,revision)
          VALUES(wid,ref->>'citySlug','signal',1) ON CONFLICT(workspace_id,city_slug,mode)
          DO UPDATE SET revision=workspace_projection_revisions.revision+1,updated_at=now();
      END IF;
      result := jsonb_build_object('id',event_id,'validation',p_validation);
    END IF;
  EXCEPTION WHEN raise_exception THEN result := jsonb_build_object('error',SQLERRM);
  END;
  RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,result,ref);
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_write_core(text,text,text,jsonb,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
-- The old single writer let the MCP role choose its source; it is gone.
DROP FUNCTION IF EXISTS signal_mcp_write(text,text,text,jsonb,text,text,text,text);
-- MCP entry point: source and validation are forced, never caller-chosen.
CREATE OR REPLACE FUNCTION signal_mcp_write_mcp(p_sub text,p_client text,p_tool text,p_body jsonb,
  p_version text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  RETURN signal_mcp_write_core(p_sub,p_client,p_tool,p_body,'auto',p_version,p_hash,'mcp');
END $$;
-- Browser entry point: human notes only, through the API database user.
CREATE OR REPLACE FUNCTION signal_mcp_write_browser(p_sub text,p_body jsonb,
  p_version text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  RETURN signal_mcp_write_core(p_sub,'browser','annotate_signal',p_body,'human',p_version,p_hash,'manual');
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_write_mcp(text,text,text,jsonb,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION signal_mcp_write_browser(text,jsonb,text,text) FROM PUBLIC;
--> statement-breakpoint
-- Set-based city read: one query for every node of the city, with the same
-- effective-current rule as signal_mcp_read but no history and no feedback
-- (the detail read keeps those). When the city has no MCP event, the event
-- aggregate is empty by construction and only AI/manual currents are built.
CREATE OR REPLACE FUNCTION signal_mcp_read_city(p_sub text, p_workspace uuid, p_city text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor uuid; moderate boolean; result jsonb;
BEGIN
  SELECT id INTO actor FROM account_users WHERE sub=p_sub AND status='approved';
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_memberships
    WHERE workspace_id=p_workspace AND account_id=actor AND status='active') THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT EXISTS (SELECT 1 FROM workspace_memberships WHERE workspace_id=p_workspace
    AND account_id=actor AND status='active' AND moderate_archive) INTO moderate;
  WITH nodes AS (
    SELECT n.id, n.type, md5(jsonb_build_array(n.label,n.props,n.source_ref)::text) AS gv
      FROM graph_nodes n WHERE n.city_slug=p_city AND n.type IN ('Signal','DesignationEvent')),
  ev AS (
    SELECT e.node_type, e.node_id,
      coalesce(jsonb_agg(CASE WHEN e.actor_id=actor THEN to_jsonb(e)
        ELSE to_jsonb(e) - 'oauth_sub' - 'client_id' - 'actor_id' END
        ORDER BY e.created_at DESC, e.id DESC), '[]') AS events
      FROM signal_mcp_events e WHERE e.workspace_id=p_workspace AND e.city_slug=p_city
        AND (e.scope='workspace' OR e.actor_id=actor) GROUP BY e.node_type, e.node_id),
  ai AS (
    SELECT a.node_type, a.node_id, to_jsonb(a) AS ai FROM signal_class_annotations a
      WHERE a.city_slug=p_city AND a.source='ai'),
  manual AS (
    SELECT DISTINCT ON (e.node_type, e.node_id) e.node_type, e.node_id, to_jsonb(e) AS manual
      FROM facet_events e JOIN facet_event_bindings b ON b.event_id=e.id
      JOIN facet_streams s ON s.id=b.stream_id
      WHERE s.workspace_id=p_workspace AND e.city_slug=p_city AND e.source='manual'
        AND (s.scope='workspace' OR s.owner_id=actor)
      ORDER BY e.node_type, e.node_id,
        (e.facet='archive' AND e.state='active' AND e.superseded_by IS NULL) DESC,
        (e.state='active' AND e.superseded_by IS NULL) DESC, e.created_at DESC, e.id DESC),
  per AS (
    SELECT n.id, n.type, n.gv, coalesce(e.events, '[]'::jsonb) AS events, a.ai, m.manual
      FROM nodes n LEFT JOIN ev e ON e.node_type=n.type AND e.node_id=n.id
      LEFT JOIN ai a ON a.node_type=n.type AND a.node_id=n.id
      LEFT JOIN manual m ON m.node_type=n.type AND m.node_id=n.id),
  states AS (
    SELECT p.id, p.type,
      md5(jsonb_build_array(p.events, p.ai, p.manual, p.gv)::text) AS version,
      (SELECT o.value FROM jsonb_array_elements(p.events) AS o(value)
        WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace' AND o.value->>'source'='mcp'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.events) AS c(value)
            WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual')
        ORDER BY (o.value->>'created_at')::timestamptz DESC, o.value->>'id' DESC LIMIT 1) AS pending_shared,
      (SELECT coalesce(jsonb_agg(value), '[]') FROM jsonb_array_elements(p.events)
        WHERE value->>'kind'='note') AS notes,
      (SELECT o.value FROM jsonb_array_elements(p.events) AS o(value)
        WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
          AND (o.value->>'source'='manual' OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.events) AS c(value)
            WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual'))
        ORDER BY (o.value->>'created_at')::timestamptz DESC, o.value->>'id' DESC LIMIT 1) AS shared,
      (SELECT value FROM jsonb_array_elements(p.events)
        WHERE value->>'kind' IN ('class','feedback') AND value->>'source'='manual' AND value->>'scope'='personal'
        ORDER BY (value->>'created_at')::timestamptz DESC, value->>'id' DESC LIMIT 1) AS shared_manual,
      (SELECT value FROM jsonb_array_elements(p.events)
        WHERE value->>'kind' IN ('class','feedback') AND value->>'scope'='personal'
        ORDER BY (value->>'validation'='human') DESC,
          (value->>'scope'='workspace' AND value->>'classe'='ecarte') DESC,
          (value->>'created_at')::timestamptz DESC, value->>'id' DESC LIMIT 1) AS personal,
      p.ai, p.manual, p.events
      FROM per p)
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', s.type, 'id', s.id, 'state',
    jsonb_build_object('version', s.version,
      'current', CASE
        WHEN s.shared->>'classe'='ecarte' THEN s.shared
        WHEN s.shared_manual IS NOT NULL AND (s.manual IS NULL OR
          (NOT (s.manual->>'facet'='archive' AND s.manual->>'state'='active' AND s.manual->>'superseded_by' IS NULL) AND
           (s.shared_manual->>'created_at')::timestamptz > (s.manual->>'created_at')::timestamptz)) THEN s.shared_manual
        WHEN s.manual IS NOT NULL THEN s.manual || jsonb_build_object('classe',
          CASE WHEN s.manual->>'state'='inactive' THEN 'non_classe'
            WHEN s.manual->>'facet'='archive' THEN 'ecarte' ELSE s.manual->>'basket' END, 'validation', 'human')
        WHEN s.personal IS NOT NULL AND NOT coalesce(s.personal->>'validation'='auto' AND
          (s.ai->>'updated_at')::timestamptz > (s.personal->>'created_at')::timestamptz, false) THEN s.personal
        ELSE s.ai END,
      'ai', s.ai, 'pendingShared', s.pending_shared,
      'canConfirm', (CASE
        WHEN s.shared->>'classe'='ecarte' THEN s.shared
        WHEN s.manual IS NOT NULL THEN s.manual
        WHEN s.personal IS NOT NULL AND NOT coalesce(s.personal->>'validation'='auto' AND
          (s.ai->>'updated_at')::timestamptz > (s.personal->>'created_at')::timestamptz, false) THEN s.personal
        ELSE s.ai END)->>'actor_id'=actor::text OR s.pending_shared->>'actor_id'=actor::text,
      'moderateArchive', moderate,
      'history', '[]'::jsonb, 'mcpHistory', '[]'::jsonb, 'feedback', '[]'::jsonb,
      'notes', s.notes))), '[]'::jsonb) INTO result FROM states s;
  RETURN coalesce(result, '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_read_city(text,uuid,text) FROM PUBLIC;

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
  model text, client_id text, oauth_sub text NOT NULL, validation text NOT NULL CHECK (validation IN ('auto','human')),
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
  current_class jsonb; history jsonb; version text; notes jsonb; feedback jsonb; ui_feedback jsonb; graph_version text;
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
    ORDER BY (value->>'validation'='human') DESC,(value->>'scope'='workspace' AND value->>'classe'='ecarte') DESC,
      (value->>'created_at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
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
  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC,f.id DESC),'[]') INTO ui_feedback
    FROM signal_class_feedback f WHERE workspace_id=wid AND city_slug=p_ref->>'citySlug'
      AND node_type=p_ref->>'type' AND node_id=p_ref->>'id' AND (scope='workspace' OR actor_id=actor);
  version := md5(jsonb_build_array(events,ai,manual,graph_version)::text);
  IF current_class IS NOT NULL THEN current_class := current_class || jsonb_build_object(
    'reasonCode',current_class->'reason_code','mcpClientId',current_class->'client_id',
    'user',current_class->'oauth_sub','promptId',current_class->'prompt_id',
    'promptSha256',current_class->'prompt_sha256','pipelineRunId',current_class->'pipeline_run_id',
    'createdAt',current_class->'created_at','updatedAt',coalesce(current_class->'updated_at',current_class->'created_at'),
    'validation',coalesce(current_class->>'validation',CASE WHEN current_class->>'source'='ai' THEN 'auto' ELSE 'human' END)); END IF;
  RETURN jsonb_build_object('version',version,'current',current_class,'ai',ai,
    'ambiguous',coalesce(current_class->>'classe'='non_classe',true),'history',history,
    'mcpHistory',events,'feedback',feedback || ui_feedback,'notes',notes);
END $$;
--> statement-breakpoint
CREATE FUNCTION signal_mcp_result(p_sub text,p_client text,p_model text,p_tool text,p_hash text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO signal_mcp_audit(sub,client_id,model,tool,input_hash,result)
    VALUES(p_sub,p_client,p_model,p_tool,p_hash,coalesce(p_result->>'error','written'));
  RETURN p_result;
END $$;
--> statement-breakpoint
CREATE FUNCTION signal_mcp_write(p_sub text,p_client text,p_tool text,p_body jsonb,p_validation text,
  p_version text,p_hash text,p_source text DEFAULT 'mcp') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ref jsonb := p_body->'signalRef'; wid uuid := (ref->>'workspaceId')::uuid;
  actor uuid; state jsonb; next_class text; v_code text := p_body->>'reasonCode';
  why text := btrim(p_body->>'reason'); model_name text := btrim(p_body->>'model');
  note text; event_id uuid; kind_name text; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-mcp-rate:' || p_sub,0));
  IF (SELECT count(*) FROM signal_mcp_audit WHERE sub=p_sub AND created_at>clock_timestamp()-interval '1 minute') >= 30 THEN
    RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,jsonb_build_object('error','rate_limited'));
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
        note := btrim(regexp_replace(regexp_replace(p_body->>'text','<[^>]*>','','g'),'[[:cntrl:]]','','g'));
        IF length(p_body->>'text')>2000 OR coalesce(note,'')='' THEN RAISE EXCEPTION 'invalid_note'; END IF;
      ELSE
        IF p_tool='confirm_classification' THEN
          IF p_validation<>'human' THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
          IF p_body->>'verdict' NOT IN ('up','down') THEN RAISE EXCEPTION 'invalid_verdict'; END IF;
          IF p_body->>'verdict'='down' AND (next_class IS NULL OR next_class='non_classe'
            OR next_class=state->'current'->>'classe' OR v_code IS NULL) THEN RAISE EXCEPTION 'reclassification_required'; END IF;
          IF p_body->>'verdict'='up' THEN
            v_code := state->'current'->>'reason_code'; why := 'Validated: ' || coalesce(state->'current'->>'reason','');
          END IF;
        END IF;
        IF next_class IS NULL OR next_class NOT IN ('pertinent','a_surveiller','ecarte','non_classe')
          OR coalesce(why,'')='' OR length(why)>2000 THEN RAISE EXCEPTION 'invalid_classification'; END IF;
        IF next_class='non_classe' THEN
          IF p_validation<>'human' THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
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
        IF state->'current'->>'source'='manual' OR (p_validation='auto' AND state->'current'->>'validation'='human') THEN
          RAISE EXCEPTION 'classification_priority_conflict';
        END IF;
      END IF;
      INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,
        model,client_id,oauth_sub,validation,classe,reason_code,reason,text,verdict,previous_version)
        VALUES(wid,actor,ref->>'scope',ref->>'citySlug',ref->>'type',ref->>'id',kind_name,p_source,
          model_name,p_client,p_sub,p_validation,next_class,v_code,why,note,p_body->>'verdict',p_version) RETURNING id INTO event_id;
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
  RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,result);
END $$;

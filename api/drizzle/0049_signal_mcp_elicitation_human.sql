-- Expand-only migration 0049 (owner decision 2026-11-21, Refs #1164):
-- MCP classifications with an accepted elicitation become human decisions
-- (`validation='human'`, `source_tag='mcp+elicitation'`) with full validation
-- trace (`actor_id`, `oauth_sub`, `elicitation_id`, `elicitation_accepted_at`).
-- MCP writes without an accepted elicitation remain unchanged (`source='mcp'`,
-- `validation='auto'`, `source_tag='mcp'`).
--> statement-breakpoint
ALTER TABLE signal_mcp_events ADD COLUMN IF NOT EXISTS source_tag text;
ALTER TABLE signal_mcp_events ADD COLUMN IF NOT EXISTS elicitation_id text;
ALTER TABLE signal_mcp_events ADD COLUMN IF NOT EXISTS elicitation_accepted_at timestamptz;
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS elicitation_id text;
ALTER TABLE signal_mcp_audit ADD COLUMN IF NOT EXISTS elicitation_status text;
--> statement-breakpoint
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'signal_mcp_events'::regclass
      AND contype = 'c'
      AND (conname = 'signal_mcp_events_authority_check'
        OR conname = 'signal_mcp_events_source_tag_check'
        OR pg_get_constraintdef(oid) LIKE '%linked_event_id%')
  LOOP
    EXECUTE format('ALTER TABLE signal_mcp_events DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'signal_mcp_audit'::regclass
      AND contype = 'c'
      AND conname = 'signal_mcp_audit_elicitation_status_check'
  LOOP
    EXECUTE format('ALTER TABLE signal_mcp_audit DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE signal_mcp_events
  ADD CONSTRAINT signal_mcp_events_source_tag_check
  CHECK (source_tag IS NULL OR source_tag IN ('mcp', 'mcp+elicitation', 'manual'));
ALTER TABLE signal_mcp_events
  ADD CONSTRAINT signal_mcp_events_authority_check
  CHECK (
    (source = 'mcp' AND validation = 'auto' AND linked_event_id IS NULL
      AND elicitation_id IS NULL AND elicitation_accepted_at IS NULL
      AND (source_tag IS NULL OR source_tag = 'mcp'))
    OR (source = 'mcp' AND validation = 'human' AND NOT pending_human AND linked_event_id IS NULL
      AND length(btrim(elicitation_id)) > 0 AND elicitation_accepted_at IS NOT NULL
      AND source_tag = 'mcp+elicitation')
    OR (source = 'manual' AND validation = 'human' AND NOT pending_human
      AND elicitation_id IS NULL AND elicitation_accepted_at IS NULL
      AND (source_tag IS NULL OR source_tag = 'manual')
      AND (kind = 'note' OR linked_event_id IS NOT NULL))
  );
ALTER TABLE signal_mcp_audit
  ADD CONSTRAINT signal_mcp_audit_elicitation_status_check
  CHECK (elicitation_status IS NULL OR elicitation_status IN ('not_requested', 'accepted', 'declined', 'unsupported'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signal_mcp_result(p_sub text,p_client text,p_model text,p_tool text,p_hash text,p_result jsonb,p_ref jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_elicit_id text := nullif(btrim(coalesce(p_result->>'elicitationId', p_ref->>'elicitationId', '')), '');
  v_elicit_status text := nullif(btrim(coalesce(p_result->>'elicitationStatus', p_ref->>'elicitationStatus', '')), '');
BEGIN
  IF v_elicit_status IS NOT NULL AND v_elicit_status NOT IN ('not_requested', 'accepted', 'declined', 'unsupported') THEN
    v_elicit_status := NULL;
  END IF;
  INSERT INTO signal_mcp_audit(sub,client_id,model,tool,input_hash,result,workspace_id,city_slug,node_type,node_id,elicitation_id,elicitation_status)
    VALUES(p_sub,p_client,p_model,p_tool,p_hash,coalesce(p_result->>'error','written'),
      (p_ref->>'workspaceId')::uuid,p_ref->>'citySlug',p_ref->>'type',p_ref->>'id',v_elicit_id,v_elicit_status);
  RETURN CASE WHEN p_result ? 'error'
    THEN p_result - 'elicitationStatus' - 'elicitationId'
    ELSE p_result - 'elicitationStatus' END;
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_result(text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
--> statement-breakpoint
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
      WHEN manual->>'facet'='archive' THEN 'ecarte' ELSE manual->>'basket' END,'validation','human','source_tag','manual');
  ELSE current_class := coalesce(current_class,ai); END IF;
  SELECT value INTO shared_class FROM jsonb_array_elements(events)
    WHERE value->>'kind' IN ('class','feedback') AND value->>'source'='manual' AND value->>'scope'='personal'
    ORDER BY (value->>'created_at')::timestamptz DESC,value->>'id' DESC LIMIT 1;
  IF shared_class IS NOT NULL AND (manual IS NULL OR
    (NOT (manual->>'facet'='archive' AND manual->>'state'='active' AND manual->>'superseded_by' IS NULL) AND
    (shared_class->>'created_at')::timestamptz > (manual->>'created_at')::timestamptz)) THEN current_class := shared_class; END IF;
  SELECT o.value INTO shared_class FROM jsonb_array_elements(events) AS o(value)
    WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
      AND (o.value->>'validation'='human' OR EXISTS (SELECT 1 FROM jsonb_array_elements(events) AS c(value)
        WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual'))
    ORDER BY (o.value->>'created_at')::timestamptz DESC,o.value->>'id' DESC LIMIT 1;
  IF shared_class->>'classe'='ecarte' THEN current_class := shared_class; END IF;
  SELECT o.value INTO pending_shared FROM jsonb_array_elements(events) AS o(value)
    WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
      AND o.value->>'source'='mcp' AND o.value->>'validation'='auto'
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
    'sourceTag',coalesce(current_class->>'source_tag',current_class->>'source'),
    'elicitationId',current_class->'elicitation_id',
    'elicitationAcceptedAt',current_class->'elicitation_accepted_at',
    'createdAt',current_class->'created_at','updatedAt',coalesce(current_class->'updated_at',current_class->'created_at'),
    'validation',coalesce(current_class->>'validation',CASE WHEN current_class->>'source'='ai' THEN 'auto' ELSE 'human' END)); END IF;
  RETURN jsonb_build_object('version',version,'current',current_class,'ai',ai,
    'canConfirm',(current_class->>'source'='mcp' AND current_class->>'validation'='auto' AND current_class->>'actor_id'=actor::text)
      OR pending_shared->>'actor_id'=actor::text,
    'moderateArchive',EXISTS (SELECT 1 FROM workspace_memberships WHERE workspace_id=wid AND account_id=actor AND status='active' AND moderate_archive),
    'ambiguous',coalesce((current_class->>'ambiguous')::boolean,current_class->>'classe'='non_classe',true),'history',history,
    'mcpHistory',events,'feedback',feedback || ui_feedback,'notes',notes,'pendingShared',pending_shared);
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_read(text,jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION signal_mcp_write_core(p_sub text,p_client text,p_tool text,p_body jsonb,p_validation text,
  p_version text,p_hash text,p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE ref jsonb := p_body->'signalRef'; wid uuid := (ref->>'workspaceId')::uuid;
  actor uuid; state jsonb; next_class text; v_code text := p_body->>'reasonCode';
  why text := btrim(p_body->>'reason'); model_name text := btrim(p_body->>'model');
  note text; event_id uuid; kind_name text; result jsonb;
  v_elicitation_id text := nullif(btrim(coalesce(p_body->>'elicitationId', '')), '');
  v_elicitation_at timestamptz;
  v_elicitation_status text := nullif(btrim(coalesce(p_body->>'elicitationStatus', '')), '');
  v_source_tag text;
  v_pending_human boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('signal-mcp-rate:' || p_sub,0));
  IF (SELECT count(*) FROM signal_mcp_audit WHERE sub=p_sub AND created_at>clock_timestamp()-interval '1 minute') >= 30 THEN
    RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,
      jsonb_build_object('error','rate_limited','elicitationId',v_elicitation_id,'elicitationStatus',v_elicitation_status),ref);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(array_to_json(ARRAY['workspace',wid::text])::text,0));
  PERFORM pg_advisory_xact_lock(hashtext('graph-city:' || (ref->>'citySlug')));
  PERFORM pg_advisory_xact_lock(hashtextextended(array_to_json(ARRAY['class-annotation',
    ref->>'citySlug',ref->>'type',ref->>'id'])::text,0));
  SELECT id INTO actor FROM account_users WHERE sub=p_sub AND status='approved' FOR SHARE;
  state := signal_mcp_read(p_sub,ref);
  BEGIN
    IF nullif(btrim(coalesce(p_body->>'elicitationAcceptedAt', '')), '') IS NOT NULL THEN
      BEGIN
        v_elicitation_at := (p_body->>'elicitationAcceptedAt')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid_signal_command';
      END;
    END IF;
    IF state ? 'error' THEN result := state;
    ELSIF p_source NOT IN ('mcp','manual') OR p_validation NOT IN ('auto','human')
      OR (p_source='manual' AND p_tool<>'annotate_signal')
      OR (p_source='mcp' AND p_validation='human' AND (p_tool NOT IN ('classify_signal','confirm_classification')
        OR v_elicitation_id IS NULL OR v_elicitation_at IS NULL))
      OR ref->>'scope' NOT IN ('personal','workspace') THEN
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
      IF p_source = 'manual' THEN
        v_source_tag := 'manual';
        v_elicitation_id := NULL;
        v_elicitation_at := NULL;
        v_pending_human := false;
      ELSIF p_validation = 'human' THEN
        v_source_tag := 'mcp+elicitation';
        v_pending_human := false;
        v_elicitation_status := 'accepted';
      ELSE
        v_source_tag := 'mcp';
        v_elicitation_id := NULL;
        v_elicitation_at := NULL;
        v_pending_human := coalesce((p_body->>'pendingHuman')::boolean,false);
        IF v_elicitation_status IS NULL THEN v_elicitation_status := 'not_requested'; END IF;
      END IF;

      IF kind_name='note' THEN
        note := btrim(regexp_replace(regexp_replace(p_body->>'text','<[^>]*>','','g'),'[\x00-\x08\x0B-\x1F\x7F]','','g'));
        IF length(p_body->>'text')>2000 OR coalesce(note,'')='' THEN RAISE EXCEPTION 'invalid_note'; END IF;
      ELSE
        IF p_tool='confirm_classification' THEN
          IF p_validation <> 'human' AND NOT v_pending_human THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
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
          IF p_validation <> 'human' AND NOT v_pending_human THEN RAISE EXCEPTION 'human_confirmation_required'; END IF;
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
      INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,source_tag,
        model,client_id,oauth_sub,validation,pending_human,elicitation_id,elicitation_accepted_at,
        classe,reason_code,reason,text,verdict,previous_version)
        VALUES(wid,actor,ref->>'scope',ref->>'citySlug',ref->>'type',ref->>'id',kind_name,p_source,v_source_tag,
          model_name,p_client,p_sub,p_validation,v_pending_human,v_elicitation_id,v_elicitation_at,
          next_class,v_code,why,note,p_body->>'verdict',p_version) RETURNING id INTO event_id;
      IF ref->>'scope'='personal' THEN
        INSERT INTO personal_projection_revisions(workspace_id,owner_id,city_slug,mode,revision)
          VALUES(wid,actor,ref->>'citySlug','signal',1) ON CONFLICT(workspace_id,owner_id,city_slug,mode)
          DO UPDATE SET revision=personal_projection_revisions.revision+1,updated_at=now();
      ELSE
        INSERT INTO workspace_projection_revisions(workspace_id,city_slug,mode,revision)
          VALUES(wid,ref->>'citySlug','signal',1) ON CONFLICT(workspace_id,city_slug,mode)
          DO UPDATE SET revision=workspace_projection_revisions.revision+1,updated_at=now();
      END IF;
      result := jsonb_build_object('id',event_id,'validation',p_validation,'sourceTag',v_source_tag,
        'elicitationId',v_elicitation_id,'elicitationAcceptedAt',v_elicitation_at);
    END IF;
  EXCEPTION WHEN raise_exception THEN result := jsonb_build_object('error',SQLERRM);
  END;
  RETURN signal_mcp_result(p_sub,p_client,model_name,p_tool,p_hash,
    result || jsonb_build_object('elicitationStatus',v_elicitation_status),ref);
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_write_core(text,text,text,jsonb,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
-- MCP entry point: accepted elicitation on classify_signal / confirm_classification
-- (elicitationId + elicitationAcceptedAt produced by the server elicitation flow)
-- records validation='human' with source_tag='mcp+elicitation'; without accepted
-- elicitation it remains validation='auto' with source_tag='mcp'.
CREATE OR REPLACE FUNCTION signal_mcp_write_mcp(p_sub text,p_client text,p_tool text,p_body jsonb,
  p_version text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_has_elicitation boolean := p_tool IN ('classify_signal','confirm_classification')
    AND length(btrim(coalesce(p_body->>'elicitationId',''))) > 0
    AND length(btrim(coalesce(p_body->>'elicitationAcceptedAt',''))) > 0;
BEGIN
  RETURN signal_mcp_write_core(
    p_sub, p_client, p_tool, p_body,
    CASE WHEN v_has_elicitation THEN 'human' ELSE 'auto' END,
    p_version, p_hash, 'mcp'
  );
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_write_mcp(text,text,text,jsonb,text,text) FROM PUBLIC;
--> statement-breakpoint
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
        WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
          AND o.value->>'source'='mcp' AND o.value->>'validation'='auto'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.events) AS c(value)
            WHERE c.value->>'linked_event_id'=o.value->>'id' AND c.value->>'source'='manual')
        ORDER BY (o.value->>'created_at')::timestamptz DESC, o.value->>'id' DESC LIMIT 1) AS pending_shared,
      (SELECT coalesce(jsonb_agg(value), '[]') FROM jsonb_array_elements(p.events)
        WHERE value->>'kind'='note') AS notes,
      (SELECT o.value FROM jsonb_array_elements(p.events) AS o(value)
        WHERE o.value->>'kind' IN ('class','feedback') AND o.value->>'scope'='workspace'
          AND (o.value->>'validation'='human' OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.events) AS c(value)
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
      FROM per p),
  resolved AS (
    SELECT s.id, s.type, s.version, s.ai, s.pending_shared, s.notes,
      CASE
        WHEN s.shared->>'classe'='ecarte' THEN s.shared
        WHEN s.shared_manual IS NOT NULL AND (s.manual IS NULL OR
          (NOT (s.manual->>'facet'='archive' AND s.manual->>'state'='active' AND s.manual->>'superseded_by' IS NULL) AND
           (s.shared_manual->>'created_at')::timestamptz > (s.manual->>'created_at')::timestamptz)) THEN s.shared_manual
        WHEN s.manual IS NOT NULL THEN s.manual || jsonb_build_object('classe',
          CASE WHEN s.manual->>'state'='inactive' THEN 'non_classe'
            WHEN s.manual->>'facet'='archive' THEN 'ecarte' ELSE s.manual->>'basket' END,
          'validation', 'human', 'source_tag', 'manual')
        WHEN s.personal IS NOT NULL AND NOT coalesce(s.personal->>'validation'='auto' AND
          (s.ai->>'updated_at')::timestamptz > (s.personal->>'created_at')::timestamptz, false) THEN s.personal
        ELSE s.ai END AS current_raw
      FROM states s)
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', r.type, 'id', r.id, 'state',
    jsonb_build_object('version', r.version,
      'current', CASE WHEN r.current_raw IS NULL THEN NULL ELSE r.current_raw || jsonb_build_object(
        'sourceTag', coalesce(r.current_raw->>'source_tag', r.current_raw->>'source'),
        'elicitationId', r.current_raw->'elicitation_id',
        'elicitationAcceptedAt', r.current_raw->'elicitation_accepted_at') END,
      'ai', r.ai, 'pendingShared', r.pending_shared,
      'canConfirm', (r.current_raw->>'source'='mcp' AND r.current_raw->>'validation'='auto' AND r.current_raw->>'actor_id'=actor::text)
        OR r.pending_shared->>'actor_id'=actor::text,
      'moderateArchive', moderate,
      'history', '[]'::jsonb, 'mcpHistory', '[]'::jsonb, 'feedback', '[]'::jsonb,
      'notes', r.notes))), '[]'::jsonb) INTO result FROM resolved r;
  RETURN coalesce(result, '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION signal_mcp_read_city(text,uuid,text) FROM PUBLIC;

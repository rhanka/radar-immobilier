ALTER TABLE signal_class_annotations ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE signal_class_annotations SET created_at = updated_at WHERE created_at IS NULL;
ALTER TABLE signal_class_annotations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE signal_class_annotations ALTER COLUMN created_at SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_class_annotation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_slug text NOT NULL, node_type text NOT NULL, node_id text NOT NULL,
  classe text NOT NULL CHECK (classe IN ('pertinent','a_surveiller','ecarte','non_classe')),
  reason text NOT NULL, source text NOT NULL CHECK (source = 'ai'),
  model text NOT NULL, effort text NOT NULL, prompt_id text NOT NULL,
  prompt_sha256 text NOT NULL, pipeline_run_id text NOT NULL, input_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO signal_class_annotation_history
  (city_slug,node_type,node_id,classe,reason,source,model,effort,prompt_id,prompt_sha256,pipeline_run_id,input_sha256,created_at)
  SELECT city_slug,node_type,node_id,classe,reason,source,model,effort,prompt_id,prompt_sha256,pipeline_run_id,input_sha256,updated_at
  FROM signal_class_annotations a WHERE source='ai' AND NOT EXISTS (
    SELECT 1 FROM signal_class_annotation_history h
    WHERE (h.city_slug,h.node_type,h.node_id,h.classe,h.reason,h.source,h.model,h.effort,
      h.prompt_id,h.prompt_sha256,h.pipeline_run_id,h.input_sha256,h.created_at)
      IS NOT DISTINCT FROM (a.city_slug,a.node_type,a.node_id,a.classe,a.reason,a.source,a.model,a.effort,
        a.prompt_id,a.prompt_sha256,a.pipeline_run_id,a.input_sha256,a.updated_at)
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_signal_class_annotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'ai' THEN
    INSERT INTO signal_class_annotation_history
      (city_slug,node_type,node_id,classe,reason,source,model,effort,prompt_id,prompt_sha256,pipeline_run_id,input_sha256,created_at)
      VALUES (NEW.city_slug,NEW.node_type,NEW.node_id,NEW.classe,NEW.reason,NEW.source,NEW.model,
        NEW.effort,NEW.prompt_id,NEW.prompt_sha256,NEW.pipeline_run_id,NEW.input_sha256,NEW.updated_at);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS signal_class_annotation_record ON signal_class_annotations;
CREATE TRIGGER signal_class_annotation_record AFTER INSERT OR UPDATE ON signal_class_annotations
  FOR EACH ROW EXECUTE FUNCTION record_signal_class_annotation();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_class_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_slug text NOT NULL, node_type text NOT NULL, node_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id uuid NOT NULL REFERENCES account_users(id),
  scope text NOT NULL CHECK (scope IN ('personal','workspace')),
  command_key uuid NOT NULL, command_digest text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('up','down')),
  annotation_id uuid NOT NULL REFERENCES signal_class_annotation_history(id),
  source text NOT NULL CHECK (source='ai'), model text NOT NULL, prompt_sha256 text NOT NULL,
  pipeline_run_id text NOT NULL, judged_class text NOT NULL,
  human_class text NOT NULL CHECK (human_class IN ('pertinent','a_surveiller','ecarte','non_classe')),
  reason_code text, reason text NOT NULL, comment text CHECK (length(comment) <= 2000),
  event_id uuid NOT NULL REFERENCES facet_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id,command_key),
  CHECK ((verdict='up' AND human_class=judged_class) OR
    (verdict='down' AND human_class<>judged_class AND human_class<>'non_classe' AND reason_code IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS signal_class_feedback_scope_idx ON signal_class_feedback(workspace_id,city_slug,actor_id);
--> statement-breakpoint
ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS class_feedback_id uuid REFERENCES signal_class_feedback(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facet_events DROP CONSTRAINT IF EXISTS chk_facet_events_archive_reason;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'facet_events'::regclass
    AND conname = 'chk_facet_events_archive_reason') THEN
    ALTER TABLE facet_events ADD CONSTRAINT chk_facet_events_archive_reason
      CHECK (facet <> 'archive' OR state <> 'active' OR reason_code IS NOT NULL OR class_feedback_id IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_class_feedback_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Class annotation audit rows are append-only'; END $$;
DROP TRIGGER IF EXISTS signal_class_history_immutable ON signal_class_annotation_history;
CREATE TRIGGER signal_class_history_immutable BEFORE UPDATE OR DELETE ON signal_class_annotation_history
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_class_feedback_immutable ON signal_class_feedback;
CREATE TRIGGER signal_class_feedback_immutable BEFORE UPDATE OR DELETE ON signal_class_feedback
  FOR EACH ROW EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_class_history_no_truncate ON signal_class_annotation_history;
CREATE TRIGGER signal_class_history_no_truncate BEFORE TRUNCATE ON signal_class_annotation_history
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();
DROP TRIGGER IF EXISTS signal_class_feedback_no_truncate ON signal_class_feedback;
CREATE TRIGGER signal_class_feedback_no_truncate BEFORE TRUNCATE ON signal_class_feedback
  FOR EACH STATEMENT EXECUTE FUNCTION reject_class_feedback_mutation();

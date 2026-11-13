ALTER TABLE facet_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
  CHECK (source IN ('ai', 'manual'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facet_events_manual_class_target_idx
  ON facet_events (city_slug, node_type, node_id) WHERE target_type='signal' AND source='manual';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS signal_class_annotations (
  city_slug text NOT NULL,
  node_type text NOT NULL,
  node_id text NOT NULL,
  classe text NOT NULL CHECK (classe IN ('pertinent', 'a_surveiller', 'non_classe', 'ecarte')),
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'manual')),
  model text,
  effort text,
  prompt_id text,
  prompt_sha256 text,
  pipeline_run_id text,
  input_sha256 text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_slug, node_type, node_id),
  CHECK (source = 'manual' OR (model IS NOT NULL AND effort IS NOT NULL
    AND prompt_id IS NOT NULL AND prompt_sha256 IS NOT NULL AND prompt_sha256 ~ '^[a-f0-9]{64}$'
    AND pipeline_run_id IS NOT NULL AND input_sha256 IS NOT NULL AND input_sha256 ~ '^[a-f0-9]{64}$'))
);

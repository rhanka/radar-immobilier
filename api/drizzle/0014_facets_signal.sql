-- Personal signal facets. Runtime taxonomy is owned by this versioned profile.
CREATE TABLE IF NOT EXISTS facet_reason_codes (
  profile_id text NOT NULL,
  code text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pertinent', 'a_surveiller', 'non_pertinent')),
  PRIMARY KEY (profile_id, code),
  UNIQUE (profile_id, code, verdict)
);
--> statement-breakpoint
INSERT INTO facet_reason_codes (profile_id, code, verdict) VALUES
  ('immo-steve-2026-09', 'P-VILLE-TERRITOIRE', 'pertinent'),
  ('immo-steve-2026-09', 'P-NOUV-ZONE', 'pertinent'),
  ('immo-steve-2026-09', 'P-PERIM-URB', 'pertinent'),
  ('immo-steve-2026-09', 'P-DENSITE', 'pertinent'),
  ('immo-steve-2026-09', 'P-USAGE-MULTI', 'pertinent'),
  ('immo-steve-2026-09', 'P-TYPO-INTERM', 'pertinent'),
  ('immo-steve-2026-09', 'P-PROJ-INTEGRE', 'pertinent'),
  ('immo-steve-2026-09', 'P-NORMES', 'pertinent'),
  ('immo-steve-2026-09', 'S-MANDAT-AMONT', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-PLANIFIE', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-PORTEE-FLOUE', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-CONTRAINTE', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-RESTRICTIF', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-INFO-MANQUANTE', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-PPCMOI-SERIE', 'a_surveiller'),
  ('immo-steve-2026-09', 'S-PREEMPTION', 'a_surveiller'),
  ('immo-steve-2026-09', 'N-ACCESSOIRE', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-RETIRE', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-FORME', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-ODJ-SEUL', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-NON-RES', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-ADMIN', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-RESTRICTIF', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-UNIFAM', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-DOUBLON', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-HORS-TERR', 'non_pertinent'),
  ('immo-steve-2026-09', 'N-FAUX-POSITIF', 'non_pertinent'),
  ('immo-steve-2026-09', 'V2-PRECEDENT', 'non_pertinent')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facet_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'personal' CHECK (scope = 'personal'),
  owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  target_type text NOT NULL DEFAULT 'signal' CHECK (target_type = 'signal'),
  city_slug text NOT NULL CHECK (city_slug <> ''),
  node_type text NOT NULL CHECK (node_type IN ('Signal', 'DesignationEvent')),
  node_id text NOT NULL CHECK (node_id <> ''),
  facet text NOT NULL CHECK (facet IN ('selection', 'archive')),
  basket text,
  state text NOT NULL CHECK (state IN ('active', 'inactive')),
  profile_id text,
  reason_code text,
  verdict text,
  observed_fingerprint text NOT NULL CHECK (observed_fingerprint ~ '^[a-f0-9]{64}$'),
  command_key uuid NOT NULL,
  command_digest text NOT NULL CHECK (command_digest ~ '^[a-f0-9]{64}$'),
  supersedes uuid REFERENCES facet_events(id) ON DELETE RESTRICT,
  superseded_by uuid REFERENCES facet_events(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_id = owner_id),
  CHECK ((facet = 'selection' AND basket IS NOT NULL AND basket IN ('pertinent', 'a_surveiller'))
      OR (facet = 'archive' AND basket IS NULL)),
  CHECK ((profile_id IS NULL AND reason_code IS NULL AND verdict IS NULL)
      OR (profile_id IS NOT NULL AND reason_code IS NOT NULL AND verdict IS NOT NULL
          AND ((facet = 'selection' AND verdict = basket)
            OR (facet = 'archive' AND verdict = 'non_pertinent')))),
  CHECK (facet <> 'archive' OR state <> 'active' OR reason_code IS NOT NULL),
  CHECK (supersedes IS DISTINCT FROM id AND superseded_by IS DISTINCT FROM id),
  FOREIGN KEY (profile_id, reason_code, verdict)
    REFERENCES facet_reason_codes(profile_id, code, verdict)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS facet_events_head_idx
  ON facet_events (scope, owner_id, facet, basket, city_slug, node_type, node_id)
  NULLS NOT DISTINCT WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS facet_events_discarded_idx
  ON facet_events (owner_id, city_slug, node_type, node_id)
  WHERE scope = 'personal' AND facet = 'archive' AND state = 'active' AND superseded_by IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_facet_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL
       AND (to_jsonb(OLD) - 'superseded_by') = (to_jsonb(NEW) - 'superseded_by') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'facet events are append-only';
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER facet_events_immutable
  BEFORE UPDATE OR DELETE ON facet_events FOR EACH ROW EXECUTE FUNCTION guard_facet_event();
--> statement-breakpoint
-- A no-op must consume its key without creating a domain event.
CREATE TABLE IF NOT EXISTS facet_commands (
  owner_id uuid NOT NULL REFERENCES account_users(id) ON DELETE RESTRICT,
  command_key uuid NOT NULL,
  command_digest text NOT NULL CHECK (command_digest ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  PRIMARY KEY (owner_id, command_key)
);
CREATE OR REPLACE FUNCTION guard_facet_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'facet commands are immutable';
END $$;
CREATE OR REPLACE TRIGGER facet_commands_immutable
  BEFORE UPDATE OR DELETE ON facet_commands FOR EACH ROW EXECUTE FUNCTION guard_facet_command();

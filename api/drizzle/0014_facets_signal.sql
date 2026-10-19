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

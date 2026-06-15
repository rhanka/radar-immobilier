-- G1 — Géo-mapper : tables de résolution zone/lot + enrichissement colonnes géométrie.
--
-- Ce fichier ajoute :
--   1. Extension PostGIS (si non présente)
--   2. Colonnes géométrie + code_norm / no_lot_norm sur zone_versions / lot_versions
--   3. Indexes GiST sur geom + index sur code_norm/no_lot_norm
--   4. Table geo_resolutions  : arêtes Signal/DesignationEvent → Zone/Lot
--   5. Table geo_unresolved   : audit des non-résolus
--
-- Auteur : rhanka — 2026-06-15
-- Spec   : docs/spec/cadrage-geo-integration-mapper.md §2.4
--
-- NOTE PostGIS : si la colonne geom est déjà de type geometry dans zone_versions /
-- lot_versions (migration 0001), les ALTER COLUMN sont des no-ops sûrs via IF EXISTS.
-- Si PostGIS n'est pas disponible dans l'image postgres de test, les CREATE INDEX
-- USING GIST échoueront ; dans ce cas utiliser la variante JSONB documentée ci-dessous
-- (TODO).

--> statement-breakpoint

-- 1. Extension PostGIS
--    Requiert que l'image postgres inclue le paquet postgis (ex. postgis/postgis:16-3.4).
--    Si non disponible : remplacer geometry(...) par jsonb + noter le TODO.
CREATE EXTENSION IF NOT EXISTS postgis;

--> statement-breakpoint

-- 2a. Enrichissement zone_versions : code_norm + colonnes géo complètes
--     geom existe déjà (migration 0001, type geometry(Geometry,4326)).
--     On ajoute code_norm et geom_fetched_at.

ALTER TABLE "zone_versions"
  ADD COLUMN IF NOT EXISTS "code_norm" text,
  ADD COLUMN IF NOT EXISTS "geom_fetched_at" timestamptz;

--> statement-breakpoint

-- 2b. Enrichissement lot_versions : no_lot_norm + colonnes géo complètes
ALTER TABLE "lot_versions"
  ADD COLUMN IF NOT EXISTS "no_lot_norm" text,
  ADD COLUMN IF NOT EXISTS "geom_fetched_at" timestamptz;

--> statement-breakpoint

-- 3a. Index GiST sur zone_versions.geom (si colonne geom présente)
--     Note : si PostGIS non disponible, cet index sera ignoré dans les tests
--     en retombant sur un btree (ne fonctionne pas sur geometry — l'erreur est attendue).
CREATE INDEX IF NOT EXISTS "zone_versions_geom_gist_idx"
  ON "zone_versions" USING GIST ("geom");

--> statement-breakpoint

-- 3b. Index sur code_norm + city_slug (lookup O(1) du mapper)
CREATE INDEX IF NOT EXISTS "zone_versions_code_norm_city_idx"
  ON "zone_versions" ("code_norm", "city_slug");

--> statement-breakpoint

-- 3c. Index GiST sur lot_versions.geom
CREATE INDEX IF NOT EXISTS "lot_versions_geom_gist_idx"
  ON "lot_versions" USING GIST ("geom");

--> statement-breakpoint

-- 3d. Index sur no_lot_norm
CREATE INDEX IF NOT EXISTS "lot_versions_no_lot_norm_idx"
  ON "lot_versions" ("no_lot_norm");

--> statement-breakpoint

-- 4. Table geo_resolutions
--    Arête Signal/DesignationEvent → Zone ou Lot résolue.
--    Idempotente : UNIQUE sur (node_id, relation_type, target_id).
--    as_of_date = date du signal/événement source (bitemporal knowledge-time).

CREATE TABLE IF NOT EXISTS "geo_resolutions" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id"         text NOT NULL,
  "node_type"       text NOT NULL,        -- 'Signal' | 'DesignationEvent'
  "city_slug"       text NOT NULL,
  "relation_type"   text NOT NULL,        -- 'concerns_zone' | 'concerns_lot'
  "target_id"       text NOT NULL,        -- canonical_id de la Zone ou du Lot
  "target_type"     text NOT NULL,        -- 'Zone' | 'Lot'
  "extrait_brut"    text,                 -- texte brut extrait (provenance)
  "score_confiance" numeric(3,2) NOT NULL CHECK ("score_confiance" BETWEEN 0 AND 1),
  "provenance"      text NOT NULL,        -- 'zone_explicit' | 'zone_standard' | 'lot_explicit' | ...
  "as_of_date"      date,
  "resolved_at"     timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "geo_resolutions_natural_key_idx"
  ON "geo_resolutions" ("node_id", "relation_type", "target_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "geo_resolutions_node_idx"
  ON "geo_resolutions" ("node_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "geo_resolutions_city_idx"
  ON "geo_resolutions" ("city_slug");

--> statement-breakpoint

-- 5. Table geo_unresolved
--    Audit des extractions non résolues (score trop bas, aucun polygone, ambiguïté).
--    Sert à mesurer le taux de non-résolution et à guider l'amélioration continue.

CREATE TABLE IF NOT EXISTS "geo_unresolved" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id"         text NOT NULL,
  "node_type"       text NOT NULL,
  "city_slug"       text NOT NULL,
  "extrait_brut"    text,
  "pattern_type"    text NOT NULL,        -- 'zone_code' | 'no_lot'
  "score_confiance" numeric(3,2)          CHECK ("score_confiance" IS NULL OR "score_confiance" BETWEEN 0 AND 1),
  "raison"          text NOT NULL,        -- 'no_polygon' | 'score_too_low' | 'ambiguous' | 'no_extract'
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "geo_unresolved_node_idx"
  ON "geo_unresolved" ("node_id");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "geo_unresolved_city_idx"
  ON "geo_unresolved" ("city_slug");

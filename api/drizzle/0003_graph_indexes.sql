-- WP A.3.1 — Graph store: index additionnels pour les patterns de lecture.
--
-- 1. Composite (city_slug, type) : filtre par ville + type en une passe.
-- 2. Colonne générée label_tsv + index GIN full-text français.
-- 3. Index GIN JSONB sur graph_nodes.props et graph_edges.props.
-- 4. Extension pg_trgm + index trigram sur label (ILIKE / recherche approx).
--
-- Hand-authored (additive DDL only). Pas de suppression d'index existants.

-- 1. Composite city_slug + type (évite un filter post-scan sur l'index city_idx)
CREATE INDEX IF NOT EXISTS "graph_nodes_city_type_idx"
  ON "graph_nodes" ("city_slug", "type");
--> statement-breakpoint

-- 2a. Colonne générée pour le full-text français
ALTER TABLE "graph_nodes"
  ADD COLUMN IF NOT EXISTS "label_tsv" tsvector
    GENERATED ALWAYS AS (to_tsvector('french', "label")) STORED;
--> statement-breakpoint

-- 2b. Index GIN sur la colonne générée
CREATE INDEX IF NOT EXISTS "graph_nodes_label_tsv_idx"
  ON "graph_nodes" USING GIN ("label_tsv");
--> statement-breakpoint

-- 3. Index GIN JSONB sur les props des nœuds
CREATE INDEX IF NOT EXISTS "graph_nodes_props_gin_idx"
  ON "graph_nodes" USING GIN ("props");
--> statement-breakpoint

-- 4. Index GIN JSONB sur les props des arêtes
CREATE INDEX IF NOT EXISTS "graph_edges_props_gin_idx"
  ON "graph_edges" USING GIN ("props");
--> statement-breakpoint

-- 5. Trigram (ILIKE / recherche approx sur label)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_nodes_label_trgm_idx"
  ON "graph_nodes" USING GIN ("label" gin_trgm_ops);

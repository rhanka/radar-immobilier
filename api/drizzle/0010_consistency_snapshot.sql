-- Migration 0010 — WP3 LOT1 : snapshot batch de cohérence E2E par ville.
--
-- Une ligne par ville CIBLÉE par le job `run-consistency-snapshot` (focus-30
-- par défaut, extensible province). Upsert sur city_slug : chaque run
-- réécrit la ligne avec la mesure la plus récente (mode batch PG, JAMAIS live
-- sur les 1104 villes). `payload` porte le contrat `CityConsistency` complet
-- (edges pvSignal/signalZone, bloqueurs, mode) ; `state`/`generated_at` sont
-- dupliqués en colonnes pour un filtre SQL bon marché sans parser le JSON.
--
-- Auteur : rhanka — 2026-07-06
-- Spec   : docs/spec/reports/DESIGN_E2E_CONSISTENCY_SOURCES.md

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consistency_snapshots" (
  "city_slug"     text PRIMARY KEY,
  "generated_at"  timestamptz NOT NULL,
  "state"         text NOT NULL CHECK ("state" IN ('coherent', 'partial', 'unmeasured')),
  "payload"       jsonb NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "consistency_snapshots_state_idx"
  ON "consistency_snapshots" ("state");

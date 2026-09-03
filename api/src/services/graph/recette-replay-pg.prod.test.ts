import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { classifyBPrime } from "@radar/domain";
import {
  aggregateGraphSignalProjectionRows,
  type GraphSignalProjectionRow,
} from "./graph-store.js";

/**
 * HARNAIS DE REJEU RECETTE — variante PROD PG (source de vérité fidèle).
 *
 * Rejoue la classification vivier/B′ sur le DUMP EXACT de la projection SQL
 * `listCitiesWithSignalNodes` extraite de radar_postgres (prod), 7221 lignes.
 * Chaque ligne NDJSON EST déjà une `GraphSignalProjectionRow` (colonnes
 * projetées par les mêmes opérateurs jsonb `props->'properties'->>'x'` que la
 * requête serveur). On ne re-dérive RIEN : on rejoue le vrai chemin serveur.
 *
 * SKIPPÉ sauf si `RECETTE_PG_NDJSON` pointe vers le dump.
 *
 * CONTRÔLE DE VALIDITÉ OBLIGATOIRE : DOIT reproduire 7221 nœuds / 724 villes
 * et 6777 signaux éligibles B′ / 720 villes. Sinon → pipeline faux.
 */

const NDJSON = process.env.RECETTE_PG_NDJSON ?? "";

const RUN_PG = Boolean(NDJSON && existsSync(NDJSON));

describe("recette replay — prod PG dump (source de vérité)", () => {
  (RUN_PG ? it : it.skip)(
    "reproduit le contrôle 7221/724 et 6777/720 sur le dump prod PG",
    () => {
      const rows: GraphSignalProjectionRow[] = readFileSync(NDJSON, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as GraphSignalProjectionRow);

      const citiesWithSignal = new Set<string>();
      const citiesWithEligible = new Set<string>();
      let eligibleSignals = 0;

      for (const row of rows) {
        if (!row.citySlug) continue;
        citiesWithSignal.add(row.citySlug);
        const eligible =
          classifyBPrime({
            category: row.category ?? null,
            label: row.label,
            description: row.description ?? null,
            etapeAnnotation: row.etapeAnnote ?? null,
            props: row.props as Record<string, unknown>,
            sourceRef: row.sourceRef,
          }).exclusionReason === null;
        if (eligible) {
          eligibleSignals += 1;
          citiesWithEligible.add(row.citySlug);
        }
      }

      const cityCounts = aggregateGraphSignalProjectionRows(rows);
      // Axe résidentiel = Σ subsetCounts["r"] (éligible ET résidentiel-pertinent).
      let residentielRows = 0;
      const citiesResidentiel = new Set<string>();
      // vivier_v2 "qualified" (zonage∩résidentiel oui) agrégé.
      let vivierQualified = 0;
      const citiesQualified = new Set<string>();
      for (const c of cityCounts) {
        const rTotal = c.subsetCounts["r"] ?? 0;
        if (rTotal > 0) {
          residentielRows += rTotal;
          citiesResidentiel.add(c.citySlug);
        }
        const q = c.vivierV2Counts.qualified ?? 0;
        if (q > 0) {
          vivierQualified += q;
          citiesQualified.add(c.citySlug);
        }
      }

      const report = {
        totalSignalNodes: rows.length,
        citiesWithSignal: citiesWithSignal.size,
        eligibleSignals,
        citiesWithEligible: citiesWithEligible.size,
        residentielRows,
        citiesResidentiel: citiesResidentiel.size,
        vivierQualified,
        citiesQualified: citiesQualified.size,
      };
      console.log("RECETTE_PG_REPORT " + JSON.stringify(report, null, 2));
      const control = {
        nodes_7221: rows.length === 7221,
        cities_724: citiesWithSignal.size === 724,
        eligible_6777: eligibleSignals === 6777,
        cities_720: citiesWithEligible.size === 720,
      };
      console.log("RECETTE_PG_CONTROL " + JSON.stringify(control));

      // Contrôle DUR sur la source de vérité prod PG.
      expect(rows.length).toBe(7221);
      expect(citiesWithSignal.size).toBe(724);
      expect(eligibleSignals).toBe(6777);
      expect(citiesWithEligible.size).toBe(720);
    },
    120000,
  );
});

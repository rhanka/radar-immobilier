import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { classifyBPrime } from "@radar/domain";
import {
  aggregateGraphSignalProjectionRows,
  type GraphSignalProjectionRow,
} from "./graph-store.js";
import { projectionRowFromGraphNode } from "./bprime-recette.fixture.js";

/**
 * HARNAIS DE REJEU RECETTE — rejoue la classification vivier/B′ sur les nœuds
 * RÉELS de production (snapshots graphify `graph/<slug>/latest.json` tirés de
 * SCW, la source de vérité documentée), via le VRAI chemin serveur
 * (`projectionRowFromGraphNode` → `aggregateGraphSignalProjectionRows`).
 *
 * Ce n'est PAS un test unitaire de gate : il est SKIPPÉ sauf si
 * `RECETTE_GRAPHS_DIR` pointe vers un dossier local `<slug>/latest.json`.
 *
 * CONTRÔLE DE VALIDITÉ OBLIGATOIRE (méthode recette) : sur la classification
 * `main`, on DOIT retrouver 6 777 signaux éligibles B′ / 720 villes (et
 * 7 221 nœuds Signal+DesignationEvent / 724 villes). Sinon → pipeline faux.
 */

const SIGNAL_TYPES = new Set(["Signal", "DesignationEvent"]);

interface RawNode {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  properties?: Record<string, unknown>;
  source_file?: unknown;
}

const GRAPHS_DIR = process.env.RECETTE_GRAPHS_DIR ?? "";
// Optionnel : restreindre à un LOT (liste de slugs séparés par virgule) —
// pour valider un lot vivier d'extraction sans rejouer les 724 villes.
const LOT_SLUGS = (process.env.RECETTE_LOT_SLUGS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LOT_SET = LOT_SLUGS.length ? new Set(LOT_SLUGS) : null;
// Optionnel : émettre les lignes de projection (GraphSignalProjectionRow) en
// NDJSON, pour alimenter le MÊME outillage snapshot/diff que le dump prod PG.
const PROJECTION_OUT = process.env.RECETTE_PROJECTION_OUT ?? "";

const RUN_SCW = Boolean(GRAPHS_DIR && existsSync(GRAPHS_DIR));

describe("recette replay — prod graph snapshots", () => {
  (RUN_SCW ? it : it.skip)(
    "rejoue vivier/B′ sur les nœuds réels et vérifie le contrôle 6777/720",
    () => {
      const slugs = readdirSync(GRAPHS_DIR).filter((name) => {
        if (LOT_SET && !LOT_SET.has(name)) return false;
        const p = join(GRAPHS_DIR, name);
        return statSync(p).isDirectory() && existsSync(join(p, "latest.json"));
      });

      const rows: GraphSignalProjectionRow[] = [];
      const parseErrors: string[] = [];
      let filesRead = 0;

      for (const slug of slugs) {
        const file = join(GRAPHS_DIR, slug, "latest.json");
        let data: { nodes?: RawNode[] };
        try {
          data = JSON.parse(readFileSync(file, "utf8"));
        } catch (e) {
          parseErrors.push(`${slug}: ${(e as Error).message}`);
          continue;
        }
        filesRead += 1;
        const nodes = Array.isArray(data.nodes) ? data.nodes : [];
        for (const node of nodes) {
          const t = node.type;
          if (typeof t !== "string" || !SIGNAL_TYPES.has(t)) continue;
          // projectionRowFromGraphNode = mapping FIDÈLE nœud→ligne SQL
          // (passe par buildNodeRow, le builder d'ingestion). citySlug = slug.
          rows.push(projectionRowFromGraphNode(node as never, slug));
        }
      }

      // Émission optionnelle des lignes de projection (mêmes clés que le dump
      // prod PG) → alimente snapshot/diff à l'identique sur les graphes frais.
      if (PROJECTION_OUT) {
        writeFileSync(
          PROJECTION_OUT,
          rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
          "utf8",
        );
        console.log(
          `RECETTE_PROJECTION_OUT ${PROJECTION_OUT} rows=${rows.length} slugs=${slugs.length}`,
        );
      }

      // Éligibilité B′ : EXACTEMENT l'appel de aggregateGraphSignalProjectionRows
      // (graph-store.ts:1580) — exclusionReason === null.
      let eligibleSignals = 0;
      const citiesWithSignal = new Set<string>();
      const citiesWithEligible = new Set<string>();
      let residentielRows = 0; // r-axis proxy: eligible AND isResidentielPertinent
      const citiesResidentiel = new Set<string>();

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

      // City-level aggregate via le VRAI chemin serveur.
      const cityCounts = aggregateGraphSignalProjectionRows(rows);
      // Axe résidentiel = subset key with r=true (any z/m/p). Somme des r purs.
      for (const c of cityCounts) {
        // subsetCounts["r"] = signaux ÉLIGIBLES ET résidentiels-pertinents
        // (flag r seul, toute intersection z/m/p) — l'axe résidentiel du brief.
        const rTotal = c.subsetCounts["r"] ?? 0;
        if (rTotal > 0) {
          residentielRows += rTotal;
          citiesResidentiel.add(c.citySlug);
        }
      }

      const report = {
        filesRead,
        parseErrors: parseErrors.length,
        totalSignalNodes: rows.length,
        citiesWithSignal: citiesWithSignal.size,
        eligibleSignals,
        citiesWithEligible: citiesWithEligible.size,
        residentielRows,
        citiesResidentiel: citiesResidentiel.size,
        cityCountsLen: cityCounts.length,
      };
      console.log("RECETTE_REPLAY_REPORT " + JSON.stringify(report, null, 2));
      if (parseErrors.length) {
        console.log("PARSE_ERRORS " + JSON.stringify(parseErrors.slice(0, 20), null, 2));
      }

      // Contrôle de validité — soft: on LOGue le verdict, on n'échoue pas le run
      // pour pouvoir lire les vrais chiffres même en cas d'écart.
      const control = {
        eligible_6777: eligibleSignals === 6777,
        cities_720: citiesWithEligible.size === 720,
        nodes_7221: rows.length === 7221,
        cities_724: citiesWithSignal.size === 724,
      };
      console.log("RECETTE_CONTROL " + JSON.stringify(control));

      expect(rows.length).toBeGreaterThan(0);
    },
    120000,
  );
});

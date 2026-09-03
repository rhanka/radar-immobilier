import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isResidentialEligible } from "@radar/domain";
import { classifyVivierSignal, type VivierSignalInput } from "./vivier-v2.js";

/**
 * GÉNÉRATEUR DE SNAPSHOT D'APPARTENANCE B′ — surface minimale et STABLE pour
 * rejouer la classification à n'importe quel ref git (blob checkout).
 *
 * N'importe QUE `classifyVivierSignal` (api/vivier-v2.ts) et
 * `isResidentialEligible` (@radar/domain) — deux exports stables sur toute la
 * série des correctifs B′ — afin qu'un `git checkout <ref> -- <fichiers classif>`
 * suffise à rejouer une version historique sans toucher au reste.
 *
 * Entrée : `RECETTE_PG_NDJSON` = dump prod PG (7221 lignes de projection).
 * Sortie : `RECETTE_SNAPSHOT_OUT` = 1 ligne/signal : appartenances par id.
 *
 * Ensembles d'appartenance (du plus large au plus strict) :
 *   - eligible  : exclusion_reason === null (l'univers B′ éligible)
 *   - bPerim    : eligible ET zonage=oui (périmètre B)
 *   - resElig   : bPerim ET isResidentialEligible (axe R / B′)
 *   - precoce   : bPerim ET etape ∈ {avis_motion, projet_reglement}
 *   - bprime    : precoce ET resElig (vivier B′ précoce résidentiel — le plus strict)
 */

const NDJSON = process.env.RECETTE_PG_NDJSON ?? "";
const OUT = process.env.RECETTE_SNAPSHOT_OUT ?? "";
const PRECOCE_STAGES = new Set(["avis_motion", "projet_reglement"]);

interface Row {
  id: string;
  citySlug: string | null;
  type: string;
  category: string | null;
  label: string;
  nbUnitesMax: string | null;
  intensite: string | null;
  description: string | null;
  etapeAnnote: string | null;
  props: unknown;
  sourceRef: string | null;
}

const RUN_SNAP = Boolean(NDJSON && existsSync(NDJSON) && OUT);

describe("recette membership snapshot", () => {
  (RUN_SNAP ? it : it.skip)(
    "émet le snapshot d'appartenance B′ par id (rejouable à tout ref)",
    () => {
      const rows: Row[] = readFileSync(NDJSON, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Row);

      const lines: string[] = [];
      const tally = {
        total: 0,
        eligible: 0,
        bPerim: 0,
        resElig: 0,
        precoce: 0,
        bprime: 0,
      };

      for (const row of rows) {
        const signal: VivierSignalInput = {
          id: row.id,
          type: row.type,
          category: row.category ?? null,
          label: row.label,
          description: row.description ?? null,
          etape: row.etapeAnnote ?? null,
          nbUnitesMax: row.nbUnitesMax ?? null,
          intensite: row.intensite ?? null,
          props: row.props,
          sourceRef: row.sourceRef,
        };
        const c = classifyVivierSignal(signal);
        const eligible = c.exclusion_reason === null;
        const zOui = c.zonage.valeur === "oui";
        const bPerim = eligible && zOui;
        const resElig = bPerim && isResidentialEligible(c);
        const precoce = bPerim && PRECOCE_STAGES.has(c.etape);
        const bprime = precoce && resElig;

        tally.total += 1;
        if (eligible) tally.eligible += 1;
        if (bPerim) tally.bPerim += 1;
        if (resElig) tally.resElig += 1;
        if (precoce) tally.precoce += 1;
        if (bprime) tally.bprime += 1;

        // bitmask compact : e|b|r|p|B
        const flags =
          (eligible ? 1 : 0) |
          (bPerim ? 2 : 0) |
          (resElig ? 4 : 0) |
          (precoce ? 8 : 0) |
          (bprime ? 16 : 0);
        lines.push(
          JSON.stringify({
            id: row.id,
            c: row.citySlug,
            e: c.etape,
            i: c.instrument,
            x: c.exclusion_reason,
            z: c.zonage.valeur,
            rv: c.residentiel.valeur,
            f: flags,
          }),
        );
      }

      writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
      console.log("RECETTE_SNAPSHOT_TALLY " + JSON.stringify(tally));
      // Le snapshot marche sur le corpus complet (7221) OU sur un LOT — le
      // contrôle dur 7221/6777 est porté par recette-replay-pg.prod.test.ts.
      expect(rows.length).toBeGreaterThan(0);
    },
    120000,
  );
});

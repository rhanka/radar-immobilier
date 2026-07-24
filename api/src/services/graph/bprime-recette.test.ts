import { describe, expect, it } from "vitest";
import {
  aggregateGraphSignalProjectionRows,
  buildLegacyZmpProjection,
  buildNodeRow,
  classifyGraphNodeLegacyZmp,
  type CitySignalCounts,
} from "./graph-store.js";
import { computeVivierV2 } from "./vivier-v2.js";
import {
  BPRIME_RECETTE_EXPECTATIONS,
  BPRIME_RECETTE_ROWS,
} from "./bprime-recette.fixture.js";
import { SUTTON_LEGACY_GRAPH_NODES, SUTTON_A_IDS } from "./sutton-legacy.fixture.js";
import type { VivierV2Counts } from "@radar/domain";

/**
 * Recette de réception B′ × Steve-30.
 * Contrat : docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md.
 *
 * Chemin testé = le VRAI chemin serveur qui pilote la vue B :
 *   aggregateGraphSignalProjectionRows(rows) → vivierV2Counts par ville,
 * puis le badge B par défaut de la vue (ui/.../vivier-view-mode.ts
 * `countForVivierCity`, axes {z,r,p}={✓,✓,✓}) =
 *   stageCounts.avis_motion + stageCounts.projet_reglement.
 */

/** Miroir EXACT de `countForVivierCity` (mode B, axes par défaut, précoce coché). */
function bBadgeCount(counts: VivierV2Counts): number {
  return counts.stageCounts.avis_motion + counts.stageCounts.projet_reglement;
}

function countsByCity(): Map<string, VivierV2Counts> {
  const aggregated: CitySignalCounts[] = aggregateGraphSignalProjectionRows(
    BPRIME_RECETTE_ROWS,
  );
  return new Map(aggregated.map((c) => [c.citySlug, c.vivierV2Counts]));
}

describe("Recette B′ × Steve-30 — appartenance & comptes par ville", () => {
  const byCity = countsByCity();

  for (const exp of BPRIME_RECETTE_EXPECTATIONS) {
    it(`${exp.label} → B′ ${exp.bPrime} (règle ${exp.rule})`, () => {
      const counts = byCity.get(exp.citySlug);
      expect(counts, `ville absente du calcul serveur: ${exp.citySlug}`).toBeDefined();
      expect(bBadgeCount(counts!)).toBe(exp.bPrime);
    });
  }

  it("synthèse : villes notées ≥6/10 toutes présentes dans B′ (3× 10/10 inclus)", () => {
    const geSix = ["saint-stanislas-de-kostka", "sutton", "saint-raphael", "saint-gilbert"];
    const present = geSix.filter((slug) => bBadgeCount(byCity.get(slug)!) >= 1);
    expect(present).toEqual(geSix);
  });

  it("faux positifs commerciaux exclus : Rosemère & Saint-Charles-Borromée à ✗0", () => {
    expect(bBadgeCount(byCity.get("rosemere")!)).toBe(0);
    expect(bBadgeCount(byCity.get("saint-charles-borromee")!)).toBe(0);
  });

  it("membership : les signaux qualifiés B′ attendus, ville par ville", () => {
    const qualifiedPrecoce = (slug: string): string[] => {
      const rows = BPRIME_RECETTE_ROWS.filter((r) => r.citySlug === slug);
      const signals = rows.map((r) => ({
        id: r.id,
        type: r.type,
        category: r.category ?? null,
        label: r.label,
        description: r.description ?? null,
        etape: r.etapeAnnote ?? null,
        nbUnitesMax: r.nbUnitesMax ?? null,
        intensite: r.intensite ?? null,
        props: r.props,
        sourceRef: r.sourceRef,
      }));
      // Miroir EXACT du prédicat de projectComposedVivierB(nodes, {z,r,p} par défaut) :
      // exclusion_reason === null ∧ zonage=oui ∧ residentiel=oui ∧ étape précoce.
      return computeVivierV2(signals)
        .classifications.filter(
          (c) =>
            c.classification.exclusion_reason === null &&
            c.classification.zonage.valeur === "oui" &&
            c.classification.residentiel.valeur === "oui" &&
            (c.classification.etape === "avis_motion" ||
              c.classification.etape === "projet_reglement"),
        )
        .map((c) => c.signalId);
    };

    expect(qualifiedPrecoce("saint-stanislas-de-kostka")).toEqual([
      "event-saint-stanislas-refonte-451-2025",
      "signal-saint-stanislas-refonte-451-2025",
    ]);
    expect(qualifiedPrecoce("sutton")).toEqual([
      "event-sutton-refonte-reglementaire-2026-05-27",
      "signal-sutton-refonte-zonage-2026",
    ]);
    expect(qualifiedPrecoce("saint-raphael")).toEqual([
      "event-saint-raphael-refonte-2026-244",
      "signal-saint-raphael-refonte-2026-244",
    ]);
    expect(qualifiedPrecoce("rosemere")).toEqual([]);
    expect(qualifiedPrecoce("saint-charles-borromee")).toEqual([]);
    expect(qualifiedPrecoce("rimouski")).toEqual(["signal-rimouski-spar-328-logements"]);
    expect(qualifiedPrecoce("saint-gilbert")).toEqual([
      "signal-saint-gilbert-u161-2026",
      "signal-saint-gilbert-second-reglement",
    ]);
  });
});

describe("Non-régression A (legacy z|m|p) — inchangé par B′", () => {
  it("Sutton : la projection A z|m|p reste exactement SUTTON_A_IDS", () => {
    const memberships = SUTTON_LEGACY_GRAPH_NODES.map((node) => {
      const nodeRow = buildNodeRow(node, "sutton");
      return classifyGraphNodeLegacyZmp({
        id: nodeRow.id,
        type: nodeRow.type,
        label: nodeRow.label,
        props: nodeRow.props,
        sourceRef: nodeRow.sourceRef,
      });
    });
    const projection = buildLegacyZmpProjection(memberships);
    expect(projection.a.signalIds).toEqual([...SUTTON_A_IDS]);
  });
});

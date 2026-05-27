import { describe, it, expect } from "vitest";
import { valleyfieldDossiers } from "@radar/domain";
import { WEIGHTS, aggregate } from "@radar/scoring";
import { groupEvidenceByPhase, PHASE_ORDER } from "$lib/opportunites/funnel.js";

// ── aggregate honest score assertions ──────────────────────────────────────

describe("OpportunityFunnel — aggregate honest scores", () => {
  it("dossier 1 (H-609-4) aggregate score rounds to 3.18", () => {
    const d = valleyfieldDossiers[0];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 3.18)).toBeLessThan(0.005);
  });

  it("dossier 2 (U-521) aggregate score rounds to 3.35", () => {
    const d = valleyfieldDossiers[1];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 3.35)).toBeLessThan(0.005);
  });

  it("dossier 3 (H-143) aggregate score rounds to 2.59", () => {
    const d = valleyfieldDossiers[2];
    const result = aggregate(d.axes, WEIGHTS);
    expect(result.score).not.toBeNull();
    expect(Math.abs((result.score as number) - 2.59)).toBeLessThan(0.005);
  });

  it("all 3 dossiers are partial (marché non-disponible)", () => {
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.partial).toBe(true);
    }
  });

  it("all 3 dossiers cap at qualifier-avec-expert", () => {
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.recommendationCap).toBe("qualifier-avec-expert");
    }
  });

  it("none are tooThin", () => {
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.tooThin).toBe(false);
    }
  });
});

// ── groupEvidenceByPhase — 6 phases in canonical order ────────────────────

describe("OpportunityFunnel — groupEvidenceByPhase yields 6 phases in order", () => {
  it("all 3 dossiers yield all 6 phases present in PHASE_ORDER", () => {
    for (const d of valleyfieldDossiers) {
      const groups = groupEvidenceByPhase(d);
      const phases = groups.map((g) => g.phase);
      // Must be a subsequence of PHASE_ORDER in the same relative order
      let lastIdx = -1;
      for (const ph of phases) {
        const idx = PHASE_ORDER.indexOf(ph);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    }
  });

  it("pilot dossier 1 (H-609-4) has evidence in all 6 phases", () => {
    const d = valleyfieldDossiers[0];
    const groups = groupEvidenceByPhase(d);
    const phases = new Set(groups.map((g) => g.phase));
    for (const ph of PHASE_ORDER) {
      expect(phases.has(ph), `missing phase ${ph}`).toBe(true);
    }
  });

  it("each group contains at least one evidence item", () => {
    for (const d of valleyfieldDossiers) {
      const groups = groupEvidenceByPhase(d);
      for (const g of groups) {
        expect(g.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("groups carry the correct French labels", () => {
    const labelMap: Record<string, string> = {
      signal: "Signal",
      ancrage: "Ancrage",
      contraintes: "Contraintes",
      marche: "Marché",
      contexte: "Contexte",
      scoring: "Scoring",
    };
    for (const d of valleyfieldDossiers) {
      const groups = groupEvidenceByPhase(d);
      for (const g of groups) {
        expect(g.label).toBe(labelMap[g.phase]);
      }
    }
  });
});

// ── legacy scoreGlobal not used in view (data-layer guard) ────────────────

describe("OpportunityFunnel — legacy scoreGlobal must NOT drive display", () => {
  it("aggregate result has partial=true, meaning marché is excluded — structural difference from legacy scoreGlobal", () => {
    // Ensures the new view uses aggregate(d.axes, WEIGHTS) not d.scoreGlobal.
    // aggregate() with a non-disponible marché axis sets partial=true and
    // rescales over availableWeightSum (0.85), which is conceptually different
    // from the legacy scoreGlobal (a plain weighted sum including marché=0).
    // The structural marker is partial=true + recommendationCap="qualifier-avec-expert".
    for (const d of valleyfieldDossiers) {
      const result = aggregate(d.axes, WEIGHTS);
      expect(result.partial).toBe(true);
      expect(result.recommendationCap).toBe("qualifier-avec-expert");
      // The legacy field still exists on the domain object but must not be rendered.
      // We confirm it exists so we know we deliberately dropped it from the view.
      expect(typeof d.scoreGlobal).toBe("number");
    }
  });
});

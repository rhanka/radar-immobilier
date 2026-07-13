import { describe, it, expect } from "vitest";
import { scoreSteve30 } from "./score.js";
import type { SteveFeatures } from "./features.js";
import { STEVE30 } from "./dataset.js";

const NULL_FEATURES: SteveFeatures = {
  residentialRelevance: null,
  changeNature: null,
  earliness: null,
  regulatoryExploitability: null,
  landExploitability: null,
  zonePrecedent: null,
  ownerType: null,
  projectScale: null,
  distanceMtl: null,
};
const f = (p: Partial<SteveFeatures>): SteveFeatures => ({ ...NULL_FEATURES, ...p });
const byId = (id: string) => STEVE30.find((r) => r.id === id)!.features;
const round2 = (x: number) => Math.round(x * 100) / 100;

describe("scoreSteve30 — determinism on known rows", () => {
  it("Saint-Raphaël (10/10): refonte + projet + grille_et_lot + lots → 9.5", () => {
    const r = scoreSteve30(byId("saint-raphael"));
    expect(round2(r.score)).toBe(9.5);
    expect(r.gatedNonResidential).toBe(false);
    expect(r.missingCoreFeatures).toEqual([]);
    // dominant factors, largest magnitude first
    expect(r.dominantFactors.slice(0, 2)).toEqual([
      "nature",
      "regulatoryExploitability",
    ]);
  });
  it("Coaticook (8/10): ppcmoi + projet + zone_seule + precedent → 6.1", () => {
    expect(round2(scoreSteve30(byId("coaticook")).score)).toBe(6.1);
  });
  it("Neuville (4/10): cptaq + ordre_du_jour − société de portefeuille → 1.0", () => {
    expect(round2(scoreSteve30(byId("neuville")).score)).toBe(1.0);
  });
  it("Rosemère (2/10): refonte + avis de motion − trop massif → 3.0", () => {
    expect(round2(scoreSteve30(byId("rosemere")).score)).toBe(3.0);
  });
  it("Saint-Côme-Linière (3/10): petition − ville − uncertainty, clamped to 0", () => {
    const r = scoreSteve30(byId("saint-come-liniere"));
    expect(r.score).toBe(0);
    expect(r.rawScore).toBeCloseTo(-1.1, 10);
    expect(r.missingCoreFeatures).toEqual(["earliness"]);
  });
});

describe("scoreSteve30 — residential gate", () => {
  it("non_residential is hard-gated to 0 with a single term", () => {
    const r = scoreSteve30(byId("stratford"));
    expect(r.score).toBe(0);
    expect(r.gatedNonResidential).toBe(true);
    expect(r.terms).toHaveLength(1);
    expect(r.terms[0]!.component).toBe("residentialGate");
    expect(r.dominantFactors).toEqual(["residentialGate"]);
  });
});

describe("scoreSteve30 — structure and invariants", () => {
  it("terms sum (pre-clamp) equals rawScore", () => {
    const r = scoreSteve30(byId("saint-boniface"));
    const sum = r.terms.reduce((s, t) => s + t.points, 0);
    expect(round2(sum)).toBe(round2(r.rawScore));
  });
  it("uncertainty penalty fires once per missing core feature", () => {
    const r = scoreSteve30(f({ residentialRelevance: "residential" }));
    expect(r.missingCoreFeatures.sort()).toEqual(["changeNature", "earliness"]);
    const unc = r.terms.find((t) => t.component === "uncertaintyPenalty")!;
    expect(unc.points).toBeCloseTo(-0.2, 10);
    expect(r.score).toBe(0); // clamped
  });
  it("clamps to [0, 10]", () => {
    for (const row of STEVE30) {
      const r = scoreSteve30(row.features);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(10);
    }
  });
  it("is pure — same input yields the same output", () => {
    const a = scoreSteve30(byId("sutton"));
    const b = scoreSteve30(byId("sutton"));
    expect(a).toEqual(b);
  });
});

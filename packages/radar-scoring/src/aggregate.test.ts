import { describe, it, expect } from "vitest";
import type { AxisScoreT } from "@radar/domain";
import { aggregate } from "./aggregate.js";
import { WEIGHTS } from "./grids.js";
const A = (level: number | null, availability = "available", confidence = "high"): AxisScoreT =>
  ({ level, availability, confidence, evidenceRefs: [], rationale: "", gridVersion: "v1" } as AxisScoreT);
const ND = A(null, "non-disponible", "low");

describe("aggregate", () => {
  it("all available → exact weighted score, not partial, full cap", () => {
    const r = aggregate({ potentiel: A(4), risque: A(3), timing: A(3), faisabilite: A(2), marche: A(3) }, WEIGHTS);
    expect(r.partial).toBe(false);
    expect(r.recommendationCap).toBe("monter-dossier-acquisition");
    expect(Math.round(r.score! * 100) / 100).toBe(3.15);
  });
  it("market non-disponible → renormalized over 0.85, partial, capped at qualifier-avec-expert", () => {
    const r = aggregate({ potentiel: A(4), risque: A(3), timing: A(3), faisabilite: A(2), marche: ND }, WEIGHTS);
    expect(r.partial).toBe(true);
    expect(r.availableWeightSum).toBeCloseTo(0.85, 5);
    expect(r.recommendationCap).toBe("qualifier-avec-expert");
    expect(Math.round(r.score! * 100) / 100).toBe(3.18);
  });
  it("all non-disponible → tooThin, score null, no NaN, cap surveiller", () => {
    const nd = { potentiel: ND, risque: ND, timing: ND, faisabilite: ND, marche: ND };
    const r = aggregate(nd, WEIGHTS);
    expect(r.tooThin).toBe(true); expect(r.score).toBeNull(); expect(r.recommendationCap).toBe("surveiller");
  });
  it("availableWeightSum below 0.50 floor → tooThin", () => {
    const r = aggregate({ potentiel: ND, risque: ND, timing: ND, faisabilite: A(4), marche: A(5) }, WEIGHTS); // 0.30
    expect(r.tooThin).toBe(true);
  });
  it("throws on level out of [0,5]", () => {
    expect(() => aggregate({ potentiel: A(6), risque: A(3), timing: A(3), faisabilite: A(2), marche: A(3) }, WEIGHTS)).toThrow();
  });
  it("throws on missing/NaN weight", () => {
    const w = { ...WEIGHTS, marche: NaN };
    expect(() => aggregate({ potentiel: A(4), risque: A(3), timing: A(3), faisabilite: A(2), marche: A(3) }, w)).toThrow();
  });
  it("throws on unknown axis", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => aggregate({ potentiel: A(4), risque: A(3), timing: A(3), faisabilite: A(2), marche: A(3), bogus: A(1) } as any, WEIGHTS)).toThrow();
  });
  it("throws on availability/level mismatch", () => {
    expect(() => aggregate({ potentiel: A(null), risque: A(3), timing: A(3), faisabilite: A(2), marche: A(3) }, WEIGHTS)).toThrow();
  });
});

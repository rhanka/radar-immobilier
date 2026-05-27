import { describe, it, expect } from "vitest";
import { GRIDS, WEIGHTS } from "./grids.js";
describe("v1 grids", () => {
  it("has 5 axes with weights summing to 1", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Object.keys(GRIDS).sort()).toEqual(["faisabilite","marche","potentiel","risque","timing"]);
    expect(Math.round(sum * 100) / 100).toBe(1);
  });
  it("each axis defines all 6 levels 0..5", () => {
    for (const g of Object.values(GRIDS))
      expect(Object.keys(g.levels).map(Number).sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5]);
  });
  it("matches the PROCESS weights 30/20/20/15/15", () => {
    expect(WEIGHTS.potentiel).toBeCloseTo(0.30); expect(WEIGHTS.risque).toBeCloseTo(0.20);
    expect(WEIGHTS.timing).toBeCloseTo(0.20); expect(WEIGHTS.faisabilite).toBeCloseTo(0.15);
    expect(WEIGHTS.marche).toBeCloseTo(0.15);
  });
});

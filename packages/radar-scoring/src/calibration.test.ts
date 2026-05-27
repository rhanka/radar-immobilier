import { describe, it, expect } from "vitest";
import type { AxisT, AxisScoreT } from "@radar/domain";
import { valleyfieldDossiers } from "@radar/domain";
import { aggregate } from "./aggregate.js";
import { WEIGHTS } from "./grids.js";

const expected: Record<string, number> = {
  "valleyfield-h609-4-regl150-49": 3.18,
  "valleyfield-u521-h521-regl150-51": 3.35,
  "valleyfield-h143-h143-1-regl150-49-1": 2.59,
};

describe("calibration on the 3 real pilots (spec §5)", () => {
  it("each pilot: partial, capped at qualifier-avec-expert, market non-disponible, exact score", () => {
    expect(valleyfieldDossiers).toHaveLength(3);
    for (const d of valleyfieldDossiers) {
      // z.record infers Partial<Record<...>> but all 5 axes are always populated in the dossiers;
      // cast to the full Record<> that aggregate expects.
      const axes = d.axes as Record<AxisT, AxisScoreT>;
      const r = aggregate(axes, WEIGHTS);
      expect(r.partial).toBe(true);
      expect(r.recommendationCap).toBe("qualifier-avec-expert");
      expect(axes.marche.availability).toBe("non-disponible");
      expect(r.tooThin).toBe(false);
      expect(Math.round((r.score as number) * 100) / 100).toBe(expected[d.id]);
    }
  });
});

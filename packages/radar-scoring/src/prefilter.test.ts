import { describe, it, expect } from "vitest";
import { applyPreFilters, DEFAULT_PREFILTERS, type PreFilterLot } from "./prefilter.js";

const lot = (noLot: string, areaM2: number, confirmed = true): PreFilterLot => ({ noLot, areaM2, confirmed });

describe("pre-filters", () => {
  it("drops a sub-350 m² isolated lot", () => {
    const out = applyPreFilters([lot("a", 200)], DEFAULT_PREFILTERS, []);
    expect(out.kept.map((l) => l.noLot)).toEqual([]);
    expect(out.dropped.map((l) => l.noLot)).toEqual(["a"]);
  });

  it("keeps a >=350 m² lot", () => {
    const out = applyPreFilters([lot("big", 400)], DEFAULT_PREFILTERS, []);
    expect(out.kept.map((l) => l.noLot)).toEqual(["big"]);
  });

  it("keeps sub-threshold lots that are contiguous, as an assembly cluster", () => {
    const out = applyPreFilters([lot("a", 200), lot("b", 200)], DEFAULT_PREFILTERS, [["a", "b"]]);
    expect(out.kept.map((l) => l.noLot).sort()).toEqual(["a", "b"]);
    expect(out.kept.every((l) => !!l.assemblyClusterId)).toBe(true);
    // both lots in the same group share one clusterId
    expect(new Set(out.kept.map((l) => l.assemblyClusterId)).size).toBe(1);
  });
});

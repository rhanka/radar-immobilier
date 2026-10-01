import { describe, expect, it } from "vitest";
import { buildGeoQuery, parseGeoQuery } from "./geo-route.js";
import { readGeoFilters, writeGeoFilters, subsetFromGeoFilters } from "./geo-filter-state.js";
import { keyForVivierB } from "$lib/signals/vivier-view-mode.js";

describe("shareable geographic restrictions", () => {
  it("should restore every business filter and fixed period across browsers", () => {
    const filters = {
      zonage: ["1"], residentiel: ["1"], precoce: ["1"],
      excludePiia: ["1"], excludeDerogations: ["1"],
      dateFrom: ["2026-01-31"], dateTo: ["2026-07-31"], period: ["6mo"],
      lotCategory: ["quatrePlus"], lotUsage: ["residentiel", "multi"], lotMinArea: ["1200"],
      zoneKind: ["H", "MIXTE"], zoneMillesime: ["2008"],
    };
    const url = buildGeoQuery({ filters });
    const sender = readGeoFilters(parseGeoQuery(url).filters);
    localStorage.setItem("signaux-filter-subset", "vivier-v2|-z|-r|-p");
    const recipient = readGeoFilters(parseGeoQuery(url).filters);
    expect(recipient).toEqual(sender);
    expect(recipient.axes).toEqual({ z: true, r: true, p: true });
    expect(recipient.lots).toEqual({ category: "quatrePlus", usages: new Set(["multi", "residentiel"]), superficieMin: 1200 });
    expect(recipient.zoneKinds).toEqual(new Set(["H", "MIXTE"]));
    expect(recipient.zoneMillesime).toBe("2008");
    expect(buildGeoQuery({ filters: writeGeoFilters(recipient) })).toBe(url);
  });

  it("should clear every omitted restriction for a dates-only request", () => {
    localStorage.setItem("signaux-filter-subset", "vivier-v2|p");
    const state = readGeoFilters(parseGeoQuery("?filter.dateFrom=2026-06-01&filter.dateTo=2026-06-30").filters);
    expect(state.axes).toEqual({ z: false, r: false, p: false });
    expect(state.exclusions).toEqual({ piiaSansProjetResidentiel: false, derogationsMineures: false });
    expect(state.lots).toEqual({ category: "all", usages: new Set(), superficieMin: 0 });
    expect(state.zoneKinds.size).toBe(0);
    expect(state.zoneMillesime).toBeNull();
    expect(state.timeRange.mode).toBe("absolute");
    expect(writeGeoFilters(state)).toEqual({ dateFrom: ["2026-06-01"], dateTo: ["2026-06-30"] });
  });

  it("should retain disabled axes in old residual-vivier links", () => {
    const state = readGeoFilters({ subset: ["vivier-v2|-z|-p"] });
    expect(state.axes).toEqual({ z: false, r: true, p: false });
    expect(subsetFromGeoFilters(writeGeoFilters(state))).toBe(keyForVivierB(state.axes));
    expect(writeGeoFilters(state)).toEqual({ residentiel: ["1"] });
  });

  it("should normalize retired vivier links to the sole residual vivier", () => {
    expect(readGeoFilters({ subset: ["z", "m", "p"] }).axes).toEqual({ z: true, r: true, p: true });
    expect(writeGeoFilters(readGeoFilters({ subset: ["vivier-v2"] }))).not.toHaveProperty("subset");
  });

  it("should reject invalid dates and restrictive values without inventing data", () => {
    const state = readGeoFilters({ dateFrom: ["2026-02-31"], dateTo: ["2026-01-01"], lotMinArea: ["Infinity"], lotCategory: ["invented"], zoneKind: ["invented"], lotUsage: ["invented"] });
    expect(writeGeoFilters(state)).toEqual({});
    expect(state.timeRange.relative).toBe("all");
  });
});

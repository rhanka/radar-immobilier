import { describe, expect, it } from "vitest";
import { buildGeoQuery, parseGeoQuery } from "./geo-route.js";
import { readGeoFilters, writeGeoFilters, subsetFromGeoFilters, sameTimeRange } from "./geo-filter-state.js";
import { keyForVivierB } from "$lib/signals/vivier-view-mode.js";

describe("shareable geographic restrictions", () => {
  it("should restore every business filter and fixed period across browsers", () => {
    const filters = {
      zonage: ["1"], residentiel: ["1"], precoce: ["1"],
      excludePiia: ["1"], excludeDerogations: ["1"],
      dateFrom: ["2026-01-31"], dateTo: ["2026-07-31"],
      lotCategory: ["quatrePlus"], lotUsage: ["residentiel", "multi"], lotMinArea: ["1200"],
      zoneKind: ["H", "MIXTE"], zoneMillesime: ["2008"],
      cptaq: ["1"], citySearch: ["Val-des"], zoneSearch: ["H-01"], lotSearch: ["1000001"],
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
    expect(state.lotsEnabled).toBe(true);
    expect(state.cptaqEnabled).toBe(false);
    expect([state.citySearch, state.zoneSearch, state.lotSearch]).toEqual(["", "", ""]);
    expect(state.timeRange.mode).toBe("absolute");
    expect(writeGeoFilters(state)).toEqual({ dateFrom: ["2026-06-01"], dateTo: ["2026-06-30"] });
  });

  it("should keep the defaults for an old zones-only link and add its layer restriction", () => {
    for (const query of ["?lots=off", "?lots=0", "?layers=zones"]) {
      const state = readGeoFilters(parseGeoQuery(query).filters);
      expect(state.lotsEnabled).toBe(false);
      expect(writeGeoFilters(state)).toEqual({
        zonage: ["1"], residentiel: ["1"], precoce: ["1"], excludePiia: ["1"], excludeDerogations: ["1"],
        period: ["6mo"], lots: ["0"],
      });
    }
  });

  it("should treat a zones-only restriction with filter parameters as a snapshot", () => {
    for (const query of ["?filter.lots=0", "?lots=0&filter.zonage=1"]) {
      const state = readGeoFilters(parseGeoQuery(query).filters);
      expect(state.lotsEnabled).toBe(false);
      expect(state.exclusions.piiaSansProjetResidentiel).toBe(false);
      expect(state.timeRange.relative).toBe("all");
    }
  });

  it("should default to document dates and share an explicit acquisition basis", () => {
    expect(readGeoFilters({}).dateBasis).toBe("document");
    expect(readGeoFilters({ dateBasis: ["invalid"] }).dateBasis).toBe("document");
    const state = readGeoFilters({ dateBasis: ["acquisition"], dateFrom: ["2026-09-29"], dateTo: ["2026-09-30"] });
    expect(state.dateBasis).toBe("scrap");
    expect(state.axes).toEqual({ z: false, r: false, p: false });
    expect(writeGeoFilters(state))
      .toEqual({ dateBasis: ["acquisition"], dateFrom: ["2026-09-29"], dateTo: ["2026-09-30"] });
    const shared = readGeoFilters(parseGeoQuery(buildGeoQuery({ filters: writeGeoFilters(state) })).filters);
    expect(shared).toEqual(state);
    state.dateBasis = "document";
    expect(writeGeoFilters(state)).not.toHaveProperty("dateBasis");
  });

  it("should keep reading links shared with the legacy scrap spelling and rewrite them", () => {
    const legacy = readGeoFilters({ dateBasis: ["scrap"], dateFrom: ["2026-09-29"], dateTo: ["2026-09-30"] });
    expect(legacy.dateBasis).toBe("scrap");
    expect(writeGeoFilters(legacy))
      .toEqual({ dateBasis: ["acquisition"], dateFrom: ["2026-09-29"], dateTo: ["2026-09-30"] });
    // A legacy relative-period link falls back to document dates.
    expect(readGeoFilters({ subset: ["vivier-v2"], dateBasis: ["scrap"] }).dateBasis).toBe("document");
  });

  it("should ignore the acquisition basis for relative and unrestricted periods", () => {
    for (const period of ["3mo", "6mo", "12mo"]) {
      const state = readGeoFilters({ dateBasis: ["acquisition"], period: [period] });
      expect(state.dateBasis).toBe("document");
      expect(writeGeoFilters(state)).toEqual({ period: [period] });
    }
    const unrestricted = readGeoFilters({ dateBasis: ["acquisition"], period: ["all"] });
    expect(unrestricted.dateBasis).toBe("document");
    expect(writeGeoFilters(unrestricted)).toEqual({ period: ["all"] });
    // Even a stale acquisition state is never written for a relative period.
    expect(writeGeoFilters({ ...unrestricted, dateBasis: "scrap" })).toEqual({ period: ["all"] });
    expect(readGeoFilters({ dateBasis: ["acquisition"] }).dateBasis).toBe("document");
  });

  it("should retain disabled axes in old residual-vivier links", () => {
    const state = readGeoFilters({ subset: ["vivier-v2|-z|-p"] });
    expect(state.axes).toEqual({ z: false, r: true, p: false });
    expect(subsetFromGeoFilters(writeGeoFilters(state))).toBe(keyForVivierB(state.axes));
    expect(writeGeoFilters(state)).toEqual({
      residentiel: ["1"], excludePiia: ["1"], excludeDerogations: ["1"], period: ["6mo"],
    });
  });

  it("should normalize retired vivier links to the sole residual vivier", () => {
    expect(readGeoFilters({ subset: ["z", "m", "p"] }).axes).toEqual({ z: true, r: true, p: true });
    expect(writeGeoFilters(readGeoFilters({ subset: ["vivier-v2"] }))).not.toHaveProperty("subset");
  });

  it("should reject invalid dates and restrictive values without inventing data", () => {
    const state = readGeoFilters({ dateFrom: ["2026-02-31"], dateTo: ["2026-01-01"], lotMinArea: ["Infinity"], lotCategory: ["invented"], zoneKind: ["invented"], lotUsage: ["invented"] });
    expect(writeGeoFilters(state)).toEqual({ period: ["all"] });
    expect(state.timeRange.relative).toBe("all");
  });

  it("should open a link without filters on the product defaults", () => {
    localStorage.setItem("signaux-filter-subset", "vivier-v2|-z|-r|-p");
    const state = readGeoFilters(parseGeoQuery("?mode=signal").filters);
    expect(state.axes).toEqual({ z: true, r: true, p: true });
    expect(state.exclusions).toEqual({ piiaSansProjetResidentiel: true, derogationsMineures: true });
    expect(state.timeRange).toMatchObject({ mode: "relative", relative: "6mo" });
    expect(writeGeoFilters(state)).toEqual({
      zonage: ["1"], residentiel: ["1"], precoce: ["1"], excludePiia: ["1"], excludeDerogations: ["1"], period: ["6mo"],
    });
  });

  it("should share an all-unchecked, unbounded view distinctly from the defaults", () => {
    const url = buildGeoQuery({ filters: writeGeoFilters(readGeoFilters({ period: ["all"] })) });
    expect(url).toBe("?mode=signal&filter.period=all");
    const state = readGeoFilters(parseGeoQuery(url).filters);
    expect(state.axes).toEqual({ z: false, r: false, p: false });
    expect(state.exclusions).toEqual({ piiaSansProjetResidentiel: false, derogationsMineures: false });
    expect(state.timeRange.relative).toBe("all");
  });

  it("should resolve a shared relative period when opened, without stale bounds", () => {
    const opened = Date.UTC(2026, 9, 1, 12);
    const state = readGeoFilters({ period: ["3mo"], dateFrom: ["2020-01-01"], dateTo: ["2020-02-01"] }, opened);
    expect(state.timeRange).toMatchObject({ mode: "relative", relative: "3mo", to: opened });
    expect(new Date(state.timeRange.from).getFullYear()).toBe(2026);
    expect(writeGeoFilters(state)).toEqual({ period: ["3mo"] });
    expect(sameTimeRange(state.timeRange, readGeoFilters({ period: ["3mo"] }).timeRange)).toBe(true);
    expect(sameTimeRange(state.timeRange, readGeoFilters({ period: ["6mo"] }).timeRange)).toBe(false);
  });
});

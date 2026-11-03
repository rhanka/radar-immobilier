import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultGeoFilters, readGeoFilters, writeGeoFilters, unrestrictedGeoFilters } from "./geo-filter-state.js";
import {
  FILTER_TO_CONTRACT,
  GEO_FILTER_STATE_KEYS,
  geoFiltersToSignalFilter,
} from "./signal-query-v1-mapping.js";

describe("filter.* mapping exhaustiveness", () => {
  it("should cover every key read or written by the geo filter state", () => {
    const full = {
      zonage: ["1"], residentiel: ["1"], precoce: ["1"],
      excludePiia: ["1"], excludeDerogations: ["1"],
      period: ["7d"],
      dateFrom: ["2026-01-01"], dateTo: ["2026-01-31"], dateBasis: ["acquisition"],
      lotCategory: ["quatrePlus"], lotUsage: ["residentiel"], lotMinArea: ["1200"],
      zoneKind: ["H"], zoneMillesime: ["2008"],
      showDiscarded: ["1"], lots: ["0"], cptaq: ["1"],
      citySearch: ["Val"], zoneSearch: ["H-"], lotSearch: ["123"],
      subset: ["vivier-v2"], legacyLayers: ["zones"],
    };
    const state = readGeoFilters(full);
    const written = writeGeoFilters({ ...state, showDiscarded: true });
    const touched = new Set([...Object.keys(full), ...Object.keys(written)]);
    for (const key of touched) {
      expect(
        FILTER_TO_CONTRACT[key],
        `missing mapping for filter.${key}`,
      ).toBeDefined();
    }
    for (const key of GEO_FILTER_STATE_KEYS) {
      expect(FILTER_TO_CONTRACT[key], `missing mapping for ${key}`).toBeDefined();
    }
    // No silent gaps: every table entry names a contract field or a reason.
    for (const [key, target] of Object.entries(FILTER_TO_CONTRACT)) {
      if (target.kind === "contract" || target.kind === "client-resolved") {
        expect(target.field.length).toBeGreaterThan(0);
      } else {
        expect(target.reason.length, key).toBeGreaterThan(0);
      }
    }
    expect(unrestrictedGeoFilters()).toBeDefined();
  });

  it("should keep the frozen spec table in sync with the code table", () => {
    const spec = readFileSync("../docs/spec/SPEC_SIGNAL_QUERY_V1.md", "utf8");
    for (const key of GEO_FILTER_STATE_KEYS) {
      expect(spec, `spec missing filter.${key}`).toContain(`filter.${key}`);
    }
  });
});

describe("geoFiltersToSignalFilter translator", () => {
  const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

  it("should translate the product-default snapshot to the opening contract", () => {
    const filter = geoFiltersToSignalFilter(defaultGeoFilters(NOW), NOW);
    expect(filter.requireZonage).toBe(true);
    expect(filter.requireResidentielEligible).toBe(true);
    expect(filter.requirePrecoce).toBe(true);
    expect(filter.excludeAutomaticallyExcluded).toBe(true);
    expect(filter.excludePiia).toBe(true);
    expect(filter.excludeDerogations).toBe(true);
    expect(filter.dateBasis).toBe("document");
    expect(filter.dateFrom).toBe("2026-10-02");
    expect(filter.dateTo).toBe("2026-10-09");
    expect(filter.archive).toBe("exclude");
    expect(filter.basket).toBe("all");
    expect(filter.personalHistory).toBe("any");
    expect(filter.sort).toBe("vivier_rank");
    expect(filter.citySlug).toBeUndefined();
    expect(filter.zoneCode).toBeUndefined();
    expect(filter.q).toBeUndefined();
  });

  it("should leave an unrestricted snapshot unrestricted with no dates", () => {
    const filter = geoFiltersToSignalFilter(unrestrictedGeoFilters(), NOW);
    expect(filter.requireZonage).toBe(false);
    expect(filter.dateFrom).toBeUndefined();
    expect(filter.dateTo).toBeUndefined();
    expect(filter.dateBasis).toBe("document");
  });

  it("should select the scrap clock for acquisition only on an absolute period", () => {
    const absolute = {
      ...defaultGeoFilters(NOW),
      timeRange: { mode: "absolute" as const, from: Date.UTC(2026, 0, 15), to: Date.UTC(2026, 1, 15) },
      dateBasis: "scrap" as const,
    };
    const scrap = geoFiltersToSignalFilter(absolute, NOW);
    expect(scrap.dateBasis).toBe("scrap");
    expect(scrap.dateFrom).toBe("2026-01-15");
    expect(scrap.dateTo).toBe("2026-02-15");
    const relative = { ...defaultGeoFilters(NOW), dateBasis: "scrap" as const };
    expect(geoFiltersToSignalFilter(relative, NOW).dateBasis).toBe("document");
  });

  it("should open the archive only when the snapshot reveals discarded signals", () => {
    const shown = geoFiltersToSignalFilter(
      { ...unrestrictedGeoFilters(), showDiscarded: true }, NOW,
    );
    expect(shown.archive).toBe("include");
    const hidden = geoFiltersToSignalFilter(unrestrictedGeoFilters(), NOW);
    expect(hidden.archive).toBe("exclude");
  });

  it("should round-trip through the URL grammar without inventing spellings", () => {
    const state = {
      ...defaultGeoFilters(NOW),
      timeRange: { mode: "absolute" as const, from: Date.UTC(2026, 0, 15), to: Date.UTC(2026, 1, 15) },
      dateBasis: "scrap" as const,
      showDiscarded: true,
    };
    const written = writeGeoFilters(state);
    const reread = readGeoFilters(
      Object.fromEntries(Object.entries(written).map(([key, value]) => [key, [value].flat()])) as Record<string, readonly string[]>,
      NOW,
    );
    const filter = geoFiltersToSignalFilter(reread, NOW);
    expect(filter.dateBasis).toBe("scrap");
    expect(filter.dateFrom).toBe("2026-01-15");
    expect(filter.dateTo).toBe("2026-02-15");
    expect(filter.archive).toBe("include");
  });
});

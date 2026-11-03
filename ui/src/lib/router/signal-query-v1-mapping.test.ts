import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readGeoFilters, writeGeoFilters, unrestrictedGeoFilters } from "./geo-filter-state.js";
import {
  FILTER_TO_CONTRACT,
  GEO_FILTER_STATE_KEYS,
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

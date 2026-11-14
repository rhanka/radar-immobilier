import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIGNAL_METADATA_CLASSES, signalMetadataCounts, signalMetadataFilterSchema,
  type VivierFiltreCubesByClassement } from "@radar/domain";
import { aggregateGraphSignalProjectionRows, type GraphSignalProjectionRow } from "../graph/graph-store.js";
import { BPRIME_RECETTE_ROWS } from "../graph/bprime-recette.fixture.js";
import { discardedSignalKey } from "../graph/discarded-signals.js";

const golden = JSON.parse(readFileSync(new URL("../../../tests/fixtures/graphify/legacy-filter-a/rows.json", import.meta.url), "utf8")) as GraphSignalProjectionRow[];
const rows = [...BPRIME_RECETTE_ROWS, ...golden];

describe("metadata-v2 canonical filter", () => {
  it("should keep an explicit empty class set and reject invalid or reversed dates", () => {
    expect(signalMetadataFilterSchema.parse({ classes: "none" }).classes).toEqual([]);
    expect(signalMetadataFilterSchema.safeParse({ classes: "" }).success).toBe(false);
    expect(signalMetadataFilterSchema.safeParse({ dateFrom: "2026-02-30" }).success).toBe(false);
    expect(signalMetadataFilterSchema.safeParse({ dateFrom: "2026-11-13", dateTo: "2026-01-01" }).success).toBe(false);
    expect(signalMetadataFilterSchema.safeParse({ scope: "unknown" }).success).toBe(false);
  });

  it("should match the reference for 8 axes × 4 exclusions × 16 class selections", () => {
    const classes = new Map(rows.map((row, i) => [discardedSignalKey(row.citySlug!, row.type, row.id),
      SIGNAL_METADATA_CLASSES[i % 4]!]));
    const cities = aggregateGraphSignalProjectionRows(rows, undefined, classes);
    for (let axes = 0; axes < 8; axes++) for (let ex = 0; ex < 4; ex++) for (let selection = 0; selection < 16; selection++) {
      const filter = signalMetadataFilterSchema.parse({
        classes: SIGNAL_METADATA_CLASSES.filter((_, i) => selection & (1 << i)).join(",") || "none",
        requireZonage: String(axes & 1 ? 1 : 0), requireResidentielEligible: String(axes & 2 ? 1 : 0),
        requirePrecoce: String(axes & 4 ? 1 : 0), excludePiia: String(ex & 1 ? 1 : 0), excludeDerogations: String(ex & 2 ? 1 : 0),
      });
      for (const city of cities) {
        const cubes = city.filtreCubesByClassement as VivierFiltreCubesByClassement;
        const actual = signalMetadataCounts(cubes, filter);
        const expected = { matched: 0, classCounts: { pertinent: 0, a_surveiller: 0, non_classe: 0, ecarte: 0 },
          facetCounts: { z: 0, r: 0, p: 0, piia: 0, derog: 0 } };
        for (const classe of SIGNAL_METADATA_CLASSES) for (const [key, count] of Object.entries(cubes[classe])) {
          const flags = [key[0] === "1", key[1] === "1", key[2] === "1", key[3] === "0", key[4] === "0"];
          const enabled = [!!(axes & 1), !!(axes & 2), !!(axes & 4), !!(ex & 1), !!(ex & 2)];
          const passes = (skip = -1) => enabled.every((on, i) => i === skip || !on || flags[i]);
          if (passes()) expected.classCounts[classe] += count;
          if (!filter.classes.includes(classe)) continue;
          if (passes()) expected.matched += count;
          for (const [i, facet] of (["z", "r", "p", "piia", "derog"] as const).entries()) {
            if (passes(i) && (i < 3 ? flags[i] : !flags[i])) expected.facetCounts[facet] += count;
          }
        }
        expect(actual).toEqual(expected);
      }
    }
  });
});

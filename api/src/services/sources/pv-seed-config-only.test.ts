/**
 * Config-only cities: a PvCityEntry without `pvText` is a city the production
 * worker fetches live (→ S3), NOT an offline demo fixture. pv-seed must keep
 * seeding the "golden" entries and silently skip config-only ones, so
 * immo_subagents can add config-only cities without breaking the seed.
 * Spec docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §3.
 */
import { describe, expect, it } from "vitest";

import type { PvCityEntry } from "@radar/sources";
import { toPvFixtures } from "./pv-seed.js";

const golden: PvCityEntry = {
  config: {
    citySlug: "beloeil",
    pvIndexUrl: "https://beloeil.ca/pv",
    sourceId: "proces-verbaux-beloeil",
  },
  pvText: "Règlement 2026-12 modifiant le règlement de zonage de la Ville",
  sourceUrl: "https://beloeil.ca/pv.pdf",
};

const configOnly: PvCityEntry = {
  config: {
    citySlug: "carignan",
    pvIndexUrl: "https://carignan.ca/pv",
    sourceId: "proces-verbaux-carignan",
  },
};

describe("toPvFixtures — config-only cities are skipped", () => {
  it("keeps golden entries and drops config-only ones", () => {
    const fixtures = toPvFixtures([golden, configOnly]);
    expect(fixtures.map((f) => f.citySlug)).toEqual(["beloeil"]);
    expect(fixtures[0]!.pvText).toContain("zonage");
  });

  it("never yields a fixture with empty pvText / sourceUrl", () => {
    for (const f of toPvFixtures([golden, configOnly])) {
      expect(f.pvText.length).toBeGreaterThan(0);
      expect(f.sourceUrl.length).toBeGreaterThan(0);
    }
  });
});

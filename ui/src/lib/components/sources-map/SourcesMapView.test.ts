/**
 * Tests for SourcesMapView data pipeline and coverage helpers.
 *
 * Covers:
 *   1. Coverage summary calculation (N scanned, M with zonage) from mock by-city
 *   2. Correct rendering categories: withZonage + withoutZonage split
 *   3. Empty state when both APIs return nothing
 *   4. buildCoverageEntries + computeCoverageStats helpers directly
 */
import { describe, expect, it } from "vitest";
import {
  groupByCity,
  cityMaturityColor,
  maturityLabel,
} from "$lib/sources/maturity.js";
import { resolveScrapeStatusUrl } from "$lib/sources/scrape-status-client.js";
import {
  buildCoverageEntries,
  computeCoverageStats,
  type CoverageCityEntry,
} from "$lib/sources/coverage.js";
import type { ScrapeStatusT } from "@radar/domain";
import type { SignalCityItem } from "$lib/signals/signals-by-city-client.js";

// ── 1. Coverage summary derived from mock by-city data ────────────────────────

describe("computeCoverageStats", () => {
  it("returns 0/0 for empty entries", () => {
    const stats = computeCoverageStats([]);
    expect(stats.totalScanned).toBe(0);
    expect(stats.totalWithZonage).toBe(0);
  });

  it("counts scanned cities and those with zonage correctly", () => {
    const entries: CoverageCityEntry[] = [
      { citySlug: "valleyfield", hasZonage: true, designationEventCount: 3, generatedAt: "2026-06-08T00:00:00Z", maturitySummary: undefined },
      { citySlug: "beauharnois", hasZonage: true, designationEventCount: 1, generatedAt: null, maturitySummary: undefined },
      { citySlug: "la-prairie", hasZonage: false, designationEventCount: 0, generatedAt: null, maturitySummary: undefined },
      { citySlug: "delson", hasZonage: false, designationEventCount: 0, generatedAt: null, maturitySummary: undefined },
    ];
    const stats = computeCoverageStats(entries);
    expect(stats.totalScanned).toBe(4);
    expect(stats.totalWithZonage).toBe(2);
  });

  it("handles all-zero case (all scanned, none with zonage)", () => {
    const entries: CoverageCityEntry[] = [
      { citySlug: "la-prairie", hasZonage: false, designationEventCount: 0, generatedAt: null, maturitySummary: undefined },
      { citySlug: "sainte-catherine", hasZonage: false, designationEventCount: 0, generatedAt: null, maturitySummary: undefined },
    ];
    const stats = computeCoverageStats(entries);
    expect(stats.totalScanned).toBe(2);
    expect(stats.totalWithZonage).toBe(0);
  });
});

// ── 2. buildCoverageEntries merges both sources ──────────────────────────────

describe("buildCoverageEntries", () => {
  const scrapeItems: ScrapeStatusT[] = [
    { citySlug: "valleyfield", source: "zonage", automation: "one_shot", status: "graphified", windowMonths: 6 },
    { citySlug: "valleyfield", source: "avis-publics", automation: "refresh", status: "scraped", windowMonths: 6 },
    { citySlug: "la-prairie", source: "zonage", automation: "one_shot", status: "identified", windowMonths: 6 },
  ];

  const signalItems: SignalCityItem[] = [
    { citySlug: "valleyfield", designationEventCount: 3, generatedAt: "2026-06-08T00:00:00Z" },
    { citySlug: "beauharnois", designationEventCount: 2, generatedAt: "2026-06-07T00:00:00Z" },
    { citySlug: "la-prairie", designationEventCount: 0, generatedAt: null },
  ];

  it("produces union of cities sorted by slug", () => {
    const maturity = groupByCity(scrapeItems);
    const entries = buildCoverageEntries(maturity, signalItems);
    const slugs = entries.map((e) => e.citySlug);
    // Union: beauharnois (signals only), la-prairie (both), valleyfield (both)
    expect(slugs).toEqual(["beauharnois", "la-prairie", "valleyfield"]);
  });

  it("marks cities with designationEventCount > 0 as hasZonage=true", () => {
    const maturity = groupByCity(scrapeItems);
    const entries = buildCoverageEntries(maturity, signalItems);
    const vf = entries.find((e) => e.citySlug === "valleyfield");
    const bh = entries.find((e) => e.citySlug === "beauharnois");
    const lp = entries.find((e) => e.citySlug === "la-prairie");

    expect(vf?.hasZonage).toBe(true);
    expect(vf?.designationEventCount).toBe(3);

    expect(bh?.hasZonage).toBe(true);
    expect(bh?.designationEventCount).toBe(2);

    expect(lp?.hasZonage).toBe(false);
    expect(lp?.designationEventCount).toBe(0);
  });

  it("attaches maturitySummary when scrape-status data exists", () => {
    const maturity = groupByCity(scrapeItems);
    const entries = buildCoverageEntries(maturity, signalItems);
    const vf = entries.find((e) => e.citySlug === "valleyfield");
    const bh = entries.find((e) => e.citySlug === "beauharnois");

    // valleyfield has scrape-status records → maturitySummary defined
    expect(vf?.maturitySummary).toBeDefined();
    expect(vf?.maturitySummary?.citySlug).toBe("valleyfield");

    // beauharnois only in signals → no maturitySummary
    expect(bh?.maturitySummary).toBeUndefined();
  });

  it("handles city with scrape-status but no signal entry (defaults to 0)", () => {
    const scrapeOnly: ScrapeStatusT[] = [
      { citySlug: "saint-remi", source: "zonage", automation: "one_shot", status: "identified", windowMonths: 6 },
    ];
    const noSignals: SignalCityItem[] = [];
    const maturity = groupByCity(scrapeOnly);
    const entries = buildCoverageEntries(maturity, noSignals);
    expect(entries).toHaveLength(1);
    expect(entries[0].citySlug).toBe("saint-remi");
    expect(entries[0].hasZonage).toBe(false);
    expect(entries[0].designationEventCount).toBe(0);
  });

  it("handles empty scrape-status (only signals feed available)", () => {
    const entries = buildCoverageEntries([], [
      { citySlug: "chateauguay", designationEventCount: 5, generatedAt: "2026-06-01T00:00:00Z" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].citySlug).toBe("chateauguay");
    expect(entries[0].hasZonage).toBe(true);
    expect(entries[0].maturitySummary).toBeUndefined();
  });

  it("returns empty list when both inputs are empty", () => {
    expect(buildCoverageEntries([], [])).toHaveLength(0);
  });
});

// ── 3. Maturity helpers (existing pipeline used by the view) ─────────────────

describe("Maturity helpers used by SourcesMapView", () => {
  const items: ScrapeStatusT[] = [
    { citySlug: "valleyfield", source: "zonage", automation: "one_shot", status: "graphified", windowMonths: 6 },
    { citySlug: "valleyfield", source: "avis-publics", automation: "refresh", status: "scraped", windowMonths: 6 },
    { citySlug: "beauharnois", source: "zonage", automation: "one_shot", status: "identified", windowMonths: 6 },
  ];

  it("groups and computes maturity for display", () => {
    const summaries = groupByCity(items);
    expect(summaries).toHaveLength(2);

    const vf = summaries.find((s) => s.citySlug === "valleyfield");
    expect(vf).toBeDefined();
    expect(vf!.maturity).toBe(75); // (1.0 + 0.5) / 2 = 0.75
    expect(vf!.color).toBe("teal");

    const bh = summaries.find((s) => s.citySlug === "beauharnois");
    expect(bh).toBeDefined();
    expect(bh!.maturity).toBe(25); // identified = 0.25
    expect(bh!.color).toBe("amber");
  });

  it("maturityLabel maps tiers used in the sidebar", () => {
    expect(maturityLabel(0)).toBe("Aucune donnée");
    expect(maturityLabel(75)).toBe("Avancé");
    expect(maturityLabel(25)).toBe("Partiel");
  });

  it("cityMaturityColor produces the expected color tokens", () => {
    expect(cityMaturityColor(0)).toBe("slate");
    expect(cityMaturityColor(75)).toBe("teal");
    expect(cityMaturityColor(100)).toBe("green");
  });

  it("resolveScrapeStatusUrl resolves correctly", () => {
    expect(resolveScrapeStatusUrl("/api/scrape-status", "")).toBe(
      "/api/scrape-status",
    );
  });
});

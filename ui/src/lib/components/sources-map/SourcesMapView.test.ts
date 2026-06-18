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
  computeDataQualityReadiness,
  computeEvidenceReadiness,
  dataQualityStatusLabel,
} from "$lib/sources/data-quality-client.js";
import {
  buildCoverageEntries,
  computeCoverageStats,
  type CoverageCityEntry,
} from "$lib/sources/coverage.js";
import type { DataQualityCitySummaryT, ScrapeStatusT } from "@radar/domain";
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

// ── 4. Data readiness helpers used by Données mode ───────────────────────────

describe("SourcesMapView data readiness helpers", () => {
  function makeSummary(
    overrides: Partial<DataQualityCitySummaryT> = {},
  ): DataQualityCitySummaryT {
    const collection = {
      status: "unknown" as const,
      freshness: "unknown" as const,
      lastObservedAt: null,
      counts: {
        records: 0,
        todo: 0,
        identified: 0,
        scraped: 0,
        graphified: 0,
        error: 0,
      },
    };
    const ontology = {
      status: "unknown" as const,
      freshness: "unknown" as const,
      lastObservedAt: null,
      counts: {
        nodes: 0,
        edges: 0,
        signals: 0,
        designationEvents: 0,
        zones: 0,
        lots: 0,
        bylaws: 0,
      },
    };
    const geo = {
      status: "unknown" as const,
      freshness: "unknown" as const,
      lastObservedAt: null,
      source: null,
      counts: {
        inventoryLayers: 0,
        currentVersions: 0,
        withGeometry: 0,
      },
    };

    return {
      citySlug: "salaberry-de-valleyfield",
      generatedAt: "2026-06-18T12:00:00.000Z",
      councilMinutes: collection,
      youtube: collection,
      ontology,
      zones: geo,
      lots: geo,
      ...overrides,
    };
  }

  it("summarizes the five P4 data checks without inventing a separate page", () => {
    const readyCollection = {
      status: "fresh" as const,
      freshness: "fresh" as const,
      lastObservedAt: "2026-06-18T10:00:00.000Z",
      counts: {
        records: 2,
        todo: 0,
        identified: 0,
        scraped: 1,
        graphified: 1,
        error: 0,
      },
    };
    const partialGeo = {
      status: "partial" as const,
      freshness: "unknown" as const,
      lastObservedAt: null,
      source: { availability: "pdf", quality: "pdf", hasUrl: true },
      counts: {
        inventoryLayers: 1,
        currentVersions: 0,
        withGeometry: 0,
      },
    };

    const readiness = computeDataQualityReadiness(
      makeSummary({
        councilMinutes: readyCollection,
        youtube: readyCollection,
        zones: partialGeo,
      }),
    );

    expect(readiness.status).toBe("partial");
    expect(readiness.readyCount).toBe(2);
    expect(readiness.partialCount).toBe(1);
    expect(readiness.unknownCount).toBe(2);
    expect(readiness.detail).toBe("2/5 prêts · 1 partiel · 2 à configurer");
  });

  it("uses clear French labels for API data-quality states", () => {
    expect(dataQualityStatusLabel("fresh")).toBe("prêt");
    expect(dataQualityStatusLabel("partial")).toBe("partiel");
    expect(dataQualityStatusLabel("stale")).toBe("périmé");
    expect(dataQualityStatusLabel("unknown")).toBe("à configurer");
  });

  it("summarizes PDF/raw evidence linkage from signal detail events", () => {
    const readiness = computeEvidenceReadiness([
      { sourceRef: "raw/proces-verbaux/2026/06/18/a.pdf" },
      { sourceRef: "" },
    ]);

    expect(readiness.status).toBe("partial");
    expect(readiness.label).toBe("preuves à relier");
    expect(readiness.detail).toBe("1/2 événements avec source PDF/raw");
  });
});

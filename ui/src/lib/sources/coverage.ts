/**
 * coverage.ts — Merge scrape-status + signals/by-city to produce the
 * "grand filet" coverage view: one entry per scanned city, with a flag
 * indicating whether a real designation-event (zonage change) was detected.
 *
 * Design decisions:
 * - "Scanned" = any city that appears in scrape-status records OR in
 *   signals/by-city. This is the honest set: only cities the pipeline has
 *   touched show up here.
 * - "Has zonage" = designationEventCount > 0 in signals/by-city.
 * - No PII. citySlug is a non-identifying technical identifier (Loi 25).
 */

import type { CityMaturitySummary } from "./maturity.js";
import type { SignalCityItem } from "$lib/signals/signals-by-city-client.js";

/** One city's coverage entry: scraping maturity + zonage signal status. */
export interface CoverageCityEntry {
  citySlug: string;
  /** True when at least one DesignationEvent was found for this city. */
  hasZonage: boolean;
  /** Count of DesignationEvents (0 when not in signals/by-city). */
  designationEventCount: number;
  /** ISO timestamp from project state; null when no state. */
  generatedAt: string | null;
  /** Scrape-status maturity summary (undefined when no scrape-status records). */
  maturitySummary: CityMaturitySummary | undefined;
}

/** Aggregate coverage stats derived from CoverageCityEntry[]. */
export interface CoverageStats {
  totalScanned: number;
  totalWithZonage: number;
}

/**
 * Merge scrape-status city summaries (maturity) with signals/by-city items
 * to build a unified coverage list.
 *
 * - The union of city slugs from both sources defines the scanned set.
 * - Cities only in by-city (no scrape-status) are included with undefined
 *   maturitySummary.
 * - Cities only in scrape-status (no by-city signal) default to
 *   designationEventCount=0.
 */
export function buildCoverageEntries(
  maturitySummaries: CityMaturitySummary[],
  signalItems: SignalCityItem[],
): CoverageCityEntry[] {
  // Index both sets by citySlug
  const byMaturity = new Map(
    maturitySummaries.map((s) => [s.citySlug, s]),
  );
  const bySignal = new Map(
    signalItems.map((i) => [i.citySlug, i]),
  );

  // Union of all known slugs
  const allSlugs = new Set<string>([
    ...maturitySummaries.map((s) => s.citySlug),
    ...signalItems.map((i) => i.citySlug),
  ]);

  return Array.from(allSlugs)
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => {
      const signal = bySignal.get(slug);
      const maturity = byMaturity.get(slug);
      return {
        citySlug: slug,
        hasZonage: (signal?.designationEventCount ?? 0) > 0,
        designationEventCount: signal?.designationEventCount ?? 0,
        generatedAt: signal?.generatedAt ?? null,
        maturitySummary: maturity,
      };
    });
}

/** Derive aggregate stats from a coverage entry list. */
export function computeCoverageStats(
  entries: CoverageCityEntry[],
): CoverageStats {
  return {
    totalScanned: entries.length,
    totalWithZonage: entries.filter((e) => e.hasZonage).length,
  };
}

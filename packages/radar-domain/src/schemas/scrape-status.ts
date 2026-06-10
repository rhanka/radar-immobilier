import { z } from "zod";

/**
 * The 5 source kinds tracked in the scraping maturity model.
 * Restricted to what the pilot sources for Québec municipalities cover.
 */
export const ScrapeStatusSource = z.enum([
  "conseils-municipaux",
  "avis-publics",
  "youtube-seances",
  "zonage",
  "role-evaluation",
]);
export type ScrapeStatusSourceT = z.infer<typeof ScrapeStatusSource>;

/** Whether the source is collected once (one_shot) or on a recurrence (refresh). */
export const ScrapeStatusAutomation = z.enum(["one_shot", "refresh"]);
export type ScrapeStatusAutomationT = z.infer<typeof ScrapeStatusAutomation>;

/**
 * Pipeline stage:
 *  todo        — source identified but not yet attempted
 *  identified  — site/URL found, no collection yet
 *  scraped     — raw documents collected in object storage
 *  graphified  — documents extracted and committed to the knowledge graph
 *  error       — last run failed
 */
export const ScrapeStatusStatus = z.enum([
  "todo",
  "identified",
  "scraped",
  "graphified",
  "error",
]);
export type ScrapeStatusStatusT = z.infer<typeof ScrapeStatusStatus>;

/** Format of collected data — useful for downstream processing hints. */
export const ScrapeStatusDataQuality = z.enum(["pdf", "geojson", "html", "none"]);
export type ScrapeStatusDataQualityT = z.infer<typeof ScrapeStatusDataQuality>;

/**
 * Scraping progress record for one (city × source) pair.
 *
 * Persistence: ObjectStore at `scrape-status/index.json` (a JSON array of
 * ScrapeStatusT). Chosen over a Drizzle migration because the field set is
 * still evolving (MASTER.md storage policy: unstable fields → jsonb / object
 * store until BR-06+ stabilises the pattern).
 */
export const ScrapeStatus = z.object({
  /** Kebab-case city slug, e.g. "valleyfield", "beauharnois". */
  citySlug: z.string().min(1),
  source: ScrapeStatusSource,
  automation: ScrapeStatusAutomation,
  /**
   * Rolling collection window in months. Defaults to 6 for conseils-municipaux
   * (council minutes), ignored for point-in-time sources.
   */
  windowMonths: z.number().int().positive().default(6),
  status: ScrapeStatusStatus,
  /** Percentage of documents collected vs. expected (0–100), if measurable. */
  coveragePct: z.number().min(0).max(100).optional(),
  /** ISO-8601 timestamp of the last collection run. */
  lastRunAt: z.string().datetime().optional(),
  /** URL of the data source website. */
  siteUrl: z.string().url().optional(),
  dataQuality: ScrapeStatusDataQuality.optional(),
  notes: z.string().optional(),
});
export type ScrapeStatusT = z.infer<typeof ScrapeStatus>;

/**
 * Weight per pipeline stage (0–1) used to aggregate city maturity.
 * - todo / error  → 0   (nothing collected)
 * - identified    → 0.25 (site found, no data yet)
 * - scraped       → 0.5  (raw data in object storage, not yet structured)
 * - graphified    → 1.0  (fully integrated into the knowledge graph)
 */
const STATUS_WEIGHT: Record<ScrapeStatusStatusT, number> = {
  todo: 0,
  error: 0,
  identified: 0.25,
  scraped: 0.5,
  graphified: 1.0,
};

/**
 * Compute the overall collection maturity for a city (0–100 integer).
 * Pass all ScrapeStatus records that share the same citySlug.
 * Returns 0 for an empty list.
 */
export function cityMaturity(items: ScrapeStatusT[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, item) => sum + STATUS_WEIGHT[item.status], 0);
  return Math.round((total / items.length) * 100);
}

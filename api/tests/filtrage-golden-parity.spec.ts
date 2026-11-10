import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resultCivilDates } from "@radar/domain";
import { database, describeDb } from "../src/services/facets/scope-db-fixture.js";
import { graphNodes } from "../src/db/schema.js";
import {
  aggregateGraphSignalProjectionRows, listCitiesWithSignalNodes,
  type GraphSignalDateRange,
} from "../src/services/graph/graph-store.js";

/**
 * SPEC_FILTRAGE_API section 6 gate: by-city counters from the historical
 * JS path (full props + matchesDocumentDateWindow) must equal the SQL
 * window path (listCitiesWithSignalNodes) on the golden set — the two
 * spec cities, a third city, and no rows for the empty city.
 */
const NOW = "2026-11-09";
function daysAgo(n: number): string {
  return new Date(Date.parse(NOW) - n * 86400000).toISOString().slice(0, 10);
}
type Seed = { city: string; id: string; type: string; props: Record<string, unknown> };
const SEEDS: Seed[] = [
  { city: "montreal-est", id: "a1", type: "Signal", props: { properties: { category: "rezonage", etape: "avis_motion" }, refs: [{ publishedAt: daysAgo(3), fetchedAt: `${daysAgo(3)}T12:00:00.000Z`, excerpt: "e" }] } },
  { city: "montreal-est", id: "a2", type: "Signal", props: { properties: { category: "piia", etape: "adoption" }, refs: [{ publishedAt: daysAgo(40), fetchedAt: `${daysAgo(40)}T12:00:00.000Z` }] } },
  { city: "montreal-est", id: "a3", type: "DesignationEvent", props: { properties: { etape_date: daysAgo(100) } } },
  { city: "montreal-est", id: "a4", type: "Signal", props: { properties: { category: "derogation_mineure" }, refs: [{ publishedAt: daysAgo(400) }] } },
  { city: "salaberry-de-valleyfield", id: "b1", type: "Signal", props: { refs: [{ publishedAt: daysAgo(5), fetchedAt: `${daysAgo(5)}T12:00:00.000Z` }] } },
  { city: "salaberry-de-valleyfield", id: "b2", type: "Signal", props: { properties: { etape: "consultation" }, refs: [{ documentDate: { status: "known", precision: "day", value: daysAgo(20) } }] } },
  { city: "golden-c", id: "c1", type: "Signal", props: { properties: { refs: [{ publishedAt: daysAgo(2), fetchedAt: "not-a-date" }] } } },
];
const WINDOWS: Array<{ name: string; range?: GraphSignalDateRange }> = [
  { name: "7d", range: { dateFrom: daysAgo(7), dateTo: NOW } },
  { name: "90d", range: { dateFrom: daysAgo(90), dateTo: NOW } },
  { name: "unbounded", range: undefined },
  { name: "scrap-7d", range: { dateFrom: daysAgo(7), dateTo: NOW, dateBasis: "scrap" } },
  { name: "empty", range: { dateFrom: "2020-01-01", dateTo: "2020-01-31" } },
  { name: "7d-excl", range: { dateFrom: daysAgo(7), dateTo: NOW, excludePiia: true, excludeDerogations: true } },
];

describeDb("filtrage golden parity (lot 2, SPEC section 6)", () => {
  it("by-city counters identical before/after on every window", async () => {
    const { db, pool } = await database();
    for (const s of SEEDS) {
      await db.insert(graphNodes).values({ id: s.id, type: s.type, label: `Signal ${s.id}`, citySlug: s.city,
        props: s.props, effectiveDocumentDates: resultCivilDates(s.props, "document"),
        effectiveScrapDates: resultCivilDates(s.props, "scrap") });
    }
    for (const w of WINDOWS) {
      const rows = await db.select({ id: graphNodes.id, citySlug: graphNodes.citySlug, type: graphNodes.type,
        category: sql<string | null>`${graphNodes.props}->'properties'->>'category'`, label: graphNodes.label,
        nbUnitesMax: sql<string | null>`${graphNodes.props}->'properties'->>'nb_unites_max'`,
        intensite: sql<string | null>`${graphNodes.props}->'properties'->>'intensite'`,
        description: sql<string | null>`${graphNodes.props}->'properties'->>'description'`,
        etapeAnnote: sql<string | null>`${graphNodes.props}->'properties'->>'etape'`,
        props: graphNodes.props, sourceRef: graphNodes.sourceRef }).from(graphNodes);
      const before = aggregateGraphSignalProjectionRows(rows, w.range);
      const after = await listCitiesWithSignalNodes(db, w.range);
      expect(after, `window ${w.name}`).toEqual(before);
    }
    const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM graph_nodes
      WHERE type IN ('Signal','DesignationEvent') AND city_slug IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(effective_document_dates) d WHERE d >= $1 AND d <= $2)`,
      [daysAgo(7), NOW]);
    // eslint-disable-next-line no-console
    console.log(explain.rows.map((r: Record<string, string>) => r["QUERY PLAN"]).join("\n"));
  }, 120000);
});

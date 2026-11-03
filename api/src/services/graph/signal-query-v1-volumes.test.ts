/**
 * I-0 volume measurements on the test DB with documented seeds.
 *
 * Seeds are deterministic and isolated (`i0-vol-*` city slugs) so a shared
 * test database is safe: every row this file inserts is removed in the same
 * run. When POSTGRES_HOST is unset (host runs without the stack) the DB
 * section is skipped; the committed volumes file remains the record.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../../db/client.js";
import { loadConfig } from "../../config.js";
import { graphNodes } from "../../db/schema.js";
import {
  getSignalNodesForCity,
  listCitiesWithSignalNodes,
} from "../graph/graph-store.js";

const VOLUMES_PATH = "tests/fixtures/signals-query-v1/volumes.json";

/** Documented seeds: [citySlug, count]. Fixed, no randomness. */
const SEEDS: Array<{ city: string; count: number }> = [
  { city: "i0-vol-a", count: 6 },
  { city: "i0-vol-b", count: 3 },
  { city: "i0-vol-c", count: 3 },
];

function seedProps(index: number): Record<string, unknown> {
  return {
    properties: {
      category: index === 0 ? null : "rezonage",
      description: index === 0 ? "x".repeat(4000) : `seed signal ${index}`,
      etape: "avis_motion",
      refs: [
        {
          documentDate: { status: "known", precision: "day", value: "2026-10-02" },
          publishedAt: "2026-10-02",
          fetchedAt: "2026-10-03T10:00:00Z",
          excerpt: "seed excerpt",
        },
      ],
    },
  };
}

describe("signal-query-v1 volumes", () => {
  it("should measure what the UI loads today per city and all-cities", async () => {
    if (!process.env.POSTGRES_HOST) return;
    const { db, pool } = createDb(loadConfig());
    try {
      for (const { city, count } of SEEDS) {
        for (let index = 0; index < count; index += 1) {
          await db.insert(graphNodes).values({
            id: `${city}-${String(index).padStart(2, "0")}`,
            type: "Signal",
            label: `I-0 volume seed ${city} ${index}`,
            citySlug: city,
            props: seedProps(index),
            sourceRef: null,
          }).onConflictDoNothing();
        }
      }
      const citiesStart = Date.now();
      const cities = (await listCitiesWithSignalNodes(db)).filter((row) =>
        row.citySlug.startsWith("i0-vol-"));
      const citiesMs = Date.now() - citiesStart;
      expect(cities.map((row) => row.citySlug).sort()).toEqual(["i0-vol-a", "i0-vol-b", "i0-vol-c"]);
      const perCity: Array<{ citySlug: string; rows: number; jsonBytes: number; readMs: number }> = [];
      for (const { city } of SEEDS) {
        const start = Date.now();
        const rows = await getSignalNodesForCity(db, city);
        const readMs = Date.now() - start;
        perCity.push({
          citySlug: city,
          rows: rows.length,
          jsonBytes: Buffer.byteLength(JSON.stringify(rows)),
          readMs,
        });
      }
      const measured = {
        seeds: SEEDS,
        note: "UI today loads the full visible population of one city with raw props, no limit or cursor; all-cities opens one such read per city with signals.",
        perCity,
        maxPerCity: Math.max(...perCity.map((row) => row.rows)),
        totalAllCities: perCity.reduce((sum, row) => sum + row.rows, 0),
        maxJsonBytes: Math.max(...perCity.map((row) => row.jsonBytes)),
        citiesMs,
      };
      const bytes = `${JSON.stringify(measured, null, 2)}\n`;
      let expected: string;
      try {
        expected = `${readFileSync(VOLUMES_PATH, "utf8")}`;
      } catch {
        mkdirSync(VOLUMES_PATH.slice(0, VOLUMES_PATH.lastIndexOf("/")), { recursive: true });
        writeFileSync(VOLUMES_PATH, bytes);
        expected = bytes;
      }
      // Counts and bytes are the frozen record; timings are environment
      // noise, asserted as bounds only so the golden never flakes in CI.
      const freeze = (value: typeof measured) => ({
        ...value,
        citiesMs: 0,
        perCity: value.perCity.map(({ readMs: _readMs, ...rest }) => rest),
      });
      expect(freeze(measured)).toEqual(freeze(JSON.parse(expected) as typeof measured));
      expect(citiesMs).toBeLessThan(5000);
      for (const row of perCity) expect(row.readMs).toBeLessThan(5000);
    } finally {
      await db.delete(graphNodes).where(inArray(graphNodes.citySlug, SEEDS.map((seed) => seed.city)));
      for (const { city } of SEEDS) {
        const leftover = await db.select({ id: graphNodes.id }).from(graphNodes)
          .where(eq(graphNodes.citySlug, city));
        expect(leftover).toEqual([]);
      }
      await pool.end();
    }
  });
});

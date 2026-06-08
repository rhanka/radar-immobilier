import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { zoneVersions } from "../../src/db/schema.js";

/**
 * WP5-V1 migration harness test (SPEC_ONTOLOGY_DATA_MODEL.md §4, §8.1). Runs
 * against the migrated `test-wp5v1` database: confirms the PostGIS / btree_gist
 * extensions, the nullable-geom default, and the non-overlap EXCLUDE constraint
 * on the versioned bitemporal table.
 *
 * Data here is ILLUSTRATIVE (synthetic canonical ids/spans) — purely to exercise
 * the DDL, not asserted facts.
 */

const { db, pool } = createDb(loadConfig());

const CANON = `zone::test::wp5v1::${Date.now()}`;

afterAll(async () => {
  await db.delete(zoneVersions).where(sql`canonical_id = ${CANON}`);
  await pool.end();
});

describe("WP5-V1 ontology bitemporal migration", () => {
  it("enabled the postgis and btree_gist extensions", async () => {
    const res = await db.execute(
      sql`select extname from pg_extension where extname in ('postgis','btree_gist')`,
    );
    const names = res.rows.map((r) => (r as { extname: string }).extname).sort();
    expect(names).toEqual(["btree_gist", "postgis"]);
  });

  it("inserts a zone version with geom null / geom_source 'none' by default", async () => {
    const [row] = await db
      .insert(zoneVersions)
      .values({
        canonicalId: CANON,
        citySlug: "salaberry-de-valleyfield",
        codeAffiche: "H-609-4",
        kind: "H",
        validFrom: "2020-01-01",
        validTo: "2024-06-01",
        knownFrom: new Date("2024-06-02T00:00:00.000Z"),
        rawRef: "raw/avis/salaberry/2020/x.pdf.sha",
      })
      .returning();
    expect(row.geom).toBeNull();
    expect(row.geomSource).toBe("none");
    expect(row.reconStatus).toBe("validated");
  });

  it("rejects a second currently-believed version overlapping the same canonical validity range", async () => {
    // [2024-06-01, null) overlaps nothing yet (first row ended 2024-06-01), so this inserts.
    await db.insert(zoneVersions).values({
      canonicalId: CANON,
      citySlug: "salaberry-de-valleyfield",
      codeAffiche: "H-609-4",
      kind: "H",
      validFrom: "2024-06-01",
      validTo: null,
      knownFrom: new Date("2024-06-02T00:00:00.000Z"),
      rawRef: "raw/avis/salaberry/2024/y.pdf.sha",
    });

    // An overlapping open version for the SAME canonical must be excluded.
    await expect(
      db.insert(zoneVersions).values({
        canonicalId: CANON,
        citySlug: "salaberry-de-valleyfield",
        codeAffiche: "H-609-4",
        kind: "H",
        validFrom: "2025-01-01",
        validTo: null,
        knownFrom: new Date("2025-02-02T00:00:00.000Z"),
        rawRef: "raw/avis/salaberry/2025/z.pdf.sha",
      }),
    ).rejects.toThrow(/exclusion|overlap|zone_versions_no_overlap/i);
  });
});

import { describe, expect, it } from "vitest";
import { subgraphForCity, upsertGraphAtomic } from "./graph-store.js";
import {
  enrichGraphify34Snapshot,
} from "./graphify-34-enrichment.js";
import { snapshotFromExistingCity } from "./graphify-34-snapshot.js";

const DB_AVAILABLE = process.env.NODE_ENV === "test" || process.env.GRAPH_DB_TESTS === "1";

describe.skipIf(!DB_AVAILABLE)("Graphify 3.4 test-city projection", () => {
  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    return createDb(loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    })).db;
  }

  it("measures 48 nodes before/after and is idempotent after projection", async () => {
    const db = await getDb();
    const city = "__test_g34_witness__";
    const { graphNodes, graphEdges } = await import("../../db/schema.js");
    const { eq, inArray, or } = await import("drizzle-orm");
    const clean = async () => {
      const ids = (await db.select({ id: graphNodes.id }).from(graphNodes).where(eq(graphNodes.citySlug, city)))
        .map((row) => row.id);
      if (ids.length > 0) {
        await db.delete(graphEdges).where(or(inArray(graphEdges.srcId, ids), inArray(graphEdges.dstId, ids)));
      }
      await db.delete(graphNodes).where(eq(graphNodes.citySlug, city));
    };

    await clean();
    try {
      const initial = {
        nodes: Array.from({ length: 48 }, (_, index) => ({
          id: `${city}:signal:${String(index).padStart(2, "0")}`,
          type: "Signal",
          label: index % 2 === 0 ? "Avis de motion habitation" : "Adoption du règlement",
          properties: { category: "rezonage", description: "Projet de règlement résidentiel" },
        })),
      };
      const seeded = await upsertGraphAtomic(db, city, initial);
      expect(seeded.aborted).toBe(false);

      const before = enrichGraphify34Snapshot(
        snapshotFromExistingCity(await subgraphForCity(db, city)),
        city,
      );
      expect(before.stats.signal_node_count).toBe(48);
      expect(before.stats.fields.effet_densifiant.before_missing).toBe(48);
      expect(before.stats.fields.etape.before_missing).toBe(48);
      expect(before.stats.fields.instrument.before_missing).toBe(48);

      const projected = await upsertGraphAtomic(db, city, before.snapshot);
      expect(projected.aborted).toBe(false);

      const after = enrichGraphify34Snapshot(
        snapshotFromExistingCity(await subgraphForCity(db, city)),
        city,
      );
      // `effet_densifiant` stays missing on all 48 nodes by decision: phase A
      // no longer installs an `inconnu` placeholder, because a present
      // placeholder would lock the field against the Geo artifact that will
      // supply the real density effect. The counter is still asserted — the
      // test measures the decided behaviour instead of ignoring the field.
      expect(after.stats.fields.effet_densifiant).toEqual({
        before_missing: 48, after_present: 0, added_or_canonicalized: 0,
      });
      expect(after.snapshot.nodes.every((node) =>
        !("effet_densifiant" in (node.properties as Record<string, unknown>))
      )).toBe(true);
      // The two fields phase A does write must survive the round-trip through
      // Postgres and be idempotent on replay — that part is unchanged.
      expect(after.stats.fields.etape).toEqual({
        before_missing: 0, after_present: 48, added_or_canonicalized: 0,
      });
      expect(after.stats.fields.instrument).toEqual({
        before_missing: 0, after_present: 48, added_or_canonicalized: 0,
      });
      expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot));
    } finally {
      await clean();
    }
  });
});

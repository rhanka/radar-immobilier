import { sql } from "drizzle-orm";
import { createDb } from "../client.js";
import { loadConfig } from "../../config.js";
import { bumpGraphSourceRevision } from "../../services/facets/projection-revisions.js";

const { db, pool } = createDb(loadConfig());
try {
  const cities = await db.execute(sql`SELECT DISTINCT city_slug FROM graph_nodes ORDER BY city_slug`);
  for (const row of cities.rows) {
    const city = String(row.city_slug);
    await db.transaction(async (tx) => {
      // Same lock as graph-store.lockCityGraph: serialize backfill and import.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${city}))`);
      await bumpGraphSourceRevision(tx, city);
    });
  }
  console.log(JSON.stringify({ version: 1, cities: cities.rows.length }));
} finally {
  await pool.end();
}

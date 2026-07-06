/**
 * WP3 LOT1 — Persistance du snapshot de cohérence E2E (`consistency_snapshots`).
 *
 * Upsert idempotent sur `city_slug` : chaque run du job batch réécrit la
 * ligne de chaque ville ciblée avec la mesure la plus récente (mode batch
 * PG daté — jamais un mix de comptes de deux runs pour une même ville).
 */
import type { Database } from "../../db/client.js";
import { consistencySnapshots } from "../../db/schema.js";
import type { CityConsistency } from "./consistency-calc.js";

/** Écrit (upsert) les snapshots calculés — un run réécrit chaque ville ciblée. */
export async function writeConsistencySnapshots(
  db: Database,
  consistencies: readonly CityConsistency[],
): Promise<void> {
  for (const consistency of consistencies) {
    const generatedAt = new Date(consistency.generatedAt ?? Date.now());
    await db
      .insert(consistencySnapshots)
      .values({
        citySlug: consistency.citySlug,
        generatedAt,
        state: consistency.state,
        payload: consistency,
      })
      .onConflictDoUpdate({
        target: consistencySnapshots.citySlug,
        set: {
          generatedAt,
          state: consistency.state,
          payload: consistency,
        },
      });
  }
}

/** Lit tous les snapshots présents (batch, table bornée — jamais 1104 lignes en V1). */
export async function readAllConsistencySnapshots(
  db: Database,
): Promise<CityConsistency[]> {
  const rows = await db.select().from(consistencySnapshots);
  return rows.map((row) => row.payload as CityConsistency);
}

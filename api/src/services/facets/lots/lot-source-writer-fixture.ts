// Synthetic contention fixtures for B3 lot source-writer serialization.
// Builds on the 6J lot fixture (workspace, rights, open destination) and
// seeds two validated B3 lot versions in their own synthetic namespace.
// Every identifier, city and lot number is invented; no operational data.
// External acquisition stays mocked: tests inject stub fetch payloads.
import type pg from "pg";
import { lotVersions } from "../../../db/schema.js";
import {
  describeDb,
  lotFixture,
  type LotFixture,
} from "./lot-fixture.js";
import { resolveLotSource } from "./lot-target.js";
import { lotSourceLockKey } from "./lot-source-serialization.js";

export { describeDb };
export type { LotFixture };

/** Synthetic city reserved for B3 source-writer contention. */
export const B3_CITY = "synthetic-b3-city";

export const B3_CANONICALS = [
  "lot-canonical-syn-b3-01",
  "lot-canonical-syn-b3-02",
] as const;

export const B3_NO_LOTS = ["SYN-B3-0001", "SYN-B3-0002"] as const;

export const B3_VERSION_IDS = [
  "b3000000-0000-4000-8000-000000000001",
  "b3000000-0000-4000-8000-000000000002",
] as const;

export type SourceWriterFixture = LotFixture;

/**
 * Seed the two B3 lot versions on top of the qualified 6J lot fixture.
 * The destination stays open so facet commands can contend with writers.
 */
export async function sourceWriterFixture(): Promise<SourceWriterFixture> {
  const f = await lotFixture();
  for (let index = 0; index < B3_CANONICALS.length; index++) {
    await f.db.insert(lotVersions).values({
      id: B3_VERSION_IDS[index]!,
      canonicalId: B3_CANONICALS[index]!,
      noLot: B3_NO_LOTS[index]!,
      citySlug: B3_CITY,
      reconStatus: "validated",
      validFrom: "2025-01-01",
      knownFrom: new Date("2025-01-01T00:00:00.000Z"),
      rawRef: `synthetic-b3-${index + 1}`,
    });
  }
  return f;
}

/** Target plus displayed version for one seeded B3 lot. */
export async function b3Displayed(f: LotFixture, index = 0) {
  const target = {
    type: "Lot" as const,
    authority: "lot_versions" as const,
    citySlug: B3_CITY,
    canonicalId: B3_CANONICALS[index]!,
  };
  return { target, displayed: (await resolveLotSource(f.db, target)).displayed };
}

/**
 * Hold the canonical source lock on a dedicated pool client inside an
 * explicitly opened transaction. The caller keeps the client checked out
 * for the whole barrier, then releases it with commit or rollback.
 */
export async function holdBarrierLock(
  client: pg.PoolClient,
  citySlug: string,
  canonicalId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    lotSourceLockKey(citySlug, canonicalId),
  ]);
}

/** End a barrier transaction and return the client to the pool. */
export async function releaseBarrier(
  client: pg.PoolClient,
  commit: boolean,
): Promise<void> {
  try {
    await client.query(commit ? "COMMIT" : "ROLLBACK");
  } finally {
    client.release();
  }
}

/** Minimal OGC feature payload for mocked acquisition. */
export function b3OgcFeature(
  noLot: string,
  withGeom: boolean,
): Record<string, unknown> {
  return {
    type: "Feature",
    geometry: withGeom
      ? { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
      : null,
    properties: { NO_LOT: noLot },
  };
}

/** Stub fetch resolving one JSON payload with HTTP 200. */
export function stubFetchJson(payload: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

/**
 * 6K canonical-target serialization shared by the facet writer and every
 * supported `lot_versions` writer.
 *
 * The facet writer holds this lock from source comparison through commit
 * (see `lot-writer.ts`). A source writer mutating the same canonical
 * target must hold the same key for its own mutation, otherwise a source
 * change can land between the facet comparison and the facet commit.
 * Deployment qualifies each writer against this protocol and records the
 * attestation in `lot_source_writer_coverage`; the 6K activation gate
 * refuses to proceed while any supported writer stays uncovered.
 */
import { sql } from "drizzle-orm";

/** Supported `lot_versions` writers (SR §3.7). */
export const KNOWN_LOT_SOURCE_WRITERS = [
  "geo/ogc-pull",
  "geo/populate-geo",
  "exploitation/projection",
] as const;

export type LotSourceWriter = (typeof KNOWN_LOT_SOURCE_WRITERS)[number];

export function assertLotSourceWriter(writer: string): asserts writer is LotSourceWriter {
  if (!(KNOWN_LOT_SOURCE_WRITERS as readonly string[]).includes(writer)) {
    throw new Error(`unknown_lot_source_writer:${writer}`);
  }
}

/**
 * Canonical advisory-lock key for one stable lot target. The JSON shape
 * matches the historical `lotTargetLock` key exactly, so facet and source
 * writers serialize on the same lock.
 */
export function lotSourceLockKey(citySlug: string, canonicalId: string): string {
  return JSON.stringify(["lot-source", citySlug, canonicalId]);
}

export interface LockExecutor {
  execute: (query: unknown) => Promise<unknown>;
}

/** Hold the canonical-target serialization for the enclosing transaction. */
export async function acquireLotSourceLock(
  tx: LockExecutor, citySlug: string, canonicalId: string,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lotSourceLockKey(citySlug, canonicalId)}, 0))`);
}

/**
 * 6K source-writer coverage: every supported `lot_versions` writer must be
 * recorded as covered before activation. Coverage means the writer holds
 * the canonical-target serialization (`lotSourceLockKey`) for its own
 * mutation, so no source change lands between the facet comparison and
 * the facet commit. Attestations are explicit deployment inputs; the
 * migration seeds every known writer as uncovered.
 */
import type { Database } from "../../../db/client.js";
import { lotSourceWriterCoverage } from "../../../db/schema.js";
import {
  KNOWN_LOT_SOURCE_WRITERS,
  assertLotSourceWriter,
  type LotSourceWriter,
} from "./lot-source-serialization.js";

export { KNOWN_LOT_SOURCE_WRITERS, type LotSourceWriter };

type CoverageTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Record (or refresh) one writer attestation. Covered stays explicit. */
export async function attestLotSourceWriter(
  db: CoverageTx,
  writer: LotSourceWriter,
  covered: boolean,
  reason: string,
): Promise<void> {
  assertLotSourceWriter(writer);
  if (!reason.trim() || reason.length > 1024) throw new Error("invalid_coverage_reason");
  await db.insert(lotSourceWriterCoverage).values({ writer, covered, reason })
    .onConflictDoUpdate({
      target: [lotSourceWriterCoverage.writer],
      set: { covered, reason, checkedAt: new Date() },
    });
}

/** Writers still uncovered (missing rows count as uncovered). */
export async function uncoveredLotSourceWriters(
  db: Pick<Database, "select">,
): Promise<LotSourceWriter[]> {
  const rows = await db.select().from(lotSourceWriterCoverage);
  const byWriter = new Map(rows.map((row) => [row.writer, row.covered]));
  return KNOWN_LOT_SOURCE_WRITERS.filter((writer) => byWriter.get(writer) !== true);
}

import type { ManifestRow } from "../lot-migration-report/manifest.js";
import type { LotTx } from "./lot-types.js";
import { lotTargetLock } from "./lot-streams.js";

/** Match batch lock order before resolving any source version. */
export async function lockLotImportTargets(tx: LotTx, rows: ManifestRow[]): Promise<void> {
  const keys = new Set(rows.flatMap((row) => row.destination
    ? [JSON.stringify([row.destination.citySlug, row.destination.canonicalTarget])] : []));
  for (const key of [...keys].sort()) {
    const [citySlug, canonicalId] = JSON.parse(key) as [string, string];
    await lotTargetLock(tx, { citySlug, canonicalId });
  }
}

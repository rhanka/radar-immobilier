import type { Database } from "../../../db/client.js";
import { FacetError } from "../target.js";
import { readCutoverTargets, readLotCutover } from "./lot-cutover-status.js";
import type { LotTarget } from "./lot-target.js";

/** Pending targets never masquerade as unmarked and accept no commands. */
export async function assertCutoverTargetReady(
  db: Database, workspaceId: string, mode: string, target: LotTarget,
): Promise<void> {
  if (!(await readLotCutover(db, workspaceId)).manifestSha) return;
  const targets = await readCutoverTargets(db, workspaceId);
  const key = `dest:${target.citySlug}::${target.canonicalId}::${mode}`;
  if (targets.unavailable.includes(key)) throw new FacetError(409, "lot_target_unavailable");
  if (targets.pending.some((entry) => entry.targetKey === key)) throw new FacetError(409, "lot_target_pending");
}

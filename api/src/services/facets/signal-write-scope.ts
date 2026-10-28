/**
 * PW-B 6L1 scope helpers: run the existing BASE services inside a caller
 * transaction (shared executor, no logic copied) and compare revision
 * tokens. No routes, no intent storage; PW-D owns fences beyond BASE.
 */
import type { Database } from "../../db/client.js";
import { FacetError } from "./target.js";
import { readProjectionScopeInTx } from "./projection-revisions.js";
import { SIGNAL_PROJECTION_MODE } from "./projection-scope.js";

export type WriteTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Fresh authorized scope token read under the caller's locks. */
export async function readScopeTokenInTx(
  tx: WriteTx, sub: string, workspaceId: string, citySlug: string,
): Promise<string> {
  const scope = await readProjectionScopeInTx(
    tx, sub, workspaceId, citySlug, SIGNAL_PROJECTION_MODE,
  );
  return scope.token;
}

/** Refuse a stale preparation before any writer runs. */
export function assertScopeTokenMatches(expected: string, fresh: string): void {
  if (expected !== fresh) throw new FacetError(409, "projection_revision_conflict");
}

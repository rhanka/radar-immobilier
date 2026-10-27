import { ArtifactOperationError, type ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { MembershipQueryable } from "./admission.js";

/** Shared attempts admitted before preparation, independent of commit rollback. */
export const HOST_ACTOR_RATE_LIMIT_PER_MINUTE = 10;

export async function reserveArtifactAttempt(db: MembershipQueryable, scope: string, actor: string): Promise<boolean> {
  try {
    const result = await db.query(`WITH reserved AS (
      INSERT INTO artifacts.host_actor_rate (storage_scope_id, actor_id, window_start, count)
      VALUES ($1, $2, date_trunc('minute', now()), 1)
      ON CONFLICT (storage_scope_id, actor_id, window_start) DO UPDATE
        SET count = artifacts.host_actor_rate.count + 1
        WHERE artifacts.host_actor_rate.count < $3
      RETURNING count
    ), cleaned AS (
      DELETE FROM artifacts.host_actor_rate WHERE storage_scope_id=$1 AND actor_id=$2
        AND window_start < date_trunc('minute', now())
    ) SELECT count FROM reserved`, [scope, actor, HOST_ACTOR_RATE_LIMIT_PER_MINUTE]);
    return result.rows.length === 1;
  } catch (cause) {
    throw new ArtifactOperationError("admission_unavailable", { cause });
  }
}

export function rateLimitedOutcome(invocationId: string, operation: string): ArtifactOutcome<never> {
  return { ok: false, failure: {
    kind: "admission", category: "admission_unavailable", variant: "rate_limited",
    httpStatus: 429, publicCode: "rate_limited", retriable: true, invocationId,
    operation, phase: "admit", commitState: "not_committed", cause: null,
  } };
}

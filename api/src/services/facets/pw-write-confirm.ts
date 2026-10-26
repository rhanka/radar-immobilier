import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { pwWriteIntents } from "../../db/schema-pw-write.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import type { SignalWriteInput } from "./signal-write-operations.js";
import { createDurableWriteAdmission, type DurableAdmissionOptions } from "./pw-write-admission-durable.js";
import { assertPwPrincipal, pwReaderBucket } from "./pw-write-confirmation.js";
import { reservePwAttempt } from "./pw-write-quotas.js";
import { PwWriteError } from "./pw-write-errors.js";
import { appendPwAudit } from "./pw-write-audit.js";
import { recordPwRejection } from "./pw-write-rejection.js";

/** Application boundary: caller has verified cookie, CSRF and challenge MAC. */
export async function confirmPwSignalWrite(db: Database, sub: string, intentId: string,
  input: SignalWriteInput, options: DurableAdmissionOptions) {
  if (sub !== options?.confirmation?.principal?.sub) {
    throw new PwWriteError(403, "confirmation_identity_mismatch");
  }
  const [row] = await db.select().from(pwWriteIntents)
    .where(eq(pwWriteIntents.intentId, intentId.toLowerCase()));
  if (!row) throw new PwWriteError(404, "write_intent_not_found");
  assertPwPrincipal(row, options?.confirmation?.principal);
  // Attempts survive refusal/rollback, while admission quota shares BASE's commit.
  await db.transaction((tx) => reservePwAttempt(tx,
    `attempt:${pwReaderBucket(options.confirmation.principal, row.workspaceId)}`, row.intentId));
  try {
    return await coordinateSignalWrite(db, sub, input,
      createDurableWriteAdmission(intentId, options), options.clockMs);
  } catch (error) {
    const recorded = await db.transaction((tx) => recordPwRejection(tx, row.intentId, error));
    if (!recorded) await db.transaction((tx) => appendPwAudit(tx, {
      intentId: row.intentId, invocationId: row.invocationId, operation: row.operation,
      workspaceId: row.workspaceId, principal: row.principal, operationDigest: row.operationDigest,
      intentDigest: row.intentDigest, artifactRef: row.artifactRef as Record<string, unknown>,
      result: error instanceof Error && error.message === "challenge_consumed" ? "replay_denied" : "unknown",
    }));
    throw error;
  }
}

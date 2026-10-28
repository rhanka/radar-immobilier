import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { pwWriteIntents, pwWriteKeyReservations } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { FacetError } from "./target.js";
import type { SignalWriteAdmission, SignalWriteReservation } from "./signal-write-admission-port.js";
import { signalWriteOperationDigest, type SignalWriteInput } from "./signal-write-operations.js";
import type { SignalWriteResult } from "./signal-write-admission.js";
import { loadPwIntentForShare, loadPwIntentForUpdate, linkPwReceipt } from "./pw-write-store.js";
import { assertPwAuthorityOpen, readPwTombstone, pwIntentStatus } from "./pw-write-fences.js";
import { reservePwAdmission, reservePwStatus } from "./pw-write-quotas.js";
import { assertPwConfirmation, assertPwPrincipal, pwReaderBucket, type PwConfirmation } from "./pw-write-confirmation.js";
import { pwDigest, type PwPrincipal } from "./pw-write-digests.js";
import { PwWriteError } from "./pw-write-errors.js";
import { appendPwAudit } from "./pw-write-audit.js";
import { appendPwOutbox } from "./pw-write-outbox.js";
import { assertPwSession } from "./pw-write-confirmation.js";
import { reservePwIntentStatus } from "./pw-write-status-budget.js";
import { readPwRejection } from "./pw-write-rejection.js";

export interface DurableAdmissionOptions {
  confirmation: PwConfirmation;
  clockMs?: () => number;
  requestId?: string;
}

/** Durable PW-D port bound to one prepared intent; joins the BASE transaction. */
export function createDurableWriteAdmission(intentId: string,
  options: DurableAdmissionOptions): SignalWriteAdmission {
  if (!options?.confirmation) throw new PwWriteError(503, "write_authority_unavailable");
  const confirmation = JSON.parse(JSON.stringify(options.confirmation)) as PwConfirmation;
  const normalized = intentId.toLowerCase();
  const clockMs = options.clockMs ?? Date.now;
  const requestId = (options.requestId ?? randomUUID()).toLowerCase();
  return {
    lockAuthority: async (tx: WriteTx, input: Readonly<SignalWriteInput>) => {
      const [observed] = await tx.select().from(pwWriteIntents)
        .where(eq(pwWriteIntents.intentId, normalized));
      if (!observed) throw new FacetError(404, "write_intent_not_found");
      assertPwConfirmation(observed, confirmation);
      // Release no authority fence before commit; revokers acquire exclusives.
      await assertPwAuthorityOpen(tx, observed.authorityReferences as Record<string, string>);
      const row = await loadPwIntentForUpdate(tx, normalized);
      assertPwConfirmation(row, confirmation);
      assertPwSession(confirmation, clockMs());
      if (row.operation !== input.operation
        || pwDigest(row.command) !== pwDigest(input)
        || row.workspaceId !== input.workspaceId.toLowerCase()
        || row.commandKey !== input.commandKey.toLowerCase()
        || row.expectedProjectionToken !== input.expectedProjectionToken
        || row.expiresAt.getTime() !== input.expiresAtMs
        || row.operationDigest !== signalWriteOperationDigest(
          JSON.parse(JSON.stringify(input)) as SignalWriteInput)) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
    },
    reserve: async (tx: WriteTx, reservation: SignalWriteReservation) => {
      const row = await loadPwIntentForUpdate(tx, normalized);
      if (row.actorId !== reservation.actorId
        || row.operationDigest !== reservation.operationDigest
        || row.commandKey !== reservation.commandKey.toLowerCase()) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      if (row.challengeState === "consumed") throw new FacetError(409, "challenge_consumed");
      if (await readPwTombstone(tx, normalized)) throw new FacetError(409, "write_intent_revoked");
      if (row.executionState === "rejected") {
        const refusal = await readPwRejection(tx, normalized);
        if (!refusal) throw new PwWriteError(503, "write_fence_unavailable");
        throw new PwWriteError(refusal.status, refusal.code);
      }
      if (row.executionState !== "pending") throw new PwWriteError(409, "challenge_expired");
      const [key] = await tx.select().from(pwWriteKeyReservations).where(and(
        eq(pwWriteKeyReservations.actorId, reservation.actorId),
        eq(pwWriteKeyReservations.commandKey, reservation.commandKey.toLowerCase())));
      if (!key || key.intentId !== normalized || key.operationDigest !== row.operationDigest
        || key.expiresAt.getTime() !== row.expiresAt.getTime()) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
    },
    consume: async (tx: WriteTx) => {
      const row = await loadPwIntentForUpdate(tx, normalized);
      if (row.challengeState === "consumed") throw new FacetError(409, "challenge_consumed");
      const now = clockMs();
      assertPwSession(confirmation, now);
      if (now >= row.expiresAt.getTime()) throw new FacetError(409, "challenge_expired");
      await reservePwAdmission(tx, `admission:reader:${row.actorId}:${row.workspaceId}`,
        `admission:workspace:${row.workspaceId}`, normalized);
      const updated = await tx.update(pwWriteIntents)
        .set({ challengeState: "consumed", consumedAt: new Date(now) })
        .where(and(eq(pwWriteIntents.intentId, normalized),
          eq(pwWriteIntents.challengeState, "pending"))).returning();
      if (updated.length === 0) throw new FacetError(409, "challenge_consumed");
    },
    recordCommit: async (tx: WriteTx, result: SignalWriteResult) => {
      const row = await loadPwIntentForUpdate(tx, normalized);
      await linkPwReceipt(tx, { intentId: normalized, ownerId: row.actorId,
        commandKey: row.commandKey, workspaceId: row.workspaceId });
      await tx.update(pwWriteIntents).set({ executionState: "committed", decidedAt: new Date() })
        .where(eq(pwWriteIntents.intentId, normalized));
      await appendPwAudit(tx, { requestId, intentId: normalized, invocationId: row.invocationId,
        commandId: row.commandKey, operation: row.operation, workspaceId: row.workspaceId,
        target: row.target as Record<string, unknown>,
        scope: row.operation.includes(".workspace.") ? "workspace" : "personal",
        artifactRef: row.artifactRef as Record<string, unknown>, grantRef: row.grantReference, principal: row.principal,
        operationDigest: row.operationDigest, intentDigest: row.intentDigest, result: "committed" });
      await appendPwOutbox(tx, { intentId: normalized, kind: "write_committed",
        payload: { intentId: normalized, invocationId: row.invocationId,
          commandKey: row.commandKey, event: result.event } });
    },
  };
}

/** Owner status read under a shared lock; receipt disclosure stays with PW-C. */
export async function readPwWriteStatus(db: Database, intentId: string,
  principal: PwPrincipal, pageSessionId: string, clock: () => number = Date.now) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const row = await loadPwIntentForShare(tx, intentId);
    assertPwPrincipal(row, principal);
    if (row.pageSessionId !== pageSessionId) throw new PwWriteError(404, "write_intent_not_found");
    await reservePwIntentStatus(tx, row.intentId, pageSessionId, clock);
    await reservePwStatus(tx, `status:${pwReaderBucket(principal, row.workspaceId)}`);
    const status = pwIntentStatus(row, clock());
    const error = status === "rejected" ? await readPwRejection(tx, row.intentId) : null;
    if (status === "rejected" && !error) throw new PwWriteError(503, "write_fence_unavailable");
    return { intentId: row.intentId, status,
      executionState: row.executionState, expiresAt: row.expiresAt,
      challengeState: row.challengeState,
      ...(error ? { error } : {}) };
  });
}

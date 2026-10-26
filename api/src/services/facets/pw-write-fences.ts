import { eq, sql } from "drizzle-orm";
import { pwWriteAuthorityFences, pwWriteIntentTombstones, pwWriteIntents } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { FacetError } from "./target.js";
import { loadPwIntentForUpdate } from "./pw-write-store.js";
import { PwWriteError } from "./pw-write-errors.js";
import { appendPwAudit } from "./pw-write-audit.js";
import { appendPwOutbox } from "./pw-write-outbox.js";
import { assertPwPrincipal } from "./pw-write-confirmation.js";
import type { PwPrincipal } from "./pw-write-digests.js";

export type PwAuthorityKind =
  | "tier" | "grant" | "reader" | "page_session" | "delegation" | "release" | "policy";

export const PW_FENCE_ORDER: readonly PwAuthorityKind[] = [
  "tier", "policy", "release", "delegation", "reader", "grant", "page_session",
];

/** Shared authority fence: a recorded revocation closes admission before ack. */
export async function revokePwAuthority(tx: WriteTx, kind: PwAuthorityKind,
  reference: string, reason = ""): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`pw-authority:${kind}:${reference}`}, 0))`);
  await tx.insert(pwWriteAuthorityFences).values({ kind, reference, reason })
    .onConflictDoNothing();
}

async function fenced(tx: WriteTx, kind: PwAuthorityKind, reference: string): Promise<boolean> {
  const [row] = await tx.select().from(pwWriteAuthorityFences).where(sql`
    ${pwWriteAuthorityFences.kind} = ${kind} AND ${pwWriteAuthorityFences.reference} = ${reference}`);
  return row !== undefined;
}

/** Normative fence order; no network I/O, references re-read after waits. */
export async function assertPwAuthorityOpen(tx: WriteTx, fences: Partial<
  Record<PwAuthorityKind, string>>): Promise<void> {
  for (const kind of PW_FENCE_ORDER) {
    const reference = fences[kind];
    if (typeof reference !== "string" || reference.length === 0) {
      throw new PwWriteError(503, "write_authority_unavailable");
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(
      ${`pw-authority:${kind}:${reference}`}, 0))`);
    if (await fenced(tx, kind, reference)) {
      throw new PwWriteError(403, kind === "grant" ? "write_grant_revoked"
        : kind === "page_session" ? "page_session_revoked" : "write_authority_unavailable");
    }
  }
}

/** Revoke by intentId; serialized with confirm on the same exclusive lock. */
export async function revokePwIntent(tx: WriteTx, intentId: string,
  revokedBy: string, principal: PwPrincipal, reason = ""): Promise<{ committed: boolean }> {
  const row = await loadPwIntentForUpdate(tx, intentId);
  try { assertPwPrincipal(row, principal); }
  catch (error) {
    if (error instanceof PwWriteError && error.message === "confirmation_identity_mismatch") {
      throw new FacetError(404, "write_intent_not_found");
    }
    throw error;
  }
  if (row.actorId !== revokedBy.toLowerCase()) throw new FacetError(404, "write_intent_not_found");
  if (row.revokedAt !== null) return { committed: row.executionState === "committed" };
  await tx.insert(pwWriteIntentTombstones)
    .values({ intentId: row.intentId, revokedBy, reason }).onConflictDoNothing();
  await tx.update(pwWriteIntents).set({ revokedAt: new Date() })
    .where(eq(pwWriteIntents.intentId, row.intentId));
  await appendPwAudit(tx, { intentId: row.intentId, invocationId: row.invocationId,
    operation: row.operation, workspaceId: row.workspaceId, principal: row.principal,
    operationDigest: row.operationDigest, intentDigest: row.intentDigest,
    artifactRef: row.artifactRef as Record<string, unknown>, grantRef: row.grantReference,
    result: "revoked" });
  await appendPwOutbox(tx, { intentId: row.intentId, kind: "write_revoked",
    payload: { intentId: row.intentId, committed: row.executionState === "committed" } });
  return { committed: row.executionState === "committed" };
}

export async function readPwTombstone(tx: WriteTx, intentId: string) {
  const [row] = await tx.select().from(pwWriteIntentTombstones)
    .where(eq(pwWriteIntentTombstones.intentId, intentId.toLowerCase()));
  return row ?? null;
}

export type PwIntentStatus = "pending" | "committed" | "rejected" | "expired" | "revoked";

/** Execution and revocation states persist separately; revoke masks polling. */
export function pwIntentStatus(row: { executionState: string; revokedAt: unknown;
  expiresAt: Date }, nowMs: number): PwIntentStatus {
  if (row.revokedAt !== null && row.revokedAt !== undefined) return "revoked";
  if (row.executionState === "committed" || row.executionState === "rejected") {
    return row.executionState;
  }
  return nowMs >= row.expiresAt.getTime() ? "expired" : "pending";
}

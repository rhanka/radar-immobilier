import { eq, sql } from "drizzle-orm";
import { accountUsers } from "../../db/schema.js";
import { pwWriteIntents, pwWriteKeyReservations, pwWriteReceiptLinks } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { FacetError } from "./target.js";
import { pwIntentDigest, pwDigest, newPwIntentIds, type PwIntentBinding } from "./pw-write-digests.js";
import { PwWriteError } from "./pw-write-errors.js";
import { assertSignalWriteInput, signalWriteOperationDigest } from "./signal-write-operations.js";

export interface PwPrepareParams {
  operation: string;
  workspaceId: string;
  actorId: string;
  binding: PwIntentBinding;
  artifactRef: Record<string, unknown>;
  citySlug: string;
  target: unknown;
  command: unknown;
}

export type PwIntentRow = typeof pwWriteIntents.$inferSelect;

/** Create the immutable intent, challenge and key reservation atomically. */
export async function preparePwWriteIntent(tx: WriteTx, params: PwPrepareParams): Promise<PwIntentRow> {
  const key = params.binding.commandKey.toLowerCase();
  const [reservation] = await tx.select().from(pwWriteKeyReservations).where(sql`
    ${pwWriteKeyReservations.actorId} = ${params.actorId} AND
    ${pwWriteKeyReservations.commandKey} = ${key}`);
  if (reservation) {
    const [existing] = await tx.select().from(pwWriteIntents)
      .where(eq(pwWriteIntents.intentId, reservation.intentId));
    if (!existing) throw new FacetError(409, "command_context_unresolved");
    const requestContext = (binding: PwIntentBinding, command: unknown) => pwDigest({
      principal: binding.principal, pageSessionId: binding.pageSessionId,
      pageInstanceId: binding.pageInstanceId, artifactRef: binding.artifactRef,
      operationDigest: binding.operationDigest, expectedProjectionToken: binding.expectedProjectionToken,
      command: command && typeof command === "object"
        ? Object.fromEntries(Object.entries(command).filter(([key]) => key !== "expiresAtMs")) : command,
    });
    if (reservation.operationDigest !== params.binding.operationDigest
      || requestContext(params.binding, params.command) !== requestContext({
        ...params.binding, principal: existing.principal as PwIntentBinding["principal"],
        pageSessionId: existing.pageSessionId, pageInstanceId: existing.pageInstanceId,
        artifactRef: existing.artifactRef as Record<string, unknown>,
        expectedProjectionToken: existing.expectedProjectionToken,
      }, existing.command)) {
      throw new FacetError(409, "idempotency_key_conflict");
    }
    return existing;
  }
  const [actor] = await tx.select({ sub: accountUsers.sub }).from(accountUsers)
    .where(eq(accountUsers.id, params.actorId));
  if (actor?.sub !== params.binding.principal.sub) {
    throw new PwWriteError(403, "confirmation_identity_mismatch");
  }
  assertSignalWriteInput(params.command);
  if (signalWriteOperationDigest(params.command) !== params.binding.operationDigest
    || params.operation !== params.command.operation
    || params.workspaceId.toLowerCase() !== params.command.workspaceId.toLowerCase()
    || params.citySlug !== params.command.target.citySlug
    || pwDigest(params.target) !== pwDigest(params.command.target)
    || pwDigest(params.artifactRef) !== pwDigest(params.binding.artifactRef)
    || params.command.expectedProjectionToken !== params.binding.expectedProjectionToken
    || params.command.expiresAtMs !== params.binding.expiresAtMs) {
    throw new FacetError(400, "invalid_facet_command");
  }
  const digest = pwIntentDigest(params.binding, params.command);
  const [row] = await tx.insert(pwWriteIntents).values({
    intentId: params.binding.intentId.toLowerCase(),
    invocationId: params.binding.invocationId.toLowerCase(),
    operation: params.operation,
    workspaceId: params.workspaceId.toLowerCase(),
    actorId: params.actorId,
    principal: params.binding.principal,
    artifactRef: params.binding.artifactRef,
    authorityReferences: params.binding.authorityReferences,
    challengeKeyId: params.binding.challengeKeyId,
    challengeId: newPwIntentIds().challengeId,
    pageSessionId: params.binding.pageSessionId,
    pageInstanceId: params.binding.pageInstanceId,
    grantReference: params.binding.grantReference,
    citySlug: params.citySlug,
    target: params.target as Record<string, unknown>,
    command: params.command,
    operationDigest: params.binding.operationDigest,
    intentDigest: digest,
    commandKey: key,
    expectedProjectionToken: params.binding.expectedProjectionToken,
    expiresAt: new Date(params.binding.expiresAtMs),
  }).returning();
  if (!row) throw new PwWriteError(503, "write_fence_unavailable");
  await tx.insert(pwWriteKeyReservations).values({
    actorId: params.actorId, commandKey: key, intentId: row.intentId,
    operationDigest: params.binding.operationDigest,
    expiresAt: new Date(params.binding.expiresAtMs),
  });
  return row;
}

/** Exclusive intent lock shared by confirm and revoke serialization. */
export async function loadPwIntentForUpdate(tx: WriteTx, intentId: string): Promise<PwIntentRow> {
  const [row] = await tx.select().from(pwWriteIntents)
    .where(eq(pwWriteIntents.intentId, intentId.toLowerCase())).for("update");
  if (!row) throw new FacetError(404, "write_intent_not_found");
  return row;
}

/** Shared intent lock for status consultation without writer effects. */
export async function loadPwIntentForShare(tx: WriteTx, intentId: string): Promise<PwIntentRow> {
  const [row] = await tx.select().from(pwWriteIntents)
    .where(eq(pwWriteIntents.intentId, intentId.toLowerCase())).for("share");
  if (!row) throw new FacetError(404, "write_intent_not_found");
  return row;
}

/** Single receipt link per intent; a second link is never created. */
export async function linkPwReceipt(tx: WriteTx, link: {
  intentId: string; ownerId: string; commandKey: string; workspaceId: string;
}): Promise<void> {
  await tx.insert(pwWriteReceiptLinks).values({
    intentId: link.intentId.toLowerCase(), ownerId: link.ownerId,
    commandKey: link.commandKey.toLowerCase(),
    workspaceId: link.workspaceId.toLowerCase(),
  }).onConflictDoNothing();
  const existing = await readPwReceiptLink(tx, link.intentId);
  if (!existing || existing.ownerId !== link.ownerId.toLowerCase()
    || existing.commandKey !== link.commandKey.toLowerCase()
    || existing.workspaceId !== link.workspaceId.toLowerCase()) {
    throw new FacetError(409, "command_context_unresolved");
  }
}

export async function readPwReceiptLink(tx: WriteTx, intentId: string) {
  const [row] = await tx.select().from(pwWriteReceiptLinks)
    .where(eq(pwWriteReceiptLinks.intentId, intentId.toLowerCase()));
  return row ?? null;
}

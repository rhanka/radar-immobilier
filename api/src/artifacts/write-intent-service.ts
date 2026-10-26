/**
 * PW-A idempotent preparation: one intent per actor key, same identifiers
 * and expiry on exact repeat, conflict on any divergence. Zero BASE
 * effects; delegates to the PW-D guarded store without copying it.
 */
import type { Database } from "../db/client.js";
import { writeIntentTransaction } from "./write-intent-transaction.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../services/workspaces/store.js";
import { lockWorkspace } from "../services/workspaces/mutations.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { isPersonalOperation } from "../services/facets/signal-write-operations.js";
import { newPwIntentIds } from "../services/facets/pw-write-digests.js";
import { preparePwWriteIntentInTx } from "../services/facets/pw-write-prepare.js";
import type { SignalWriteInput } from "../services/facets/signal-write-operations.js";
import { assertWritePrepareBody, assertIdempotencyKey, type WritePrepareBody } from "./write-intent-schemas.js";
import { buildWriteIntentBinding } from "./write-intent-binding.js";
import type { VerifiedWriteGrant } from "./write-grant.js";
import { assertPwAuthorityOpen } from "../services/facets/pw-write-fences.js";
import { FacetError } from "../services/facets/target.js";
import { pwIntentStatus } from "../services/facets/pw-write-fences.js";
import type { WriteIntentState } from "./write-intent-schemas.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";

export interface PrepareDeps {
  challengeKeyId: string;
  confirmationBaseUrl: string;
  managementBaseUrl: string;
  statusBaseUrl: string;
  nowMs?: (() => number) | undefined;
  authorityReferences?: Record<string, string>;
  authorityExpiresAtMs?: number;
}

export interface PrepareResult {
  intentId: string;
  invocationId: string;
  state: WriteIntentState;
  created: boolean;
  expiresAt: string;
  confirmationUrl: string;
  managementUrl: string;
  statusUrl: string;
}

function toSignalInput(body: WritePrepareBody, commandKey: string, expiresAtMs: number): SignalWriteInput {
  return {
    operation: body.operation as SignalWriteInput["operation"],
    workspaceId: body.workspaceId,
    target: body.target as SignalWriteInput["target"],
    ...(body.basket === undefined ? {} : { basket: body.basket as SignalWriteInput["basket"] }),
    ...(body.reasonCode === undefined ? {} : { reasonCode: body.reasonCode }),
    ...(body.deselect === undefined ? {} : { deselect: [...body.deselect].sort() }),
    expectedHeadId: body.expectedHeadId,
    ...(body.expectedSelectionHeads === undefined ? {}
      : { expectedSelectionHeads: body.expectedSelectionHeads as SignalWriteInput["expectedSelectionHeads"] }),
    displayedFingerprint: body.displayedFingerprint,
    expectedProjectionToken: body.expectedProjectionToken,
    commandKey,
    expiresAtMs,
  };
}

/** Validate, bind, and persist the intent; never returns a challenge token. */
export async function prepareWriteIntent(
  db: Database,
  grant: VerifiedWriteGrant,
  rawBody: unknown,
  commandKey: string,
  pageInstanceId: string,
  deps: PrepareDeps,
): Promise<PrepareResult> {
  assertWritePrepareBody(rawBody);
  assertIdempotencyKey(commandKey);
  commandKey = commandKey.toLowerCase();
  const body = rawBody as WritePrepareBody;
  if (body.workspaceId.toLowerCase() !== grant.workspaceId.toLowerCase()
    || body.target.citySlug !== grant.citySlug
    || !(grant.operations as readonly string[]).includes(body.operation)) {
    throw new FacetError(403, "delegated_scope_refused");
  }
  const now = (deps.nowMs ?? Date.now)();
  const expiresAtMs = Math.min(now + 120_000, grant.expiresAtMs, deps.authorityExpiresAtMs ?? Infinity);
  if (!(expiresAtMs > now)) {
    throw new FacetError(401, "write_grant_expired");
  }
  if (!deps.authorityReferences) throw new PwWriteError(503, "write_authority_unavailable");
  const ids = newPwIntentIds();
  const binding = buildWriteIntentBinding({
    grant, body, commandKey, intentId: ids.intentId,
    invocationId: ids.invocationId, pageInstanceId,
    expiresAtMs, challengeKeyId: deps.challengeKeyId,
    authorityReferences: deps.authorityReferences,
  });
  const command = toSignalInput(body, commandKey, expiresAtMs);
  const stored = await writeIntentTransaction(db, async (tx) => {
    // Bound waits just like admission; do not prepare after an authority wait expires.
    await assertPwAuthorityOpen(tx, binding.authorityReferences);
    if ((deps.nowMs ?? Date.now)() >= expiresAtMs) throw new FacetError(401, "write_grant_expired");
    await lockWorkspace(tx, body.workspaceId);
    const actorId = await approvedAccountId(tx, grant.readerSub, true);
    const access = await resolveWorkspaceAccess(tx, body.workspaceId, grant.readerSub);
    if (!isPersonalOperation(body.operation) && !access.moderateArchive) {
      throw new WorkspaceError(403, "workspace_capability_required");
    }
    const intent = await preparePwWriteIntentInTx(tx, {
      operation: body.operation,
      workspaceId: body.workspaceId,
      actorId,
      binding,
      artifactRef: binding.artifactRef,
      citySlug: body.target.citySlug,
      target: body.target,
      command,
    });
    if ((deps.nowMs ?? Date.now)() >= expiresAtMs) throw new FacetError(401, "write_grant_expired");
    return intent;
  });
  return {
    intentId: stored.intentId,
    invocationId: stored.invocationId,
    state: pwIntentStatus(stored, (deps.nowMs ?? Date.now)()),
    created: stored.intentId === ids.intentId,
    expiresAt: stored.expiresAt.toISOString(),
    confirmationUrl: `${deps.confirmationBaseUrl}/${stored.intentId}`,
    managementUrl: `${deps.managementBaseUrl}/${stored.intentId}`,
    statusUrl: `${deps.statusBaseUrl}/${stored.intentId}`,
  };
}

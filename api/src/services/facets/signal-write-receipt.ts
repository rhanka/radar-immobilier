/**
 * PW-B receipt consultation and refusal codes: read a committed receipt
 * after current rights, without comparing a moved 6L1 token and without
 * calling any writer. Never invents content.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { facetCommandContexts, facetCommands } from "../../db/schema.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { scopedEpochFor } from "./activation.js";
import { requireScopedEpoch, ScopeError } from "./scope.js";
import { FacetError } from "./target.js";
import { WorkspaceError } from "../workspaces/types.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { readScopeTokenInTx } from "./signal-write-scope.js";
import { Reason } from "./classification-contracts.js";

const ReceiptEvent = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime({ offset: true }),
  scope: z.enum(["personal", "workspace"]), facet: z.enum(["selection", "archive"]),
  basket: z.enum(["pertinent", "a_surveiller"]).nullable(),
  state: z.enum(["active", "inactive"]), reason: Reason.nullable(),
  observedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine((event) => {
  if (event.facet === "selection" && (event.scope !== "personal" || event.basket === null)) return false;
  if (event.facet === "archive" && event.basket !== null) return false;
  if (event.state === "inactive" && event.reason !== null) return false;
  if (event.facet === "archive" && event.state === "active" && event.reason === null) return false;
  return event.reason === null || event.reason.verdict === (event.facet === "archive" ? "non_pertinent" : event.basket);
});
export type SignalWriteEvent = z.infer<typeof ReceiptEvent>;

/** Strict immutable PW projection; never expose owner, actor, or command context. */
export function projectSignalWriteEvent(value: unknown): SignalWriteEvent | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new FacetError(409, "command_context_unresolved");
  const event = value as Record<string, unknown>;
  const projected = ReceiptEvent.safeParse({ id: event.id, createdAt: event.createdAt,
    scope: event.scope, facet: event.facet, basket: event.basket, state: event.state,
    observedFingerprint: event.observedFingerprint,
    reason: event.reasonCode === null ? null
      : { profileId: event.profileId, code: event.reasonCode, verdict: event.verdict },
  });
  if (!projected.success) throw new FacetError(409, "command_context_unresolved");
  return projected.data;
}

export interface WriteRefusal {
  status: number;
  code: string;
  retryable: boolean;
}

/** Committed receipt by idempotency key; masks content when rights lapsed. */
export async function readCommittedSignalReceipt(
  db: Database, sub: string, workspaceId: string, commandKey: string,
): Promise<SignalWriteEvent | null> {
  return db.transaction(async (tx) => {
  await lockWorkspace(tx, workspaceId);
  const key = commandKey.toLowerCase();
  const accountId = await approvedAccountId(tx, sub, true);
  await resolveWorkspaceAccess(tx, workspaceId, sub);
  requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
  const [contextRow] = await tx.select().from(facetCommandContexts).where(sql`
    ${facetCommandContexts.ownerId} = ${accountId} AND ${facetCommandContexts.commandKey} = ${key}`);
  const [receiptRow] = await tx.select().from(facetCommands).where(sql`
    ${facetCommands.ownerId} = ${accountId} AND ${facetCommands.commandKey} = ${key}`);
  if (!receiptRow) throw new FacetError(404, "write_intent_not_found");
  if (!contextRow || contextRow.status !== "resolved" || contextRow.commandDigest !== receiptRow.commandDigest) {
    throw new FacetError(409, "command_context_unresolved");
  }
  if (contextRow.workspaceId !== workspaceId.toLowerCase()) {
    throw new FacetError(409, "idempotency_key_conflict");
  }
  const result = receiptRow.result as { event?: unknown; context?: { workspaceId?: string; target?: { citySlug?: string } } };
  const city = result.context?.target?.citySlug;
  if (!city || result.context?.workspaceId?.toLowerCase() !== workspaceId.toLowerCase()
    || !Object.hasOwn(result, "event")) throw new FacetError(409, "command_context_unresolved");
  await readScopeTokenInTx(tx, sub, workspaceId, city);
  return projectSignalWriteEvent(result.event);
  });
}

/** Map a BASE refusal to its PW section 7.7 code; unknown stays masked. */
export function toWriteRefusal(error: unknown): WriteRefusal {
  const message = error instanceof Error ? error.message : "";
  const typed = error instanceof FacetError || error instanceof WorkspaceError || error instanceof ScopeError;
  if (!typed) return { status: 500, code: "internal_error", retryable: false };
  if (message.startsWith("scoped_facet_scope_unavailable:")) {
    return { status: 503, code: "signal_capability_unavailable", retryable: false };
  }
  const table: Record<string, WriteRefusal> = {
    invalid_facet_command: { status: 400, code: "invalid_facet_command", retryable: false },
    facet_head_conflict: { status: 409, code: "facet_head_conflict", retryable: false },
    target_version_conflict: { status: 409, code: "facet_target_version_conflict", retryable: false },
    projection_revision_conflict: { status: 409, code: "projection_revision_conflict", retryable: false },
    workspace_revision_conflict: { status: 409, code: "workspace_revision_conflict", retryable: false },
    personal_history_unresolved: { status: 409, code: "personal_history_unresolved", retryable: false },
    command_context_unresolved: { status: 409, code: "command_context_unresolved", retryable: false },
    idempotency_key_conflict: { status: 409, code: "idempotency_key_conflict", retryable: false },
    projection_revision_unstable: { status: 503, code: "projection_revision_unstable", retryable: true },
    signal_not_found: { status: 404, code: "target_not_found", retryable: false },
    workspace_not_found: { status: 403, code: "workspace_not_authorized", retryable: false },
    workspace_membership_required: { status: 403, code: "workspace_not_authorized", retryable: false },
    account_not_approved: { status: 403, code: "account_not_approved", retryable: false },
    workspace_capability_required: { status: 403, code: "capability_required", retryable: false },
    capability_required: { status: 403, code: "capability_required", retryable: false },
    challenge_expired: { status: 409, code: "challenge_expired", retryable: false },
    challenge_consumed: { status: 409, code: "challenge_consumed", retryable: false },
    write_authority_unavailable: { status: 503, code: "write_authority_unavailable", retryable: false },
    write_fence_unavailable: { status: 503, code: "write_fence_unavailable", retryable: false },
    write_audit_unavailable: { status: 503, code: "write_audit_unavailable", retryable: false },
    write_intent_not_found: { status: 404, code: "write_intent_not_found", retryable: false },
    invalid_reason_code: { status: 422, code: "invalid_reason_code", retryable: false },
    reason_code_required: { status: 422, code: "reason_code_required", retryable: false },
    basket_required: { status: 422, code: "basket_required", retryable: false },
  };
  const known = table[message];
  if (known !== undefined) return known;
  return { status: 500, code: "internal_error", retryable: false };
}

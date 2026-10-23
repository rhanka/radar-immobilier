/**
 * 6J lot writer: four independent facets on one stable target.
 *
 * Order (§3.2): actor approval, workspace membership and D4 capabilities,
 * closed-gate check, scoped epoch, actor/key lock, receipt recovery,
 * canonical-target serialization, source-version comparison, expected-head
 * comparison against the SQL head registry, then one atomic append of the
 * transition, its stream binding, the terminal registration, and the
 * receipt with its command context. Selection, pipeline, or market changes
 * never restore an archive; archive/restoration preserves the other facets
 * unless an authorized deselection was requested.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetCommandContexts,
  facetCommands,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId } from "../../workspaces/store.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { digest, FacetError } from "../target.js";
import {
  lotCommandDigest,
  type LotCommand,
  type LotScope,
} from "./lot-commands.js";
import {
  LotVersionConflictError,
  resolveLotSource,
  type LotTarget,
} from "./lot-target.js";
import { lotTargetLock } from "./lot-streams.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireOpenLotDestination } from "./lot-gate.js";
import { assertCutoverTargetReady } from "./lot-cutover-target.js";
import { authorizeLotMutation, validateLotMutationShape } from "./lot-authorize.js";
import { lotEventResponse } from "./lot-response.js";
import { appendLotTransition } from "./lot-apply.js";
import {
  lotConflictHeads,
  planLotStreams,
} from "./lot-transition.js";

export interface LotWriteResult {
  target: LotTarget;
  mode: LotCommand["mode"];
  events: ReturnType<typeof lotEventResponse>[];
  heads: ReturnType<typeof lotEventResponse>[];
}

export type { LotTx } from "./lot-types.js";

export async function writeLotFacet(
  db: Database, sub: string, workspaceId: string, scope: LotScope, command: LotCommand,
  internal: { allowImportProvenance?: boolean } = {},
): Promise<LotWriteResult> {
  validateLotMutationShape(scope, command.mutation);
  if (command.expected_head_id === undefined || command.displayed_version === undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  const key = command.command_key.toLowerCase();
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const actorId = await approvedAccountId(tx, sub, true);
    const rights = await resolveLotRights(tx, workspaceId, sub);
    const destination = await requireOpenLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    authorizeLotMutation(rights, scope, command.mutation, destination.selectionBasket);
    await assertCutoverTargetReady(tx as unknown as Database, workspaceId, command.mode, command.target);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", actorId, key])}, 0))`);
    const base = lotCommandDigest(scope, "single", workspaceId, { ...command, command_key: key });
    const commandDigest = digest({ scope, workspaceId: workspaceId.toLowerCase(), command: base });
    const [contextRow] = await tx.select().from(facetCommandContexts).where(sql`
      ${facetCommandContexts.ownerId} = ${actorId} AND ${facetCommandContexts.commandKey} = ${key}`);
    const [receiptRow] = await tx.select().from(facetCommands).where(sql`
      ${facetCommands.ownerId} = ${actorId} AND ${facetCommands.commandKey} = ${key}`);
    if (receiptRow && (!contextRow || contextRow.status !== "resolved")) {
      throw new FacetError(409, "command_context_unresolved");
    }
    if (contextRow && contextRow.workspaceId !== workspaceId.toLowerCase()) {
      throw new FacetError(409, "idempotency_key_conflict");
    }
    if (receiptRow) {
      const stored = receiptRow.result as { result?: LotWriteResult; context?: unknown };
      if (!stored.result || !Array.isArray(stored.result.events)
        || !Array.isArray(stored.result.heads) || stored.context === undefined) {
        throw new FacetError(409, "command_context_unresolved");
      }
      if (receiptRow.commandDigest !== commandDigest) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      return stored.result;
    }
    await lotTargetLock(tx, command.target);
    const resolved = await resolveLotSource(tx, command.target);
    if (resolved.row.id !== command.displayed_version.lot_version_id
      || resolved.fingerprint !== command.displayed_version.fingerprint) {
      throw new LotVersionConflictError({
        target: command.target,
        version: resolved.displayed,
        heads: await lotConflictHeads(tx, workspaceId, scope,
          scope === "workspace" ? null : actorId, command.mode, command.target),
      });
    }
    const plan = await planLotStreams(tx, workspaceId, scope, actorId, command, command.target);
    const outcome = await appendLotTransition(tx, workspaceId, scope, actorId,
      command, command.target, plan, resolved.fingerprint, commandDigest, internal);
    const result: LotWriteResult = {
      target: command.target,
      mode: command.mode,
      events: outcome.appended.map((event) => lotEventResponse(event)),
      heads: outcome.heads.map((event) => lotEventResponse(event)),
    };
    const context = {
      scope, mode: command.mode, target: command.target,
      facet: plan.facet, basket: plan.basket,
      expectedHeadId: command.expected_head_id,
      displayedVersion: command.displayed_version,
      workspaceId,
    };
    const [stored] = await tx.insert(facetCommands).values({
      ownerId: actorId, commandKey: key, commandDigest, result: { result, context },
    }).returning({ result: facetCommands.result });
    await tx.insert(facetCommandContexts).values({
      ownerId: actorId, commandKey: key, workspaceId,
      status: "resolved", commandDigest,
    }).onConflictDoNothing();
    return (stored!.result as { result: LotWriteResult }).result;
  });
}

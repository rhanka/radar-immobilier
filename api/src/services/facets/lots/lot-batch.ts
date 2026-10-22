/**
 * 6J atomic lot batch.
 *
 * Between 1 and 500 explicitly identified targets in one workspace, one
 * route scope, and one mode. Every item supplies its own displayed version
 * and expected heads; all items and permissions validate before any
 * mutation. Target and stream locks are acquired in deterministic order;
 * one transaction commits every transition plus the batch receipt, so any
 * authorization, validation, version, or head failure rolls everything
 * back. Missing metadata is an error; no target is silently skipped.
 * Exact retry returns the recorded result; a reused key with different
 * items, expectations, values, or scope conflicts.
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
  LotVersionConflictError,
  resolveLotSource,
} from "./lot-target.js";
import { lotTargetLock } from "./lot-streams.js";
import {
  lotCommandDigest,
  type LotBatchCommand,
  type LotBatchItemResult,
  type LotBatchResult,
  type LotCommand,
  type LotScope,
} from "./lot-commands.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireLotDestination } from "./lot-gate.js";
import { authorizeLotMutation, validateLotMutationShape } from "./lot-authorize.js";
import { appendLotTransition } from "./lot-apply.js";
import type { LotPlan } from "./lot-plan.js";
import {
  lotConflictHeads,
  planLotStreams,
} from "./lot-transition.js";
import { lotEventResponse } from "./lot-response.js";

interface PreparedItem {
  key: string;
  itemCommand: LotCommand;
  resolvedFingerprint: string;
  plan: LotPlan;
}

export async function writeLotBatch(
  db: Database, sub: string, workspaceId: string, scope: LotScope, batch: LotBatchCommand,
): Promise<LotBatchResult> {
  if (!Array.isArray(batch.items) || batch.items.length < 1 || batch.items.length > 500) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (batch.mode !== "real" && batch.mode !== "simulation") {
    throw new FacetError(400, "invalid_facet_command");
  }
  const seen = new Set<string>();
  for (const item of batch.items) {
    const key = JSON.stringify([item.target.citySlug, item.target.canonicalId]);
    if (seen.has(key)) throw new FacetError(400, "invalid_facet_command");
    seen.add(key);
    if (item.expected_head_id === undefined || item.displayed_version === undefined) {
      throw new FacetError(400, "invalid_facet_command");
    }
  }
  const key = batch.command_key.toLowerCase();
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const actorId = await approvedAccountId(tx, sub, true);
    const rights = await resolveLotRights(tx, workspaceId, sub);
    const destination = await requireLotDestination(tx, workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    for (const item of batch.items) {
      validateLotMutationShape(scope, item.mutation);
    }
    for (const item of batch.items) {
      authorizeLotMutation(rights, scope, item.mutation, destination.selectionBasket);
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", actorId, key])}, 0))`);
    const base = lotCommandDigest(scope, "batch", workspaceId, { ...batch, command_key: key });
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
      const stored = receiptRow.result as { batch?: LotBatchResult; context?: unknown };
      if (stored.batch === undefined || stored.context === undefined) {
        throw new FacetError(409, "command_context_unresolved");
      }
      if (receiptRow.commandDigest !== commandDigest) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      return stored.batch;
    }
    const ordered = [...batch.items].sort((left, right) =>
      JSON.stringify([left.target.citySlug, left.target.canonicalId])
      < JSON.stringify([right.target.citySlug, right.target.canonicalId]) ? -1 : 1);
    const prepared: PreparedItem[] = [];
    for (const item of ordered) {
      await lotTargetLock(tx, item.target);
    }
    for (const item of ordered) {
      const itemCommand: LotCommand = {
        contract_version: "lot-facets-v1",
        command_key: key,
        mode: batch.mode,
        target: item.target,
        displayed_version: item.displayed_version,
        expected_head_id: item.expected_head_id,
        mutation: item.mutation,
      };
      const resolved = await resolveLotSource(tx, item.target);
      if (resolved.row.id !== item.displayed_version.lot_version_id
        || resolved.fingerprint !== item.displayed_version.fingerprint) {
        throw new LotVersionConflictError({
          target: item.target,
          version: resolved.displayed,
          heads: await lotConflictHeads(tx, workspaceId, scope,
            scope === "workspace" ? null : actorId, batch.mode, item.target),
        });
      }
      const plan = await planLotStreams(tx, workspaceId, scope, actorId, itemCommand, item.target);
      prepared.push({
        key: JSON.stringify([item.target.citySlug, item.target.canonicalId]),
        itemCommand,
        resolvedFingerprint: resolved.fingerprint,
        plan,
      });
    }
    const items: LotBatchItemResult[] = [];
    let eventsAppended = 0;
    for (const entry of prepared) {
      const before = entry.plan.main.current?.id ?? null;
      const appended = await appendLotTransition(tx, workspaceId, scope, actorId,
        entry.itemCommand, entry.itemCommand.target, entry.plan,
        entry.resolvedFingerprint, commandDigest, {});
      const snapshot = appended ? lotEventResponse(appended)
        : entry.plan.main.current ? lotEventResponse(entry.plan.main.current) : null;
      if (appended && appended.id !== before) {
        eventsAppended += 1 + entry.plan.removals.filter((removal) => removal.current?.state === "active").length;
      }
      items.push({ target: entry.itemCommand.target, event: snapshot, appended: appended !== null && appended.id !== before });
    }
    const changed = items.filter((item) => item.appended).length;
    const result: LotBatchResult = {
      targets: items.length,
      changed,
      unchanged: items.length - changed,
      eventsAppended,
      items,
    };
    await tx.insert(facetCommands).values({
      ownerId: actorId, commandKey: key, commandDigest, result: { batch: result, context: { scope, mode: batch.mode, workspaceId } },
    });
    await tx.insert(facetCommandContexts).values({
      ownerId: actorId, commandKey: key, workspaceId,
      status: "resolved", commandDigest,
    }).onConflictDoNothing();
    return result;
  });
}

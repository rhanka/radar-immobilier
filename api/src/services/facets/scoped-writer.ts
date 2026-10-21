/**
 * 6H scoped personal writer: the 6A/6B contract evaluated in one workspace.
 *
 * Order: actor approval, workspace membership, idempotency recovery, target
 * locks, stream locks, displayed-version comparison, expected-head
 * comparison against the SQL head registry, then one atomic append of every
 * transition, its stream binding, the terminal registration, and the receipt
 * with its command context. Composite discard compares and retires every
 * requested selection. Old writers cannot commit here: the deferred SQL
 * check rejects unbound events once the epoch is scoped.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetCommandContexts,
  facetCommands,
  facetEvents,
  facetEventBindings,
  facetStreams,
} from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { facetCommandDigest, historicalCommandDigest, readCommand } from "./commands.js";
import { facetEventResponse } from "./response.js";
import {
  FacetError,
  FacetHeadConflictError,
  FacetTargetVersionConflictError,
  resolveTarget,
} from "./target.js";
import { lockCityGraph } from "../graph/graph-store.js";
import { requireScopedEpoch } from "./scope.js";
import { digest } from "./target.js";
import { scopedEpochFor } from "./activation.js";
import { resolveStream, type StreamRef } from "./scoped-reader.js";
import { appendScopedTransition, assertScopedExpectations } from "./scoped-transition.js";
import type { Basket, FacetCommand } from "./writer.js";

/** Pre-6B payload: no displayed fingerprint, recovery only, never a new command. */
export type HistoricalScopedCommand = Omit<FacetCommand, "expectedHeadId" | "displayedFingerprint"> & {
  expectedHeadId?: string | null;
  displayedFingerprint?: never;
};

export async function writeScopedPersonalFacet(
  db: Database, sub: string, workspaceId: string, command: FacetCommand | HistoricalScopedCommand,
) {
  if (command.displayedFingerprint === undefined) {
    return recoverScopedHistoricalFacet(db, sub, workspaceId, command);
  }
  if (command.expectedHeadId === undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  const key = command.commandKey.toLowerCase();
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const unresolved = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(sql`${facetEvents.ownerId} = ${accountId} AND ${facetEventBindings.eventId} IS NULL`).limit(1);
    if (unresolved.length > 0) throw new FacetError(409, "personal_history_unresolved");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", accountId, key])}, 0))`);
    const originalDigest = facetCommandDigest({ ...command, commandKey: key });
    let commandDigest = digest({ workspaceId: workspaceId.toLowerCase(), command: originalDigest });
    const [contextRow] = await tx.select().from(facetCommandContexts).where(sql`
      ${facetCommandContexts.ownerId} = ${accountId} AND ${facetCommandContexts.commandKey} = ${key}`);
    const [receiptRow] = await tx.select().from(facetCommands).where(sql`
      ${facetCommands.ownerId} = ${accountId} AND ${facetCommands.commandKey} = ${key}`);
    if (receiptRow && (!contextRow || contextRow.status !== "resolved")) {
      throw new FacetError(409, "command_context_unresolved");
    }
    if (contextRow && contextRow.workspaceId !== workspaceId.toLowerCase()) {
      throw new FacetError(409, "idempotency_key_conflict");
    }
    if (contextRow?.commandDigest === originalDigest) commandDigest = originalDigest;
    const replay = await readCommand(tx, accountId, key, commandDigest);
    if (replay !== undefined) return replay;
    await lockCityGraph(tx, command.target.citySlug);
    const fingerprint = await resolveTarget(tx, command.target);
    if (fingerprint !== command.displayedFingerprint) {
      throw new FacetTargetVersionConflictError({
        target: command.target, version: { fingerprint }, heads: [],
      });
    }
    const selection = command.action === "select" || command.action === "deselect";
    const facet = selection ? "selection" : "archive";
    const basket = selection ? command.basket ?? null : null;
    const removals = command.action === "discard" ? [...new Set(command.deselect ?? [])] : [];
    assertScopedExpectations(command, removals);
    const main = await resolveStream(tx, workspaceId, accountId, command.target, facet, basket);
    const removed = new Map<Basket, StreamRef>();
    for (const entry of [...new Set(removals)].sort()) {
      removed.set(entry, await resolveStream(tx, workspaceId, accountId,
        command.target, "selection", entry));
    }
    const expected = command.expectedSelectionHeads ?? {};
    const conflicted = (main.headEventId ?? null) !== command.expectedHeadId
      || [...removed.entries()].some(([entry, ref]) =>
        (ref.headEventId ?? null) !== ((expected as Record<string, string | null>)[entry] ?? null));
    if (conflicted) {
      const heads = [];
      for (const ref of [main, ...removed.values()]) {
        if (ref.headEventId === null) continue;
        const [event] = await tx.select().from(facetEvents)
          .where(eq(facetEvents.id, ref.headEventId));
        if (event) heads.push(facetEventResponse(event));
      }
      throw new FacetHeadConflictError({ target: command.target, version: null, heads });
    }
    if (command.action === "discard" && command.reasonCode === undefined) {
      throw new FacetError(422, "reason_code_required");
    }
    if (command.action === "select" && basket === null) {
      throw new FacetError(422, "basket_required");
    }
    const active = command.action === "select" || command.action === "discard";
    const streamId = main.id === "" ? (await tx.insert(facetStreams).values({
      workspaceId, scope: "personal", ownerId: accountId, targetType: "signal",
      citySlug: command.target.citySlug, nodeType: command.target.type,
      nodeId: command.target.id, facet, basket,
    }).returning())[0]!.id : main.id;
    const event = await appendScopedTransition(tx, accountId, command, streamId,
      facet, basket, active ? "active" : "inactive", fingerprint);
    for (const [entry, ref] of removed) {
      const targetId = ref.id === "" ? (await tx.insert(facetStreams).values({
        workspaceId, scope: "personal", ownerId: accountId, targetType: "signal",
        citySlug: command.target.citySlug, nodeType: command.target.type,
        nodeId: command.target.id, facet: "selection", basket: entry,
      }).returning())[0]!.id : ref.id;
      await appendScopedTransition(tx, accountId, command, targetId,
        "selection", entry, "inactive", fingerprint);
    }
    const result = event ? { ...event, createdAt: event.createdAt.toISOString() } : null;
    const context = { target: command.target, facet, basket,
      expectedHeadId: command.expectedHeadId,
      expectedSelectionHeads: command.expectedSelectionHeads ?? null,
      displayedFingerprint: command.displayedFingerprint, workspaceId };
    await tx.insert(facetCommands).values({ ownerId: accountId, commandKey: key,
      commandDigest, result: { event: result, context } });
    await tx.insert(facetCommandContexts).values({
      ownerId: accountId, commandKey: key, workspaceId, status: "resolved", commandDigest,
    }).onConflictDoNothing();
    return result;
  });
}

/**
 * Exact recovery of a pre-6B receipt (pre-6A or 6A, no displayed
 * fingerprint). The receipt and its qualified context are returned
 * byte-identical; a missing receipt never falls through to a mutation.
 */
async function recoverScopedHistoricalFacet(
  db: Database, sub: string, workspaceId: string, command: HistoricalScopedCommand,
) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    await resolveWorkspaceAccess(tx, workspaceId, sub);
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const unresolved = await tx.select({ id: facetEvents.id }).from(facetEvents)
      .leftJoin(facetEventBindings, eq(facetEventBindings.eventId, facetEvents.id))
      .where(sql`${facetEvents.ownerId} = ${accountId} AND ${facetEventBindings.eventId} IS NULL`).limit(1);
    if (unresolved.length > 0) throw new FacetError(409, "personal_history_unresolved");
    const key = command.commandKey.toLowerCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", accountId, key])}, 0))`);
    const commandDigest = historicalCommandDigest({ ...command, commandKey: key });
    const [contextRow] = await tx.select().from(facetCommandContexts).where(sql`
      ${facetCommandContexts.ownerId} = ${accountId} AND ${facetCommandContexts.commandKey} = ${key}`);
    const [receiptRow] = await tx.select().from(facetCommands).where(sql`
      ${facetCommands.ownerId} = ${accountId} AND ${facetCommands.commandKey} = ${key}`);
    if (receiptRow && (!contextRow || contextRow.status !== "resolved")) {
      throw new FacetError(409, "command_context_unresolved");
    }
    if (contextRow && contextRow.workspaceId !== workspaceId.toLowerCase()) {
      throw new FacetError(409, "idempotency_key_conflict");
    }
    const replay = await readCommand(tx, accountId, key, commandDigest);
    if (replay === undefined) throw new FacetError(400, "invalid_facet_command");
    return replay;
  });
}

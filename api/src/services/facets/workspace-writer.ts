/**
 * 6I workspace archive writer: moderator-only common discard/restoration.
 *
 * Order: actor approval, workspace membership with the moderation
 * capability, idempotency recovery, target locks, workspace stream lock,
 * displayed-version comparison, expected-head comparison against the SQL
 * head registry, then one atomic append of the transition, its stream
 * binding, the terminal registration, and the receipt with its command
 * context. Personal writers never touch workspace streams, so a personal
 * restore can never lift a workspace archive. Receipt identity is the
 * authenticated actor plus the idempotency key; the business owner stays
 * null.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  facetCommandContexts,
  facetCommands,
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetReasonCodes,
  facetStreams,
} from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { WorkspaceError } from "../workspaces/types.js";
import { facetCommandDigest, readCommand } from "./commands.js";
import { facetEventResponse } from "./response.js";
import {
  digest,
  FacetError,
  FacetHeadConflictError,
  FacetTargetVersionConflictError,
  resolveTarget,
  type SignalTarget,
} from "./target.js";
import { lockCityGraph } from "../graph/graph-store.js";
import { requireScopedEpoch } from "./scope.js";
import { scopedEpochFor } from "./activation.js";
import { FACET_PROFILE } from "./codebook.js";
import { resolveWorkspaceStream } from "./workspace-streams.js";

export interface WorkspaceArchiveCommand {
  action: "discard" | "restore";
  target: SignalTarget;
  reasonCode?: string | undefined;
  expectedHeadId: string | null;
  displayedFingerprint: string;
  commandKey: string;
}

type WorkspaceTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function writeWorkspaceArchiveFacet(
  db: Database, sub: string, workspaceId: string, command: WorkspaceArchiveCommand,
) {
  if (command.action !== "discard" && command.action !== "restore") {
    throw new FacetError(400, "invalid_facet_command");
  }
  if ((command as { basket?: unknown }).basket !== undefined
    || (command as { deselect?: unknown }).deselect !== undefined
    || (command as { expectedSelectionHeads?: unknown }).expectedSelectionHeads !== undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (command.action === "restore" && command.reasonCode !== undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  if (command.action === "discard" && command.reasonCode === undefined) {
    throw new FacetError(422, "reason_code_required");
  }
  if (command.expectedHeadId === undefined || command.displayedFingerprint === undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  const key = command.commandKey.toLowerCase();
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const actorId = await approvedAccountId(tx, sub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    if (!access.moderateArchive) {
      throw new WorkspaceError(403, "workspace_capability_required");
    }
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    // Shared actor/key receipt lock with the personal writer: same-key commands
    // across families serialize here instead of colliding on the receipt key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", actorId, key])}, 0))`);
    const base = facetCommandDigest({ ...command, commandKey: key });
    const commandDigest = digest({ scope: "workspace", workspaceId: workspaceId.toLowerCase(), command: base });
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
    const replay = await readCommand(tx, actorId, key, commandDigest);
    if (replay !== undefined) return replay;
    await lockCityGraph(tx, command.target.citySlug);
    const fingerprint = await resolveTarget(tx, command.target);
    if (fingerprint !== command.displayedFingerprint) {
      throw new FacetTargetVersionConflictError({
        target: command.target, version: { fingerprint },
        heads: await workspaceConflictHeads(tx, workspaceId, command.target),
      });
    }
    const stream = await resolveWorkspaceStream(tx, workspaceId, command.target);
    if ((stream.headEventId ?? null) !== command.expectedHeadId) {
      throw new FacetHeadConflictError({
        target: command.target, version: null,
        heads: await workspaceConflictHeads(tx, workspaceId, command.target),
      });
    }
    const streamId = stream.id === "" ? (await tx.insert(facetStreams).values({
      workspaceId, scope: "workspace", ownerId: null, targetType: "signal",
      citySlug: command.target.citySlug, nodeType: command.target.type,
      nodeId: command.target.id, facet: "archive", basket: null,
    }).returning())[0]!.id : stream.id;
    const event = await appendWorkspaceTransition(tx, actorId, command,
      streamId, command.action === "discard" ? "active" : "inactive", fingerprint, base);
    const result = event ? { ...event, createdAt: event.createdAt.toISOString() } : null;
    const context = { target: command.target, facet: "archive", basket: null,
      scope: "workspace", expectedHeadId: command.expectedHeadId,
      displayedFingerprint: command.displayedFingerprint, workspaceId };
    await tx.insert(facetCommands).values({ ownerId: actorId, commandKey: key,
      commandDigest, result: { event: result, context } });
    await tx.insert(facetCommandContexts).values({
      ownerId: actorId, commandKey: key, workspaceId, status: "resolved", commandDigest,
    }).onConflictDoNothing();
    return result;
  });
}

/** Authorized conflict disclosure: the workspace head only, never personal state. */
async function workspaceConflictHeads(
  tx: WorkspaceTx, workspaceId: string, target: SignalTarget,
) {
  const stream = await resolveWorkspaceStream(tx, workspaceId, target);
  if (stream.headEventId === null) return [];
  const [event] = await tx.select().from(facetEvents)
    .where(eq(facetEvents.id, stream.headEventId));
  return event ? [facetEventResponse(event)] : [];
}

async function appendWorkspaceTransition(
  tx: WorkspaceTx, actorId: string, command: WorkspaceArchiveCommand,
  streamId: string, state: string, fingerprint: string, commandDigest: string,
) {
  const { target } = command;
  const reasonCode = state === "active" ? command.reasonCode ?? null : null;
  const [head] = await tx.select().from(facetHeads)
    .where(eq(facetHeads.streamId, streamId));
  const [current] = head
    ? await tx.select().from(facetEvents).where(eq(facetEvents.id, head.eventId))
    : [];
  if (current?.state === state && current.reasonCode === reasonCode) {
    return current;
  }
  if (!current && state === "inactive") return null;
  if (reasonCode !== null) {
    const [reason] = await tx.select().from(facetReasonCodes).where(and(
      eq(facetReasonCodes.profileId, FACET_PROFILE), eq(facetReasonCodes.code, reasonCode),
      eq(facetReasonCodes.verdict, "non_pertinent")));
    if (!reason) throw new FacetError(422, "invalid_reason_code");
  }
  const id = randomUUID();
  if (current) {
    await tx.update(facetEvents).set({ supersededBy: id }).where(eq(facetEvents.id, current.id));
  }
  const [event] = await tx.insert(facetEvents).values({
    id, scope: "workspace", ownerId: null, actorId, citySlug: target.citySlug,
    nodeType: target.type, nodeId: target.id, facet: "archive", basket: null,
    state, reasonCode, profileId: reasonCode ? FACET_PROFILE : null,
    verdict: reasonCode ? "non_pertinent" : null,
    observedFingerprint: fingerprint, commandKey: command.commandKey.toLowerCase(),
    commandDigest, supersedes: current?.id ?? null,
  }).returning();
  await tx.insert(facetEventBindings).values({ eventId: event!.id, streamId });
  if (current) {
    await tx.update(facetHeads).set({ eventId: event!.id }).where(eq(facetHeads.streamId, streamId));
  } else {
    await tx.insert(facetHeads).values({ streamId, eventId: event!.id });
  }
  return event!;
}

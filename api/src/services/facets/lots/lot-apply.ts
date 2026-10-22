/**
 * 6J atomic lot transitions.
 *
 * Appends the planned main transition plus any composite deselection
 * retirements in one transaction, with stream bindings and terminal
 * registrations. An unchanged command appends nothing and returns every
 * explicitly targeted existing head; an unchanged facet keeps its head
 * and observation without a new transition. Restoration never recreates
 * a removed selection.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetReasonCodes,
  facetStreams,
} from "../../../db/schema.js";
import { FacetError } from "../target.js";
import { normalizeAskingPrice } from "./lot-values.js";
import { FACET_PROFILE } from "../codebook.js";
import {
  LOT_IMPORT_PROFILE,
  LOT_IMPORT_UNKNOWN_REASON,
  type LotCommand,
  type LotScope,
} from "./lot-commands.js";
import type { LotTarget } from "./lot-target.js";
import type { LotPlan } from "./lot-plan.js";
import type { LotTx } from "./lot-types.js";

export interface LotImportProvenance {
  sourceAuthor: string;
  sourceCreatedAt: string;
  importRunId: string;
  sourceRowId: string | null;
  sourceChainId: string | null;
}

export interface LotAppendOutcome {
  appended: Array<typeof facetEvents.$inferSelect>;
  heads: Array<typeof facetEvents.$inferSelect>;
}

export async function appendLotTransition(
  tx: LotTx, workspaceId: string, scope: LotScope, actorId: string,
  command: LotCommand, target: LotTarget, plan: LotPlan,
  fingerprint: string, commandDigest: string,
  internal: { allowImportProvenance?: boolean; provenance?: LotImportProvenance | null },
): Promise<LotAppendOutcome> {
  const desired = plan.desired;
  if (desired.state === "active" && plan.facet === "archive") {
    await assertArchiveReason(tx, desired, internal);
  }
  const mainCurrent = plan.main.current;
  const mainUnchanged = mainCurrent !== null && sameValue(plan, mainCurrent);
  const mainNeedsWrite = !mainUnchanged
    && !(mainCurrent === null && desired.state === "inactive");
  const orderedRemovals = [...plan.removals].sort((left, right) =>
    (left.basket ?? "").localeCompare(right.basket ?? ""));
  const removalsActive = plan.removals.filter((removal) => removal.current?.state === "active");
  if (!mainNeedsWrite && removalsActive.length === 0) {
    return { appended: [],
      heads: [...(mainCurrent ? [mainCurrent] : []),
        ...orderedRemovals.flatMap((removal) => (removal.current ? [removal.current] : []))] };
  }
  let streamId = plan.main.ref.id;
  if (mainNeedsWrite && streamId === "") {
    const [stream] = await tx.insert(facetStreams).values({
      workspaceId, scope, ownerId: plan.ownerId, targetType: "lot", mode: command.mode,
      citySlug: target.citySlug, nodeType: "Lot", nodeId: target.canonicalId,
      facet: plan.facet, basket: plan.basket,
    }).returning();
    streamId = stream!.id;
  }
  const appended: Array<typeof facetEvents.$inferSelect> = [];
  const heads: Array<typeof facetEvents.$inferSelect> = [];
  if (mainNeedsWrite) {
    const event = await insertLotEvent(tx, scope, actorId, command, target, plan,
      streamId, mainCurrent, desired, fingerprint, commandDigest, internal);
    appended.push(event);
    heads.push(event);
  } else if (mainCurrent) {
    heads.push(mainCurrent);
  }
  for (const removal of orderedRemovals) {
    if (removal.current?.state !== "active") {
      if (removal.current) heads.push(removal.current);
      continue;
    }
    const removalStreamId = removal.ref.id;
    if (removalStreamId === "") continue;
    const deselected = await insertLotEvent(tx, scope, actorId, command, target,
      { ...plan, facet: "selection", basket: removal.basket },
      removalStreamId, removal.current,
      { state: "inactive", reasonCode: null, profileId: null, verdict: null,
        pipelineStatus: null, askingPrice: null, listingUrl: null },
      fingerprint, commandDigest, { allowImportProvenance: internal.allowImportProvenance ?? false });
    appended.push(deselected);
    heads.push(deselected);
  }
  return { appended, heads };
}

function sameValue(plan: LotPlan, event: typeof facetEvents.$inferSelect): boolean {
  const desired = plan.desired;
  return event.state === desired.state
    && (event.reasonCode ?? null) === desired.reasonCode
    && (event.pipelineStatus ?? null) === desired.pipelineStatus
    && normalizePrice(event.askingPrice) === normalizePrice(desired.askingPrice)
    && (event.listingUrl ?? null) === desired.listingUrl;
}

function normalizePrice(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return normalizeAskingPrice(value);
}

async function assertArchiveReason(
  tx: LotTx, desired: LotPlan["desired"],
  internal: { allowImportProvenance?: boolean },
): Promise<void> {
  if (desired.reasonCode === null || desired.reasonCode === undefined) {
    throw new FacetError(422, "reason_code_required");
  }
  if (desired.reasonCode === LOT_IMPORT_UNKNOWN_REASON) {
    if (!internal.allowImportProvenance) throw new FacetError(422, "invalid_reason_code");
    return;
  }
  const [reason] = await tx.select().from(facetReasonCodes).where(and(
    eq(facetReasonCodes.profileId, FACET_PROFILE),
    eq(facetReasonCodes.code, desired.reasonCode),
    eq(facetReasonCodes.verdict, "non_pertinent")));
  if (!reason) throw new FacetError(422, "invalid_reason_code");
}

/** Immutable source link: import projections carry it, ordinary writes never invent it. */
function importLink(
  provenance: LotImportProvenance | typeof facetEvents.$inferSelect | null | undefined,
): LotImportProvenance | null {
  if (!provenance) return null;
  if (provenance.importRunId === null || provenance.importRunId === undefined) return null;
  if (provenance.sourceAuthor === null || provenance.sourceAuthor === undefined) return null;
  const createdAt = provenance.sourceCreatedAt instanceof Date
    ? provenance.sourceCreatedAt.toISOString()
    : provenance.sourceCreatedAt;
  if (!createdAt) return null;
  return {
    sourceAuthor: provenance.sourceAuthor,
    sourceCreatedAt: createdAt,
    importRunId: provenance.importRunId,
    sourceRowId: provenance.sourceRowId ?? null,
    sourceChainId: provenance.sourceChainId ?? null,
  };
}

async function insertLotEvent(
  tx: LotTx, scope: LotScope, actorId: string, command: LotCommand, target: LotTarget,
  plan: Pick<LotPlan, "facet" | "basket" | "ownerId">, streamId: string,
  current: typeof facetEvents.$inferSelect | null,
  desired: LotPlan["desired"], fingerprint: string, commandDigest: string,
  internal: { allowImportProvenance?: boolean; provenance?: LotImportProvenance | null },
): Promise<typeof facetEvents.$inferSelect> {
  const id = randomUUID();
  if (current) {
    await tx.update(facetEvents).set({ supersededBy: id }).where(eq(facetEvents.id, current.id));
  }
  const isImportReason = desired.reasonCode === LOT_IMPORT_UNKNOWN_REASON && internal.allowImportProvenance;
  const provenance = importLink(internal.provenance
    ?? (command.mutation.action === "restore" ? current : null));
  const [event] = await tx.insert(facetEvents).values({
    id, scope, ownerId: plan.ownerId, actorId,
    targetType: "lot", citySlug: target.citySlug, nodeType: "Lot", nodeId: target.canonicalId,
    mode: command.mode, observedLotVersion: command.displayed_version.lot_version_id,
    facet: plan.facet, basket: plan.basket, state: desired.state,
    reasonCode: desired.reasonCode, profileId: isImportReason ? LOT_IMPORT_PROFILE : desired.profileId,
    verdict: desired.verdict, pipelineStatus: desired.pipelineStatus,
    askingPrice: desired.askingPrice, listingUrl: desired.listingUrl,
    sourceAuthor: provenance?.sourceAuthor ?? null,
    sourceCreatedAt: provenance?.sourceCreatedAt ? new Date(provenance.sourceCreatedAt) : null,
    importRunId: provenance?.importRunId ?? null,
    sourceRowId: provenance?.sourceRowId ?? null,
    sourceChainId: provenance?.sourceChainId ?? null,
    observedFingerprint: fingerprint,
    commandKey: command.command_key.toLowerCase(), commandDigest,
    supersedes: current?.id ?? null,
  }).returning();
  await tx.insert(facetEventBindings).values({ eventId: event!.id, streamId });
  const [head] = await tx.select().from(facetHeads).where(eq(facetHeads.streamId, streamId));
  if (current && head) {
    await tx.update(facetHeads).set({ eventId: event!.id }).where(eq(facetHeads.streamId, streamId));
  } else if (!head) {
    await tx.insert(facetHeads).values({ streamId, eventId: event!.id });
  }
  return event!;
}

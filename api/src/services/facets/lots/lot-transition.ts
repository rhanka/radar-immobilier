/**
 * 6J lot stream planning.
 *
 * One command targets one facet stream plus, for workspace composite
 * discard/deselect, the named selection streams. Every affected stream is
 * locked and compared before any no-op shortcut; a single conflict rolls
 * the whole command back. Selection, pipeline, or market changes never
 * restore an archive; restoration never recreates a removed selection.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  facetEvents,
  facetHeads,
  facetStreams,
} from "../../../db/schema.js";
import {
  type LotCommand,
  type LotScope,
} from "./lot-commands.js";
import { LotHeadConflictError, type LotTarget } from "./lot-target.js";
import { lotEventResponse } from "./lot-response.js";
import {
  desiredFor,
  facetForMutation,
  type LotPlan,
  type PlannedStream,
} from "./lot-plan.js";
import { resolveLotStream } from "./lot-streams.js";
import type { LotTx } from "./lot-types.js";

async function currentFor(ref: PlannedStream["ref"], tx: LotTx) {
  if (!ref.id) return null;
  const [head] = await tx.select().from(facetHeads).where(eq(facetHeads.streamId, ref.id));
  if (!head) return null;
  const [event] = await tx.select().from(facetEvents).where(eq(facetEvents.id, head.eventId));
  return event ?? null;
}

/** Authorized conflict disclosure: affected streams only, never another member's personal state. */
export async function lotConflictHeads(
  tx: LotTx, workspaceId: string, scope: LotScope, ownerId: string | null,
  mode: LotCommand["mode"], target: LotTarget,
) {
  const rows = await tx.select({ event: facetEvents })
    .from(facetStreams)
    .innerJoin(facetHeads, eq(facetHeads.streamId, facetStreams.id))
    .innerJoin(facetEvents, eq(facetEvents.id, facetHeads.eventId))
    .where(and(
      eq(facetStreams.workspaceId, workspaceId),
      eq(facetStreams.scope, scope),
      ownerId === null ? isNull(facetStreams.ownerId) : eq(facetStreams.ownerId, ownerId),
      eq(facetStreams.targetType, "lot"),
      eq(facetStreams.mode, mode),
      eq(facetStreams.citySlug, target.citySlug),
      eq(facetStreams.nodeType, "Lot"),
      eq(facetStreams.nodeId, target.canonicalId),
    ));
  return rows.map(({ event }) => lotEventResponse(event));
}

export async function planLotStreams(
  tx: LotTx, workspaceId: string, scope: LotScope, actorId: string,
  command: LotCommand, target: LotTarget,
): Promise<LotPlan> {
  const ownerId = scope === "workspace" ? null : actorId;
  const { facet, basket } = facetForMutation(command.mutation);
  const mainRef = await resolveLotStream(tx, workspaceId, scope, ownerId,
    command.mode, target, facet, basket);
  const main: PlannedStream = { facet, basket, ref: mainRef, current: await currentFor(mainRef, tx) };
  const removals: PlannedStream[] = [];
  if (command.mutation.action === "discard") {
    const expected = new Map((command.mutation.deselect ?? []).map((entry) =>
      [entry.basket_id, entry.expected_head_id ?? null]));
    for (const basketId of [...expected.keys()].sort()) {
      const ref = await resolveLotStream(tx, workspaceId, scope, ownerId,
        command.mode, target, "selection", basketId);
      removals.push({ facet: "selection", basket: basketId, ref, current: await currentFor(ref, tx) });
    }
    const expectedByBasket = expected;
    const conflicted = (main.ref.headEventId ?? null) !== command.expected_head_id
      || removals.some((removal) =>
        (removal.ref.headEventId ?? null) !== (expectedByBasket.get(removal.basket!) ?? null));
    if (conflicted) {
      throw new LotHeadConflictError({
        target, version: null,
        heads: [...removalHeads(removals), ...(main.current ? [lotEventResponse(main.current)] : [])],
      });
    }
  } else if ((main.ref.headEventId ?? null) !== command.expected_head_id) {
    throw new LotHeadConflictError({
      target, version: null,
      heads: main.current ? [lotEventResponse(main.current)] : [],
    });
  }
  const desired = desiredFor(command.mutation);
  if (command.mutation.action === "restore" && main.current) {
    desired.reasonCode = main.current.reasonCode;
    desired.profileId = main.current.profileId;
    desired.verdict = main.current.verdict;
  }
  return { facet, basket, ownerId, main, removals, desired };
}

function removalHeads(removals: PlannedStream[]) {
  return removals.flatMap((removal) => (removal.current ? [lotEventResponse(removal.current)] : []));
}

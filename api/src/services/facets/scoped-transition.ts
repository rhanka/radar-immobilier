/**
 * 6H scoped transition: append one event with its stream binding and
 * terminal registration in the caller's transaction. No-op replays keep
 * the existing event; inactive-to-inactive without history appends nothing.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import type { Basket, FacetCommand } from "./writer.js";
import {
  facetEventBindings,
  facetEvents,
  facetHeads,
  facetReasonCodes,
} from "../../db/schema.js";
import { FACET_PROFILE } from "./codebook.js";
import { facetCommandDigest } from "./commands.js";
import { FacetError } from "./target.js";

type ScopedTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function appendScopedTransition(
  tx: ScopedTx, ownerId: string, command: FacetCommand, streamId: string,
  facet: string, basket: string | null, state: string, fingerprint: string,
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
      eq(facetReasonCodes.verdict, facet === "archive" ? "non_pertinent" : basket!)));
    if (!reason) throw new FacetError(422, "invalid_reason_code");
  }
  const id = randomUUID();
  if (current) {
    await tx.update(facetEvents).set({ supersededBy: id }).where(eq(facetEvents.id, current.id));
  }
  const [event] = await tx.insert(facetEvents).values({
    id, ownerId, actorId: ownerId, citySlug: target.citySlug, nodeType: target.type,
    nodeId: target.id, facet, basket, state, reasonCode,
    profileId: reasonCode ? FACET_PROFILE : null,
    verdict: reasonCode ? (facet === "archive" ? "non_pertinent" : basket) : null,
    observedFingerprint: fingerprint, commandKey: command.commandKey,
    commandDigest: facetCommandDigest(command), supersedes: current?.id ?? null,
  }).returning();
  await tx.insert(facetEventBindings).values({ eventId: event!.id, streamId });
  if (current) {
    await tx.update(facetHeads).set({ eventId: event!.id }).where(eq(facetHeads.streamId, streamId));
  } else {
    await tx.insert(facetHeads).values({ streamId, eventId: event!.id });
  }
  return event!;
}

/** Mirror of the 6A expectation shape: exact keys for composite discards. */
export function assertScopedExpectations(
  command: Pick<FacetCommand, "action" | "expectedSelectionHeads">,
  removals: Basket[],
): void {
  const selection = command.action === "select" || command.action === "deselect";
  if (selection || command.action === "restore") {
    if (command.expectedSelectionHeads !== undefined) {
      throw new FacetError(400, "invalid_facet_command");
    }
    return;
  }
  if (removals.length > 0) {
    const expectedKeys = Object.keys(command.expectedSelectionHeads ?? {}).sort();
    if (expectedKeys.length !== removals.length
      || expectedKeys.some((entry, index) => entry !== [...removals].sort()[index])) {
      throw new FacetError(400, "invalid_facet_command");
    }
    return;
  }
  if (command.expectedSelectionHeads !== undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
}

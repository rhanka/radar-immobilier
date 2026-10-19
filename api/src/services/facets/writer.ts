import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { accountUsers, facetCommands, facetEvents, facetReasonCodes } from "../../db/schema.js";
import { FACET_PROFILE } from "./codebook.js";
import { FacetError, resolveTarget, type SignalTarget } from "./target.js";
import { facetCommandDigest, readCommand } from "./commands.js";

export type Basket = "pertinent" | "a_surveiller";
export interface FacetCommand {
  action: "select" | "deselect" | "discard" | "restore";
  target: SignalTarget;
  basket?: Basket | undefined;
  reasonCode?: string | undefined;
  deselect?: Basket[] | undefined;
  commandKey: string;
}
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function approvedOwner(db: Pick<Database, "select">, sub: string) {
  const [owner] = await db.select().from(accountUsers).where(and(
    eq(accountUsers.sub, sub), eq(accountUsers.status, "approved"),
  )).for("share");
  if (!owner) throw new FacetError(403, "account_not_approved");
  return owner.id;
}
export async function writeFacet(db: Database, sub: string, command: FacetCommand) {
  return db.transaction(async (tx) => {
    const ownerId = await approvedOwner(tx, sub);
    const { target, basket, action } = command;
    const selection = action === "select" || action === "deselect";
    if (selection && !basket) throw new FacetError(422, "basket_required");
    const facet = selection ? "selection" : "archive";
    const removals = action === "discard" ? [...new Set(command.deselect ?? [])] : [];
    const locks = [[facet, selection ? basket : null], ...removals.map((b) => ["selection", b])]
      .map(([f, b]) => JSON.stringify(["personal", ownerId, f, b, target.citySlug, target.type, target.id]));
    locks.push(JSON.stringify(["command", ownerId, command.commandKey]));
    for (const key of [...new Set(locks)].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const commandDigest = facetCommandDigest(command);
    const replay = await readCommand(tx, ownerId, command.commandKey, commandDigest);
    if (replay !== undefined) return replay;
    const fingerprint = await resolveTarget(tx, target);
    if (action === "discard" && command.reasonCode === undefined) throw new FacetError(422, "reason_code_required");
    if (action === "select" || action === "discard") {
      await validateReason(tx, command.reasonCode, selection ? basket! : "non_pertinent");
    }
    const active = action === "select" || action === "discard";
    const event = await transition(tx, ownerId, command, facet, selection ? basket! : null,
      active ? "active" : "inactive", fingerprint, active ? command.reasonCode ?? null : null);
    for (const removed of removals) {
      await transition(tx, ownerId, command, "selection", removed, "inactive", fingerprint, null);
    }
    const result = event ? { ...event, createdAt: event.createdAt.toISOString() } : null;
    await tx.insert(facetCommands).values({ ownerId, commandKey: command.commandKey,
      commandDigest, result: { event: result } });
    return result;
  });
}
async function validateReason(tx: Tx, code: string | undefined, verdict: string) {
  if (code === undefined) return;
  const [reason] = await tx.select().from(facetReasonCodes).where(and(
    eq(facetReasonCodes.profileId, FACET_PROFILE), eq(facetReasonCodes.code, code),
    eq(facetReasonCodes.verdict, verdict),
  ));
  if (!reason) throw new FacetError(422, "invalid_reason_code");
}
async function transition(
  tx: Tx, ownerId: string, command: FacetCommand, facet: string,
  basket: Basket | null, state: string, fingerprint: string, reasonCode: string | null,
) {
  const { target } = command;
  const [head] = await tx.select().from(facetEvents).where(and(
    eq(facetEvents.ownerId, ownerId), eq(facetEvents.scope, "personal"),
    eq(facetEvents.citySlug, target.citySlug), eq(facetEvents.nodeType, target.type),
    eq(facetEvents.nodeId, target.id), eq(facetEvents.facet, facet),
    basket === null ? isNull(facetEvents.basket) : eq(facetEvents.basket, basket),
    isNull(facetEvents.supersededBy),
  ));
  if (head?.state === state && head.reasonCode === reasonCode) return head;
  if (!head && state === "inactive") return null;
  const id = randomUUID();
  if (head) await tx.update(facetEvents).set({ supersededBy: id }).where(eq(facetEvents.id, head.id));
  const [event] = await tx.insert(facetEvents).values({
    id, ownerId, actorId: ownerId, citySlug: target.citySlug, nodeType: target.type,
    nodeId: target.id, facet, basket, state, reasonCode,
    profileId: reasonCode ? FACET_PROFILE : null,
    verdict: reasonCode ? (facet === "archive" ? "non_pertinent" : basket) : null,
    observedFingerprint: fingerprint, commandKey: command.commandKey,
    commandDigest: facetCommandDigest(command), supersedes: head?.id ?? null,
  }).returning();
  return event!;
}

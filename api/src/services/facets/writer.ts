import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { accountUsers, facetCommands, facetEvents, facetReasonCodes } from "../../db/schema.js";
import { FACET_PROFILE } from "./codebook.js";
import {
  FacetError,
  FacetHeadConflictError,
  FacetTargetVersionConflictError,
  resolveTarget,
  type SignalTarget,
} from "./target.js";
import { facetCommandDigest, historicalCommandDigest, readCommand } from "./commands.js";
import { facetEventResponse } from "./response.js";
import { lockCityGraph } from "../graph/graph-store.js";

export type Basket = "pertinent" | "a_surveiller";
export interface ExpectedSelectionHeads {
  pertinent?: string | null;
  a_surveiller?: string | null;
}
export interface FacetCommand {
  action: "select" | "deselect" | "discard" | "restore";
  target: SignalTarget;
  basket?: Basket | undefined;
  reasonCode?: string | undefined;
  deselect?: Basket[] | undefined;
  expectedHeadId: string | null;
  expectedSelectionHeads?: ExpectedSelectionHeads | undefined;
  /** Fingerprint of the signal version the writer displayed, verified before any transition. */
  displayedFingerprint: string;
  commandKey: string;
}
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function assertHeadId(value: unknown): asserts value is string | null {
  if (value === null) return;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new FacetError(400, "invalid_facet_command");
  }
}

function assertFingerprint(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length !== 64 || !FINGERPRINT_PATTERN.test(value)) {
    throw new FacetError(400, "invalid_facet_command");
  }
}

function validateExpectations(command: FacetCommand, removals: Basket[]): void {
  assertHeadId(command.expectedHeadId);
  assertFingerprint(command.displayedFingerprint);
  const selection = command.action === "select" || command.action === "deselect";
  if (selection || command.action === "restore") {
    if (command.expectedSelectionHeads !== undefined) {
      throw new FacetError(400, "invalid_facet_command");
    }
    return;
  }
  const expected = command.expectedSelectionHeads;
  if (removals.length === 0) {
    if (expected !== undefined) throw new FacetError(400, "invalid_facet_command");
    return;
  }
  if (expected === undefined || expected === null || typeof expected !== "object") {
    throw new FacetError(400, "invalid_facet_command");
  }
  const expectedKeys = Object.keys(expected).sort();
  const removalKeys = [...new Set(removals)].sort();
  if (expectedKeys.length !== removalKeys.length
    || expectedKeys.some((key, index) => key !== removalKeys[index])) {
    throw new FacetError(400, "invalid_facet_command");
  }
  for (const key of expectedKeys) {
    assertHeadId((expected as Record<string, unknown>)[key]);
  }
}

export async function approvedOwner(db: Pick<Database, "select">, sub: string, lock = false) {
  const query = db.select({ id: accountUsers.id }).from(accountUsers).where(and(
    eq(accountUsers.sub, sub), eq(accountUsers.status, "approved"),
  ));
  const [owner] = await (lock ? query.for("share") : query);
  if (!owner) throw new FacetError(403, "account_not_approved");
  return owner.id;
}

/** Recovery only: a missing receipt never falls through to a mutation. */
export async function recoverHistoricalFacet(
  db: Database, sub: string,
  command: Omit<FacetCommand, "expectedHeadId" | "displayedFingerprint"> & {
    expectedHeadId?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const ownerId = await approvedOwner(tx, sub, true);
    const key = command.commandKey.toLowerCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["command", ownerId, key])}, 0))`);
    const replay = await readCommand(tx, ownerId, key, historicalCommandDigest(command));
    if (replay === undefined) throw new FacetError(400, "invalid_facet_command");
    return replay;
  });
}
export async function writeFacet(db: Database, sub: string, command: FacetCommand) {
  if (command.expectedHeadId === undefined || command.displayedFingerprint === undefined) {
    throw new FacetError(400, "invalid_facet_command");
  }
  command = { ...command, commandKey: command.commandKey.toLowerCase() };
  return db.transaction(async (tx) => {
    const ownerId = await approvedOwner(tx, sub, true);
    const { target, basket, action } = command;
    const selection = action === "select" || action === "deselect";
    if (selection && !basket) throw new FacetError(422, "basket_required");
    const facet = selection ? "selection" : "archive";
    const removals = action === "discard" ? [...new Set(command.deselect ?? [])] : [];
    validateExpectations(command, removals);
    const locks = [[facet, selection ? basket : null], ...removals.map((b) => ["selection", b])]
      .map(([f, b]) => JSON.stringify(["personal", ownerId, f, b, target.citySlug, target.type, target.id]));
    const commandLock = JSON.stringify(["command", ownerId, command.commandKey]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${commandLock}, 0))`);
    const commandDigest = facetCommandDigest(command);
    const replay = await readCommand(tx, ownerId, command.commandKey, commandDigest);
    if (replay !== undefined) return replay;
    // 6B: serialize against graph refreshes. The transaction-scoped city lock is
    // held through commit, so no refresh can slip between version comparison
    // and the appended transitions. A deleted target fails explicitly (404).
    await lockCityGraph(tx, target.citySlug);
    for (const key of [...new Set(locks)].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const fingerprint = await resolveTarget(tx, target);
    if (fingerprint !== command.displayedFingerprint) {
      const rows = await readHeadRows(tx, ownerId, target);
      throw new FacetTargetVersionConflictError({ target, version: { fingerprint },
        heads: rows.map((row) => facetEventResponse(row)) });
    }
    await compareExpectedHeads(tx, ownerId, command, removals);
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
    const context = { target, facet, basket: selection ? basket ?? null : null,
      expectedHeadId: command.expectedHeadId,
      expectedSelectionHeads: command.expectedSelectionHeads ?? null,
      displayedFingerprint: command.displayedFingerprint };
    await tx.insert(facetCommands).values({ ownerId, commandKey: command.commandKey,
      commandDigest, result: { event: result, context } });
    return result;
  });
}

async function readHeadRows(tx: Tx, ownerId: string, target: SignalTarget) {
  return tx.select().from(facetEvents).where(and(
    eq(facetEvents.ownerId, ownerId), eq(facetEvents.scope, "personal"),
    eq(facetEvents.citySlug, target.citySlug), eq(facetEvents.nodeType, target.type),
    eq(facetEvents.nodeId, target.id), isNull(facetEvents.supersededBy),
  ));
}

async function compareExpectedHeads(
  tx: Tx, ownerId: string, command: FacetCommand, removals: Basket[],
): Promise<void> {
  const { target } = command;
  const rows = await readHeadRows(tx, ownerId, target);
  const headFor = (facet: string, basket: Basket | null) =>
    rows.find((row) => row.facet === facet && (basket === null ? row.basket === null : row.basket === basket));
  const mismatch = (facet: string, basket: Basket | null, expected: string | null): boolean => {
    const head = headFor(facet, basket);
    return (head?.id ?? null) !== expected;
  };
  const selection = command.action === "select" || command.action === "deselect";
  const facet = selection ? "selection" : "archive";
  const basket = selection ? command.basket! : null;
  let conflicted = mismatch(facet, basket, command.expectedHeadId);
  if (!conflicted && command.action === "discard") {
    const expected = command.expectedSelectionHeads ?? {};
    conflicted = removals.some((removed) =>
      mismatch("selection", removed, (expected as Record<string, string | null>)[removed] ?? null));
  }
  if (conflicted) {
    throw new FacetHeadConflictError({ target, version: null,
      heads: rows.map((row) => facetEventResponse(row)) });
  }
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

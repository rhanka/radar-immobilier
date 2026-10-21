import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetCommands, facetEvents } from "../../src/db/schema.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());

function selectionHeadId(event: { id: string } | null): string | null {
  return event?.id ?? null;
}

it("concurrent first writes expect null: one success and one head conflict with current", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const keys = [randomUUID(), randomUUID()];
  const settled = await Promise.allSettled(keys.map((commandKey) =>
    writeFacet(db, sub, { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey })));
  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  const rejected = settled.filter((entry) => entry.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const failure = (rejected[0] as PromiseRejectedResult).reason;
  expect(failure).toMatchObject({ status: 409, message: "facet_head_conflict" });
  const current = (failure as { current: { target: unknown; version: null; heads: unknown[] } }).current;
  expect(current.target).toEqual(target);
  expect(current.version).toBeNull();
  expect(current.heads).toHaveLength(1);
  const head = current.heads[0] as Record<string, unknown>;
  expect(head).toMatchObject({ target, facet: "selection", basket: "pertinent", state: "active" });
  expect(head).not.toHaveProperty("ownerId");
  expect(head).not.toHaveProperty("actorId");
  expect(head).not.toHaveProperty("commandDigest");
  const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string } | null>).value;
  expect(head["id"]).toBe(winner?.id);
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(1);
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(1);
});

it("stale expectation conflicts even when the requested final state already matches", async () => {
  const { sub, target } = await facetFixture(db);
  const first = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() });
  expect(first?.state).toBe("active");
  await expect(writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
  const replay = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: selectionHeadId(first),
      commandKey: randomUUID() });
  expect(replay?.id).toBe(first?.id);
});

it("null conflicts with an inactive existing head", async () => {
  const { sub, target } = await facetFixture(db);
  const selected = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() });
  const deselected = await writeFacet(db, sub,
    { action: "deselect", target, basket: "pertinent",
      expectedHeadId: selectionHeadId(selected), commandKey: randomUUID() });
  expect(deselected?.state).toBe("inactive");
  const failure = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() },
  ).catch((error: unknown) => error);
  expect(failure).toMatchObject({ status: 409, message: "facet_head_conflict" });
  const current = (failure as { current: { heads: Array<{ id: string; state: string }> } }).current;
  expect(current.heads).toHaveLength(1);
  expect(current.heads[0]).toMatchObject({ id: deselected?.id, state: "inactive" });
});

it("one selection conflict rolls back the entire discard", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const pertinent = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() });
  const watching = await writeFacet(db, sub,
    { action: "select", target, basket: "a_surveiller", expectedHeadId: null, commandKey: randomUUID() });
  expect(watching?.state).toBe("active");
  await expect(writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN",
    deselect: ["pertinent", "a_surveiller"], expectedHeadId: null,
    expectedSelectionHeads: { pertinent: pertinent?.id ?? null, a_surveiller: randomUUID() },
    commandKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
  const heads = await db.select().from(facetEvents).where(and(
    eq(facetEvents.ownerId, ownerId), isNull(facetEvents.supersededBy)));
  expect(heads).toHaveLength(2);
  expect(heads.every((row) => row.facet === "selection" && row.state === "active")).toBe(true);
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(2);
});

it("exact replay returns its original result after later transitions", async () => {
  const { sub, target } = await facetFixture(db);
  const key = randomUUID();
  const first = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: key });
  const deselected = await writeFacet(db, sub,
    { action: "deselect", target, basket: "pertinent",
      expectedHeadId: selectionHeadId(first), commandKey: randomUUID() });
  expect(deselected?.state).toBe("inactive");
  const replayed = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: key });
  expect(replayed?.id).toBe(first?.id);
  await expect(writeFacet(db, sub,
    { action: "select", target, basket: "pertinent",
      expectedHeadId: selectionHeadId(deselected), commandKey: key }),
  ).rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
});

it("changed expectations with the same key conflict", async () => {
  const { sub, target } = await facetFixture(db);
  const key = randomUUID();
  const first = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: key });
  await expect(writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", reasonCode: "P-DENSITE",
      expectedHeadId: selectionHeadId(first), commandKey: key }),
  ).rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  expect(await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: key }),
  ).toEqual(first);
});

it("undo cannot overwrite an intervening archive change", async () => {
  const { sub, target } = await facetFixture(db);
  const first = await writeFacet(db, sub,
    { action: "discard", target, reasonCode: "N-ADMIN", expectedHeadId: null, commandKey: randomUUID() });
  const second = await writeFacet(db, sub,
    { action: "discard", target, reasonCode: "N-DOUBLON", expectedHeadId: first?.id ?? null,
      commandKey: randomUUID() });
  expect(second?.supersedes).toBe(first?.id);
  await expect(writeFacet(db, sub,
    { action: "restore", target, expectedHeadId: first?.id ?? null, commandKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
  const restored = await writeFacet(db, sub,
    { action: "restore", target, expectedHeadId: second?.id ?? null, commandKey: randomUUID() });
  expect(restored?.state).toBe("inactive");
});

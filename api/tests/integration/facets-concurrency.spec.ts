import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetCommands, facetEvents } from "../../src/db/schema.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should serialize concurrent first writes and replay a command exactly", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const command = { action: "discard" as const, target, reasonCode: "N-ADMIN",
    expectedHeadId: null as string | null, commandKey: randomUUID() };
  const results = await Promise.all(Array.from({ length: 8 }, () => writeFacet(db, sub, command)));
  for (const result of results) expect(result).toEqual(results[0]);
  const restored = await writeFacet(db, sub, { action: "restore", target,
    expectedHeadId: results[0]?.id ?? null, commandKey: randomUUID() });
  expect(restored?.state).toBe("inactive");
  expect(await writeFacet(db, sub, command)).toEqual(results[0]);
  await expect(writeFacet(db, sub, { ...command, reasonCode: "N-FORME", commandKey: command.commandKey }),
  ).rejects.toMatchObject({ status: 409 });
  const events = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  expect(events).toHaveLength(2);
  expect(events.filter((event) => event.supersededBy === null)).toHaveLength(1);
  expect((await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId)))).toHaveLength(2);
});
it("should record no-op keys and serialize overlapping multi-head commands", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const noOp = { action: "restore" as const, target,
    expectedHeadId: null as string | null, commandKey: randomUUID() };
  expect(await writeFacet(db, sub, noOp)).toBeNull();
  await expect(writeFacet(db, sub, { ...noOp, action: "discard", reasonCode: "N-ADMIN" } as const),
  ).rejects.toMatchObject({ status: 409 });
  const [pertinent, watching] = await Promise.all(["pertinent", "a_surveiller"].map((basket) =>
    writeFacet(db, sub, { action: "select", target, basket: basket as "pertinent" | "a_surveiller",
      expectedHeadId: null, commandKey: randomUUID() })));
  const settled = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => writeFacet(db, sub, {
    action: "discard", target, reasonCode: "N-ADMIN", commandKey: randomUUID(), expectedHeadId: null,
    deselect: i % 2 ? ["pertinent", "a_surveiller"] : ["a_surveiller", "pertinent"],
    expectedSelectionHeads: { pertinent: pertinent?.id ?? null, a_surveiller: watching?.id ?? null },
  })));
  expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
  for (const entry of settled.filter((entry) => entry.status === "rejected")) {
    expect((entry as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: "facet_head_conflict" });
  }
  expect(await writeFacet(db, sub, noOp)).toBeNull();
  const events = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  expect(events).toHaveLength(5);
  expect(events.filter((event) => event.supersededBy === null)).toHaveLength(3);
});
it("should serialize mixed-case command keys across different target locks", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const other = await facetFixture(db);
  const key = randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => writeFacet(db, sub, {
    action: "select", basket: "pertinent", target: i % 2 ? target : other.target,
    expectedHeadId: null, commandKey: i % 2 ? key.toUpperCase() : key,
  })));
  const successes = results.filter((result) => result.status === "fulfilled");
  expect(successes).toHaveLength(4);
  for (const result of successes) expect(result).toEqual(successes[0]);
  for (const result of results.filter((result) => result.status === "rejected")) {
    expect(result.reason).toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  }
  expect(await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId))).toHaveLength(1);
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(1);
});

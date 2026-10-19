import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetCommands, facetEvents } from "../../src/db/schema.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { facetFixture } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should serialize concurrent first writes and replay a command exactly", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const command = { action: "discard" as const, target, reasonCode: "N-ADMIN", commandKey: randomUUID() };
  const results = await Promise.all(Array.from({ length: 8 }, () => writeFacet(db, sub, command)));
  for (const result of results) expect(result).toEqual(results[0]);
  await writeFacet(db, sub, { action: "restore", target, commandKey: randomUUID() });
  expect(await writeFacet(db, sub, command)).toEqual(results[0]);
  await expect(writeFacet(db, sub, { ...command, reasonCode: "N-FORME" })).rejects.toMatchObject({ status: 409 });
  const events = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  expect(events).toHaveLength(2);
  expect(events.filter((event) => event.supersededBy === null)).toHaveLength(1);
  expect((await db.select().from(facetCommands).where(eq(facetCommands.ownerId, ownerId)))).toHaveLength(2);
});
it("should record no-op keys and serialize overlapping multi-head commands", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const noOp = { action: "restore" as const, target, commandKey: randomUUID() };
  expect(await writeFacet(db, sub, noOp)).toBeNull();
  await expect(writeFacet(db, sub, { ...noOp, action: "discard", reasonCode: "N-ADMIN" })).rejects.toMatchObject({ status: 409 });
  await Promise.all(["pertinent", "a_surveiller"].map((basket) => writeFacet(db, sub,
    { action: "select", target, basket: basket as "pertinent" | "a_surveiller", commandKey: randomUUID() })));
  await Promise.all(Array.from({ length: 8 }, (_, i) => writeFacet(db, sub, {
    action: "discard", target, reasonCode: "N-ADMIN", commandKey: randomUUID(),
    deselect: i % 2 ? ["pertinent", "a_surveiller"] : ["a_surveiller", "pertinent"],
  })));
  expect(await writeFacet(db, sub, noOp)).toBeNull();
  const events = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  expect(events).toHaveLength(5);
  expect(events.filter((event) => event.supersededBy === null)).toHaveLength(3);
});

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers } from "../../src/db/schema.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { facetFixture } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should select independently in both baskets and keep identical state event-free", async () => {
  const { target, sub, ownerId } = await facetFixture(db);
  const command = { action: "select" as const, target, basket: "pertinent" as const, commandKey: randomUUID() };
  const first = await writeFacet(db, sub, command);
  expect(first).toMatchObject({ actorId: ownerId, ownerId, state: "active", reasonCode: null });
  expect((await writeFacet(db, sub, { ...command, commandKey: randomUUID() }))?.id).toBe(first?.id);
  const coded = await writeFacet(db, sub, { ...command, commandKey: randomUUID(), reasonCode: "P-DENSITE" });
  expect(coded?.supersedes).toBe(first?.id);
  expect((await writeFacet(db, sub, { ...command, commandKey: randomUUID(), basket: "a_surveiller", reasonCode: "S-CONTRAINTE" }))?.supersedes).toBeNull();
  const other = await facetFixture(db);
  expect((await writeFacet(db, other.sub, { ...command, commandKey: randomUUID() }))?.ownerId).toBe(other.ownerId);
  for (const reasonCode of ["UNKNOWN", "N-ADMIN", "S-CONTRAINTE"]) {
    await expect(writeFacet(db, sub, { ...command, commandKey: randomUUID(), reasonCode })).rejects.toMatchObject({ status: 422 });
  }
  await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.sub, sub));
  await expect(writeFacet(db, sub, { ...command, commandKey: randomUUID() })).rejects.toMatchObject({ status: 403 });
  await expect(writeFacet(db, "unknown", command)).rejects.toMatchObject({ status: 403 });
});

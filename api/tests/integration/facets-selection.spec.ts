import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers } from "../../src/db/schema.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should select independently in both baskets and keep identical state event-free", async () => {
  const { target, sub, ownerId } = await facetFixture(db);
  const first = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() });
  expect(first).toMatchObject({ actorId: ownerId, ownerId, state: "active", reasonCode: null });
  expect((await writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: first?.id ?? null, commandKey: randomUUID() }))?.id).toBe(first?.id);
  const coded = await writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    reasonCode: "P-DENSITE", expectedHeadId: first?.id ?? null, commandKey: randomUUID() });
  expect(coded?.supersedes).toBe(first?.id);
  expect((await writeFacet(db, sub, { action: "select", target, basket: "a_surveiller",
    reasonCode: "S-CONTRAINTE", expectedHeadId: null,
    commandKey: randomUUID() }))?.supersedes).toBeNull();
  const other = await facetFixture(db);
  expect((await writeFacet(db, other.sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: null, commandKey: randomUUID() }))?.ownerId).toBe(other.ownerId);
  for (const reasonCode of ["UNKNOWN", "N-ADMIN", "S-CONTRAINTE"]) {
    await expect(writeFacet(db, sub, { action: "select", target, basket: "pertinent",
      reasonCode, expectedHeadId: coded?.id ?? null, commandKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 422 });
  }
  await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.sub, sub));
  await expect(writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: coded?.id ?? null, commandKey: randomUUID() })).rejects.toMatchObject({ status: 403 });
  await expect(writeFacet(db, "unknown", { action: "select", target, basket: "pertinent",
    expectedHeadId: null, commandKey: randomUUID() })).rejects.toMatchObject({ status: 403 });
});

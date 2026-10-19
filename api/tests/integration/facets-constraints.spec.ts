import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers, facetEvents } from "../../src/db/schema.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
describe("facet event constraints", () => {
  it("should protect heads and reject event changes or deletion", async () => {
    const [owner] = await db.insert(accountUsers).values({ sub: randomUUID() }).returning();
    const row = {
      ownerId: owner!.id, actorId: owner!.id, citySlug: "constraint-city",
      nodeType: "Signal", nodeId: "synthetic-id", facet: "archive", state: "active",
      profileId: "immo-steve-2026-09", reasonCode: "V2-PRECEDENT", verdict: "non_pertinent",
      observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64),
    };
    const [event] = await db.insert(facetEvents).values(row).returning();
    await expect(db.insert(facetEvents).values(row)).rejects.toThrow();
    await expect(pool.query("UPDATE facet_events SET state = 'inactive' WHERE id = $1", [event!.id])).rejects.toThrow("append-only");
    await expect(pool.query("DELETE FROM facet_events WHERE id = $1", [event!.id])).rejects.toThrow("append-only");
  });
  it("should reject invalid scopes, targets, attribution and classified reasons", async () => {
    const [owner, other] = await db.insert(accountUsers).values([
      { sub: randomUUID() }, { sub: randomUUID() },
    ]).returning();
    const row = {
      ownerId: owner!.id, actorId: owner!.id, citySlug: "constraint-city",
      nodeType: "DesignationEvent", nodeId: "synthetic-event", facet: "archive", state: "active",
      profileId: "immo-steve-2026-09", reasonCode: "N-ADMIN", verdict: "non_pertinent",
      observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64),
    };
    for (const invalid of [
      { scope: "common" }, { targetType: "lot" }, { nodeType: "Bylaw" },
      { actorId: other!.id }, { reasonCode: "UNKNOWN" }, { verdict: "pertinent" },
      { reasonCode: null, profileId: null, verdict: null }, { basket: "pertinent" },
      { facet: "selection", basket: null }, { facet: "selection", basket: "pertinent" },
      { reasonCode: "P-DENSITE" }, { profileId: null }, { verdict: null },
    ]) {
      await expect(db.insert(facetEvents).values({ ...row, ...invalid })).rejects.toThrow();
    }
    await expect(db.insert(facetEvents).values({ ...row, facet: "selection", basket: "pertinent",
      reasonCode: "P-DENSITE", verdict: "pertinent" })).resolves.toBeDefined();
    await expect(db.insert(facetEvents).values({ ...row, facet: "selection", basket: "a_surveiller",
      reasonCode: null, profileId: null, verdict: null })).resolves.toBeDefined();
  });
});

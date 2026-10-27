import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers, facetCommands, facetEvents } from "../../src/db/schema.js";

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
    const cases: [Partial<typeof facetEvents.$inferInsert>, string][] = [
      [{ scope: "common" }, "facet_events_scope_check"],
      [{ targetType: "lot" }, "chk_facet_events_target_lot_6j"],
      [{ nodeType: "Bylaw" }, "chk_facet_events_target_lot_6j"],
      [{ actorId: other!.id }, "chk_facet_events_actor_owner"],
      [{ reasonCode: "UNKNOWN" }, "facet_events_profile_id_reason_code_verdict_fkey"],
      [{ verdict: "pertinent" }, "chk_facet_events_classified_reason"],
      [{ reasonCode: "P-DENSITE", verdict: "pertinent" }, "chk_facet_events_classified_reason"],
      [{ reasonCode: null, profileId: null, verdict: null }, "chk_facet_events_archive_reason"],
      [{ basket: "pertinent" }, "chk_facet_events_basket"],
      [{ facet: "selection", basket: null }, "chk_facet_events_basket"],
      [{ facet: "selection", basket: "pertinent" }, "chk_facet_events_classified_reason"],
      [{ reasonCode: "P-DENSITE" }, "facet_events_profile_id_reason_code_verdict_fkey"],
      [{ profileId: null }, "chk_facet_events_classified_reason"],
      [{ verdict: null }, "chk_facet_events_classified_reason"],
    ];
    for (const [invalid, constraint] of cases) {
      await expect(db.insert(facetEvents).values({ ...row, ...invalid }))
        .rejects.toMatchObject({ cause: { constraint } });
    }
    await expect(db.insert(facetEvents).values({ ...row, facet: "selection", basket: "pertinent",
      reasonCode: "P-DENSITE", verdict: "pertinent" })).resolves.toBeDefined();
    await expect(db.insert(facetEvents).values({ ...row, facet: "selection", basket: "a_surveiller",
      reasonCode: null, profileId: null, verdict: null })).resolves.toBeDefined();
  });
  it("should only permit the first superseded_by update without other changes", async () => {
    const [owner] = await db.insert(accountUsers).values({ sub: randomUUID() }).returning();
    const row = { ownerId: owner!.id, actorId: owner!.id, citySlug: "constraint-city",
      nodeType: "Signal", nodeId: randomUUID(), facet: "selection", basket: "pertinent", state: "active",
      observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64) };
    const [head] = await db.insert(facetEvents).values(row).returning();
    const successor = randomUUID();
    await expect(pool.query("UPDATE facet_events SET superseded_by = $1, state = 'inactive' WHERE id = $2",
      [successor, head!.id])).rejects.toThrow("append-only");
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE facet_events SET superseded_by = ${successor} WHERE id = ${head!.id}`);
      await tx.insert(facetEvents).values({ ...row, id: successor, supersedes: head!.id });
    });
    for (const replacement of [null, successor, randomUUID()]) {
      await expect(pool.query("UPDATE facet_events SET superseded_by = $1 WHERE id = $2",
        [replacement, head!.id])).rejects.toThrow("append-only");
    }
  });
  it("should timestamp commands and reject command updates, deletes and table truncation", async () => {
    const [owner] = await db.insert(accountUsers).values({ sub: randomUUID() }).returning();
    const [receipt] = await db.insert(facetCommands).values({ ownerId: owner!.id, commandKey: randomUUID(),
      commandDigest: "b".repeat(64), result: { event: null } }).returning();
    expect(receipt).toMatchObject({ createdAt: expect.any(Date) });
    await expect(pool.query("UPDATE facet_commands SET result = '{}' WHERE owner_id = $1", [owner!.id]))
      .rejects.toThrow("immutable");
    await expect(pool.query("DELETE FROM facet_commands WHERE owner_id = $1", [owner!.id])).rejects.toThrow("immutable");
    for (const table of ["facet_events", "facet_commands"]) {
      // CASCADE reaches the immutability guards even when additive tables reference these rows.
      await expect(pool.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/append-only|immutable/);
    }
    expect((await pool.query("SELECT result FROM facet_commands WHERE owner_id = $1", [owner!.id])).rows)
      .toEqual([{ result: { event: null } }]);
  });
});

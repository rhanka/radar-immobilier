import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetEvents } from "../../src/db/schema.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should archive with an explicit code, change codes and restore without selecting", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  expect(await writeFacet(db, sub,
    { action: "restore", target, expectedHeadId: null, commandKey: randomUUID() })).toBeNull();
  const selected = await writeFacet(db, sub,
    { action: "select", target, basket: "pertinent", expectedHeadId: null, commandKey: randomUUID() });
  for (const reasonCode of [undefined, "UNKNOWN", "P-DENSITE", "S-CONTRAINTE"]) {
    await expect(writeFacet(db, sub, { action: "discard", target,
      ...(reasonCode ? { reasonCode } : {}), deselect: ["pertinent"], expectedHeadId: null,
      expectedSelectionHeads: { pertinent: selected?.id ?? null },
      commandKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
  }
  const first = await writeFacet(db, sub,
    { action: "discard", target, reasonCode: "V2-PRECEDENT", expectedHeadId: null,
      commandKey: randomUUID() });
  expect((await writeFacet(db, sub, { action: "discard", target, reasonCode: "V2-PRECEDENT",
    expectedHeadId: first?.id ?? null, commandKey: randomUUID() }))?.id).toBe(first?.id);
  const changed = await writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN",
    deselect: ["pertinent"], expectedHeadId: first?.id ?? null,
    expectedSelectionHeads: { pertinent: selected?.id ?? null }, commandKey: randomUUID() });
  expect(changed?.supersedes).toBe(first?.id);
  const deselected = await db.select().from(facetEvents).where(and(eq(facetEvents.ownerId, ownerId),
    eq(facetEvents.facet, "selection"), isNull(facetEvents.supersededBy)));
  const restored = await writeFacet(db, sub, { action: "restore", target,
    expectedHeadId: changed?.id ?? null, commandKey: randomUUID() });
  expect(restored?.state).toBe("inactive");
  const heads = await db.select().from(facetEvents).where(and(eq(facetEvents.ownerId, ownerId), isNull(facetEvents.supersededBy)));
  expect(heads).toHaveLength(2);
  expect(heads.every((row) => row.state === "inactive")).toBe(true);
  const before = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  await writeFacet(db, sub, { action: "restore", target,
    expectedHeadId: restored?.id ?? null, commandKey: randomUUID() });
  await writeFacet(db, sub, { action: "deselect", target, basket: "a_surveiller",
    expectedHeadId: null, commandKey: randomUUID() });
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(before.length);
  expect(deselected).toHaveLength(1);
});
it("should roll back the archive and every removal when a later insert fails", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const selected = await writeFacet(db, sub, { action: "select", target, basket: "pertinent",
    expectedHeadId: null, commandKey: randomUUID() });
  // This owner-specific failure occurs AFTER the archive INSERT, during deselection.
  await pool.query(`CREATE OR REPLACE FUNCTION fail_facet_removal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic removal failure'; END $$`);
  await pool.query(`CREATE TRIGGER fail_facet_removal BEFORE INSERT ON facet_events
    FOR EACH ROW WHEN (NEW.owner_id = '${ownerId}' AND NEW.facet = 'selection' AND NEW.state = 'inactive')
    EXECUTE FUNCTION fail_facet_removal()`);
  try {
    await expect(writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN",
      deselect: ["pertinent"], expectedHeadId: null,
      expectedSelectionHeads: { pertinent: selected?.id ?? null },
      commandKey: randomUUID() })).rejects.toThrow();
    const rows = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ facet: "selection", state: "active", supersededBy: null });
  } finally {
    await pool.query("DROP TRIGGER fail_facet_removal ON facet_events");
    await pool.query("DROP FUNCTION fail_facet_removal()");
  }
});

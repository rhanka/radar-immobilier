import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetEvents } from "../../src/db/schema.js";
import { writeFacet, type FacetCommand } from "../../src/services/facets/writer.js";
import { facetFixture } from "./facets-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should archive with an explicit code, change codes and restore without selecting", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  const run = (input: Omit<FacetCommand, "target" | "commandKey">) =>
    writeFacet(db, sub, { ...input, target, commandKey: randomUUID() });
  expect(await run({ action: "restore" })).toBeNull();
  await run({ action: "select", basket: "pertinent" });
  for (const reasonCode of [undefined, "UNKNOWN", "P-DENSITE", "S-CONTRAINTE"]) {
    await expect(run({ action: "discard", ...(reasonCode ? { reasonCode } : {}), deselect: ["pertinent"] })).rejects.toMatchObject({ status: 422 });
  }
  const first = await run({ action: "discard", reasonCode: "V2-PRECEDENT" });
  expect((await run({ action: "discard", reasonCode: "V2-PRECEDENT" }))?.id).toBe(first?.id);
  const changed = await run({ action: "discard", reasonCode: "N-ADMIN", deselect: ["pertinent"] });
  expect(changed?.supersedes).toBe(first?.id);
  await run({ action: "restore" });
  const heads = await db.select().from(facetEvents).where(and(eq(facetEvents.ownerId, ownerId), isNull(facetEvents.supersededBy)));
  expect(heads).toHaveLength(2);
  expect(heads.every((row) => row.state === "inactive")).toBe(true);
  const before = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
  await run({ action: "restore" });
  await run({ action: "deselect", basket: "a_surveiller" });
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId))).toHaveLength(before.length);
});
it("should roll back the archive and every removal when a later insert fails", async () => {
  const { sub, target, ownerId } = await facetFixture(db);
  await writeFacet(db, sub, { action: "select", target, basket: "pertinent", commandKey: randomUUID() });
  // This owner-specific failure occurs AFTER the archive INSERT, during deselection.
  await pool.query(`CREATE OR REPLACE FUNCTION fail_facet_removal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic removal failure'; END $$`);
  await pool.query(`CREATE TRIGGER fail_facet_removal BEFORE INSERT ON facet_events
    FOR EACH ROW WHEN (NEW.owner_id = '${ownerId}' AND NEW.facet = 'selection' AND NEW.state = 'inactive')
    EXECUTE FUNCTION fail_facet_removal()`);
  try {
    await expect(writeFacet(db, sub, { action: "discard", target, reasonCode: "N-ADMIN",
      deselect: ["pertinent"], commandKey: randomUUID() })).rejects.toThrow();
    const rows = await db.select().from(facetEvents).where(eq(facetEvents.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ facet: "selection", state: "active", supersededBy: null });
  } finally {
    await pool.query("DROP TRIGGER fail_facet_removal ON facet_events");
    await pool.query("DROP FUNCTION fail_facet_removal()");
  }
});

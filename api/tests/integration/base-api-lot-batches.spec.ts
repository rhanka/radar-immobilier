import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotVersions } from "../../src/db/schema.js";
import { resolveLotSource } from "../../src/services/facets/lots/lot-target.js";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed lot batches", () => {
  it("commits and replays 500 targets with expected cardinalities", async () => {
    const f = await lotHttpFixture();
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: randomUUID(),
      canonicalId: `synthetic-b5-limit-${String(index).padStart(3, "0")}`,
      noLot: `SYN-B5-${index}`, citySlug: "synthetic-b5-limit", reconStatus: "validated",
      validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
      rawRef: `synthetic-b5-limit-${index}` }));
    await f.fixture.db.insert(lotVersions).values(rows);
    const items = [];
    for (const row of rows) {
      const target = { type: "Lot" as const, authority: "lot_versions" as const,
        citySlug: row.citySlug, canonicalId: row.canonicalId };
      items.push({ target, displayed_version: (await resolveLotSource(f.fixture.db, target)).displayed,
        expected_head_id: null, mutation: { action: "select" as const, basket_id: f.fixture.selectionBasket } });
    }
    const key = randomUUID();
    const sub = f.fixture.contributor.sub;
    const first = await f.batch("workspace", { mode: "real", items }, sub, key);
    expect(first.status).toBe(200);
    const receipt = await first.text();
    const body = JSON.parse(receipt) as { result: {
      targets: number; changed: number; unchanged: number; eventsAppended: number;
      items: Array<{ heads: Array<{ id: string }> }> } };
    expect(body.result).toMatchObject({ targets: 500, changed: 500, unchanged: 0, eventsAppended: 500 });
    expect(new Set(body.result.items.map((item) => item.heads[0]!.id)).size).toBe(500);
    const before = await f.sqlSnapshot();
    const replayed = await f.batch("workspace", { mode: "real", items }, sub, key);
    expect(replayed.status).toBe(200);
    expect(await replayed.text()).toBe(receipt);
    expect(await f.sqlSnapshot()).toEqual(before);
    for (const table of ["facet_events", "facet_heads", "facet_event_bindings", "facet_streams"]) {
      expect((await f.fixture.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(500);
    }
    for (const table of ["facet_commands", "facet_command_contexts"]) {
      expect((await f.fixture.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(1);
    }
  });

  it("rejects 501 items and empty batches before mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const item = { target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    const before = await f.sqlSnapshot();
    const oversized = await f.batch("workspace",
      { mode: "real", items: Array.from({ length: 501 }, () => ({ ...item })) }, sub);
    expect(oversized.status).toBe(400);
    const empty = await f.batch("workspace", { mode: "real", items: [] }, sub);
    expect(empty.status).toBe(400);
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("rolls back batches with a late invalid member", async () => {
    const f = await lotHttpFixture();
    const first = await f.resolve(0);
    const second = await f.resolve(1);
    const valid = (resolved: typeof first) => ({ target: resolved.target,
      displayed_version: resolved.displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } });
    const before = await f.sqlSnapshot();
    const rejected = await f.batch("workspace", { mode: "real", items: [
      valid(first), { ...valid(second), mutation: { action: "discard", reasonCode: "N-UNKNOWN" } },
    ] }, f.fixture.moderator.sub);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ error: "invalid_reason_code" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });
});

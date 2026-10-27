// The inclusive 500-target boundary executes real SQL writes and replays.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotVersions } from "../../../db/schema.js";
import { resolveLotSource } from "./lot-target.js";
import { writeLotBatch } from "./lot-batch.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { lotEventCount } from "./lot-test-helpers.js";

describeDb("B2 lot batch maximum", () => {
  it("should commit and replay 500 targets and reject 501 without mutation", async () => {
    const f = await lotFixture();
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: randomUUID(),
      canonicalId: `synthetic-b2-limit-${String(index).padStart(3, "0")}`,
      noLot: `SYN-B2-${index}`, citySlug: "synthetic-b2-limit", reconStatus: "validated",
      validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
      rawRef: `synthetic-b2-limit-${index}` }));
    await f.db.insert(lotVersions).values(rows);
    const items = [];
    for (const row of rows) {
      const target = { type: "Lot" as const, authority: "lot_versions" as const,
        citySlug: row.citySlug, canonicalId: row.canonicalId };
      items.push({ target, displayed_version: (await resolveLotSource(f.db, target)).displayed,
        expected_head_id: null, mutation: { action: "select" as const, basket_id: f.selectionBasket } });
    }
    const command = { contract_version: "lot-facets-v1" as const, command_key: randomUUID(),
      mode: "real" as const, items };
    const first = await writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", command);
    expect(first).toMatchObject({ targets: 500, changed: 500, unchanged: 0, eventsAppended: 500 });
    expect(first.items).toHaveLength(500);
    expect(new Set(first.items.map((item) => item.heads[0]!.id)).size).toBe(500);
    expect(await lotEventCount(f)).toBe(500);
    expect(await writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", command))
      .toEqual(first);
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace",
      { ...command, command_key: randomUUID(), items: [...items, { ...items[0]!,
        target: { ...items[0]!.target, canonicalId: "synthetic-b2-501" } }] }))
      .rejects.toMatchObject({ status: 400 });
    expect(await lotEventCount(f)).toBe(500);
    for (const table of ["facet_heads", "facet_event_bindings", "facet_streams"]) {
      expect((await f.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(500);
    }
    for (const table of ["facet_commands", "facet_command_contexts"]) {
      expect((await f.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(1);
    }
  });
});

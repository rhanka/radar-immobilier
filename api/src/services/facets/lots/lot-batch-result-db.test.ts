import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeLotBatch } from "./lot-batch.js";
import { writeLotFacet } from "./lot-writer.js";
import type { LotBatchCommand } from "./lot-commands.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6J composite batch results", () => {
  it("should retain every affected head and replay composite and unchanged items", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
      "workspace", lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }));
    const batch: LotBatchCommand = {
      contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real",
      items: [{ target, displayed_version: displayed, expected_head_id: null,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket,
            expected_head_id: selected.heads[0]!.id }] } }],
    };
    const result = await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch);
    expect(result).toMatchObject({ targets: 1, changed: 1, unchanged: 0, eventsAppended: 2 });
    const item = result.items[0]!;
    expect(item).toMatchObject({ target, mode: "real", appended: true });
    expect(item.events.map((event) => [event.facet, event.state])).toEqual([
      ["archive", "active"], ["selection", "inactive"],
    ]);
    expect(item.heads).toEqual(item.events);
    for (const head of item.heads) expect(head.displayedVersion).toEqual(displayed);
    expect(await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch))
      .toEqual(result);
    const archive = item.heads.find((head) => head.facet === "archive")!;
    const noop: LotBatchCommand = { ...batch, command_key: randomUUID(),
      items: [{ target, displayed_version: displayed, expected_head_id: archive.id,
        mutation: { action: "discard", reasonCode: "N-NON-RES" } }],
    };
    const unchanged = await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", noop);
    expect(unchanged).toMatchObject({ targets: 1, changed: 0, unchanged: 1, eventsAppended: 0 });
    expect(unchanged.items[0]).toEqual({ target, mode: "real", appended: false,
      events: [], heads: [archive] });
    expect(await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", noop))
      .toEqual(unchanged);
    expect(await lotEventCount(f)).toBe(3);
  });
});

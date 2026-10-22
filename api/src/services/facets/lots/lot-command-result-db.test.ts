// 6J lot command results: full §3.7 outcomes with appended events and
// affected heads, including composite discards, no-ops, and batch items.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeLotBatch } from "./lot-batch.js";
import { writeLotFacet } from "./lot-writer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";
import type { LotCommand } from "./lot-commands.js";

describeDb("6J lot command results", () => {
  it("should return appended events and affected heads for a composite discard", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(selected).toMatchObject({ target, mode: "real" });
    expect(selected.events).toHaveLength(1);
    expect(selected.heads).toHaveLength(1);
    expect(selected.heads[0]!.displayedVersion).toEqual(displayed);
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket,
          expected_head_id: selected.heads[0]!.id }] }));
    expect(archived).toMatchObject({ target, mode: "real" });
    expect(archived.events.map((event) => [event.facet, event.state])).toEqual([
      ["archive", "active"], ["selection", "inactive"],
    ]);
    expect(archived.heads.map((head) => head.id).sort()).toEqual(
      archived.events.map((event) => event.id).sort());
    expect(await lotEventCount(f)).toBe(3);
  });

  it("should return no appended events with the retained head for an unchanged command", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }));
    const before = await lotEventCount(f);
    const command: LotCommand = { ...lotCommand(target, displayed,
      { action: "set_pipeline", status: "sollicite" }),
    expected_head_id: first.heads[0]!.id, command_key: randomUUID() };
    const repeated = await writeLotFacet(
      f.db, f.contributor.sub, f.workspaceId, "workspace", command);
    expect(repeated.events).toHaveLength(0);
    expect(repeated.heads.map((head) => head.id)).toEqual(
      first.heads.map((head) => head.id));
    expect(await lotEventCount(f)).toBe(before);
  });

  it("should return per-item events and heads for batch commands", async () => {
    const f = await lotFixture();
    const first = await displayedFor(f, 0);
    const second = await displayedFor(f, 1);
    const key = randomUUID();
    const batch = { contract_version: "lot-facets-v1" as const, command_key: key,
      mode: "real" as const,
      items: [
        { target: first.target, displayed_version: first.displayed,
          expected_head_id: null,
          mutation: { action: "select", basket_id: f.selectionBasket } as const },
        { target: second.target, displayed_version: second.displayed,
          expected_head_id: null,
          mutation: { action: "set_pipeline", status: "sollicite" } as const },
      ] };
    const result = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch);
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.mode).toBe("real");
      expect(item.appended).toBe(true);
      expect(item.events).toHaveLength(1);
      expect(item.heads.map((head) => head.id)).toEqual(
        item.events.map((event) => event.id));
    }
    expect(result).toMatchObject({ targets: 2, changed: 2, eventsAppended: 2 });
    const replayed = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch);
    expect(replayed).toEqual(result);
  });
});

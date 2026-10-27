// 6J lot command results: full §3.7 outcomes with appended events and
// affected heads, including composite discards, no-ops, and batch items.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotVersions } from "../../../db/schema.js";
import { writeLotBatch } from "./lot-batch.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";
import type { LotBatchCommand, LotCommand } from "./lot-commands.js";

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

  it("should return every targeted head when a composite discard changes nothing", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket,
          expected_head_id: selected.heads[0]!.id }] }));
    const archiveHead = archived.heads.find((head) => head.facet === "archive")!;
    const selectionHead = archived.heads.find((head) => head.facet === "selection")!;
    const before = await lotEventCount(f);
    const repeat = (key: string): LotCommand => ({ ...lotCommand(target, displayed,
      { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket,
          expected_head_id: selectionHead.id }] }, archiveHead.id), command_key: key });
    const key = randomUUID();
    const noop = await writeLotFacet(
      f.db, f.moderator.sub, f.workspaceId, "workspace", repeat(key));
    expect(noop.events).toEqual([]);
    expect.soft(noop.heads.map((head) => head.id)).toEqual([archiveHead.id, selectionHead.id]);
    expect(await lotEventCount(f)).toBe(before);
    expect(await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace", repeat(key)))
      .toEqual(noop);
    const batchKey = randomUUID();
    const batch: LotBatchCommand = {
      contract_version: "lot-facets-v1", command_key: batchKey, mode: "real",
      items: [{ target, displayed_version: displayed, expected_head_id: archiveHead.id,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket,
            expected_head_id: selectionHead.id }] } as const }] };
    const batched = await writeLotBatch(
      f.db, f.moderator.sub, f.workspaceId, "workspace", batch);
    expect(batched).toMatchObject({ targets: 1, changed: 0, unchanged: 1, eventsAppended: 0 });
    expect(batched.items[0]!.events).toEqual([]);
    expect.soft(batched.items[0]!.heads.map((head) => head.id))
      .toEqual([archiveHead.id, selectionHead.id]);
    expect(await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch))
      .toEqual(batched);
    expect(await lotEventCount(f)).toBe(before);
  });

  it.each(["single", "batch"])("should keep an unchanged archive head when only a deselection changes (%s)", async (transport) => {
    const f = await lotFixture();
    const first = await displayedFor(f);
    const target = first.target;
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, first.displayed, { action: "select", basket_id: f.selectionBasket }));
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, first.displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket,
          expected_head_id: selected.heads[0]!.id }] }));
    const archiveHead = archived.heads.find((head) => head.facet === "archive")!;
    const retiredSelection = archived.heads.find((head) => head.facet === "selection")!;
    const reselected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, first.displayed,
        { action: "select", basket_id: f.selectionBasket }, retiredSelection.id));
    await f.db.update(lotVersions).set({ rawRef: "synthetic-6j-revised" })
      .where(eq(lotVersions.id, first.displayed.lot_version_id));
    const { displayed } = await displayedFor(f);
    expect(displayed.fingerprint).not.toBe(first.displayed.fingerprint);
    const before = await lotEventCount(f);
    const command = lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
      deselect: [{ basket_id: f.selectionBasket,
        expected_head_id: reselected.heads[0]!.id }] }, archiveHead.id);
    const batch: LotBatchCommand = { contract_version: "lot-facets-v1",
      command_key: command.command_key, mode: command.mode, items: [command] };
    const batched = transport === "batch"
      ? await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch) : null;
    if (batched) {
      expect.soft(batched).toMatchObject({ targets: 1, changed: 1, unchanged: 0, eventsAppended: 1 });
      expect(await writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch))
        .toEqual(batched);
    }
    const composite = batched ? batched.items[0]!
      : await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace", command);
    expect.soft(composite.events.map((event) => [event.facet, event.state]))
      .toEqual([["selection", "inactive"]]);
    expect.soft(composite.heads.map((head) => head.id).sort())
      .toEqual([archiveHead.id, composite.events[0]!.id].sort());
    expect.soft(await lotEventCount(f)).toBe(before + 1);
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect.soft(state.archive.workspace!.id).toBe(archiveHead.id);
    expect.soft(state.archive.workspace!.changedSinceArchive).toBe(true);
  });
});

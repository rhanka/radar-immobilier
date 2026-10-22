// 6J lot history: paginated destination events and preserved source chains.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { resolveLotSource } from "./lot-target.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotCity } from "./lot-city.js";
import { readLotHistory } from "./lot-history.js";
import {
  describeDb,
  lotFixture,
  type LotFixture,
} from "./lot-fixture.js";
import type { LotCommand, LotMutation } from "./lot-commands.js";

async function displayedFor(f: LotFixture, index = 0) {
  const target = { type: "Lot" as const, authority: "lot_versions" as const,
    citySlug: "synthetic-6j-city",
    canonicalId: ["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"][index]! };
  return { target, displayed: (await resolveLotSource(f.db, target)).displayed };
}

function command(
  target: Awaited<ReturnType<typeof displayedFor>>["target"],
  displayed: Awaited<ReturnType<typeof displayedFor>>["displayed"],
  mutation: LotMutation,
  expected_head_id: string | null = null,
): LotCommand {
  return {
    contract_version: "lot-facets-v1",
    command_key: randomUUID(),
    mode: "real",
    target,
    displayed_version: displayed,
    expected_head_id,
    mutation,
  };
}

describeDb("6J lot history", () => {
  it("should navigate destination events newest-first with opaque offsets", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      command(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      command(target, displayed, { action: "set_pipeline", status: "sollicite" }));
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      command(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket,
          expected_head_id: selected.heads[0]!.id }] }));
    const first = await readLotHistory(
      f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 2);
    // Composite events share a transaction timestamp; UUID breaks the tie.
    expect(first.events).toHaveLength(2);
    expect(first.events.map((event) => event.id)).toContain(archived.heads[0]!.id);
    expect(first.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: "selection", state: "inactive" }),
      expect.objectContaining({ facet: "archive", state: "active" }),
    ]));
    expect(first.nextOffset).toBe(2);
    const second = await readLotHistory(
      f.db, f.contributor.sub, f.workspaceId, "real", target, 2, 2);
    expect(second.events).toHaveLength(2);
    expect(second.nextOffset).toBeNull();
    const all = [...first.events, ...second.events];
    expect(new Set(all.map((event) => event.id)).size).toBe(4);
  });

  it("should reject invalid pages and outsiders", async () => {
    const f = await lotFixture();
    const { target } = await displayedFor(f);
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, -1, 20))
      .rejects.toMatchObject({ status: 400 });
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 101))
      .rejects.toMatchObject({ status: 400 });
    await expect(readLotHistory(f.db, f.outsider.sub, f.workspaceId, "real", target, 0, 20))
      .rejects.toMatchObject({ status: 403 });
  });

  it("should project one collection row per target for map indicators", async () => {
    const f = await lotFixture();
    for (const index of [0, 1]) {
      const { target, displayed } = await displayedFor(f, index);
      await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
        command(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    }
    const projection = await readLotCity(
      f.db, f.contributor.sub, f.workspaceId, "real", "synthetic-6j-city");
    expect(projection.heads.map((head) => head.target.canonicalId)).toEqual([
      "lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02",
    ]);
    expect(projection.heads[0]!.selection.map((head) => head.state)).toEqual(["active"]);
    expect(projection.heads[0]!.archive.effectiveDiscarded).toBe(false);
  });
});

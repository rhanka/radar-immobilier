// 6J duplicate deselect expectations: baskets repeated in one discard
// must conflict instead of silently keeping the last expectation.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeLotBatch } from "./lot-batch.js";
import { writeLotFacet } from "./lot-writer.js";
import type { LotCommandItem } from "./lot-commands.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6J duplicate deselect expectations", () => {
  it.each(["stale-first", "current-first"] as const)(
    "should reject contradictory %s duplicates without mutating", async (order) => {
      const f = await lotFixture();
      const { target, displayed } = await displayedFor(f);
      const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
        "workspace", lotCommand(target, displayed,
          { action: "select", basket_id: f.selectionBasket }));
      const stale = randomUUID();
      const current = selected.heads[0]!.id;
      const first = order === "stale-first" ? stale : current;
      const second = order === "stale-first" ? current : stale;
      const before = await lotEventCount(f);
      await expect(writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
        lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
          deselect: [
            { basket_id: f.selectionBasket, expected_head_id: first },
            { basket_id: f.selectionBasket, expected_head_id: second },
          ] })))
        .rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
      expect(await lotEventCount(f)).toBe(before);
    });

  it.each(["stale-first", "current-first"] as const)(
    "should reject contradictory %s duplicates inside batch items", async (order) => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
      "workspace", lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }));
    const stale = randomUUID();
    const current = selected.heads[0]!.id;
    const duplicate: LotCommandItem = {
      target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "discard", reasonCode: "N-NON-RES",
        deselect: [
          { basket_id: f.selectionBasket,
            expected_head_id: order === "stale-first" ? stale : current },
          { basket_id: f.selectionBasket,
            expected_head_id: order === "stale-first" ? current : stale },
        ] },
    };
    const before = await lotEventCount(f);
    await expect(writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace",
      { contract_version: "lot-facets-v1", command_key: randomUUID(),
        mode: "real", items: [duplicate] }))
      .rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
    expect(await lotEventCount(f)).toBe(before);
  });
});

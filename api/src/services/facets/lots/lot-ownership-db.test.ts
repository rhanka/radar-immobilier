// 6J lot ownership and access: no property is ever derived from
// `author_id`; outsiders stay outside reads and writes.
import { expect, it } from "vitest";
import { facetEvents } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import type { LotMutation } from "./lot-commands.js";

describeDb("6J lot ownership and access", () => {
  it("should refuse archive commands with omitted reasons", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace", {
      ...lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }),
      mutation: { action: "discard" } as unknown as LotMutation,
    })).rejects.toMatchObject({ status: 422 });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", {
      ...lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "10.00", listing_url: null }),
      mutation: { action: "set_market", status: "en_vente",
        asking_price: "10.00" } as unknown as LotMutation,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("should never derive ownership from documentary author values", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    const rows = await f.db.select().from(facetEvents);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      if (row.scope === "workspace") expect(row.ownerId).toBeNull();
      else expect(row.ownerId).toBe(f.contributor.id);
      expect(row.sourceAuthor).toBeNull();
      expect(row.actorId).not.toBe("author-synthetic-1");
    }
  });

  it("should refuse outsiders on reads and writes", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.outsider.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 403 });
    await expect(readLotState(f.db, f.outsider.sub, f.workspaceId, "real", target))
      .rejects.toMatchObject({ status: 403 });
  });
});

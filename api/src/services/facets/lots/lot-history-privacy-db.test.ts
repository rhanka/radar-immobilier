import { expect, it } from "vitest";
import { readLotHistory } from "./lot-history.js";
import { writeLotFacet } from "./lot-writer.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

describeDb("6J history visibility", () => {
  it("should paginate authorized events before counting offsets", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const privateHead = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "restore" }, privateHead.heads[0]!.id));
    const page = await readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 1);
    expect(page.events.map((event) => event.id)).toEqual([selected.heads[0]!.id]);
    expect(page.nextOffset).toBeNull();
  });
});

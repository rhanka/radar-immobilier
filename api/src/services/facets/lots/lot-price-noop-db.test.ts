// 6J canonical price no-ops: textually different but numerically equal
// asking prices must not append transitions or inflate counters.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { resolveLotSource } from "./lot-target.js";
import { writeLotBatch } from "./lot-batch.js";
import { writeLotFacet } from "./lot-writer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6J canonical price no-ops", () => {
  it("should treat equal prices spelled differently as unchanged", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const spellings = ["10", "10", "10.00", "0010.0", "10.0"];
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: spellings[0]!, listing_url: null }));
    expect(first.events[0]!.askingPrice).toBe("10.00");
    for (const spelling of spellings.slice(1)) {
      const before = await lotEventCount(f);
      const repeated = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
        "workspace", { ...lotCommand(target, displayed,
          { action: "set_market", status: "en_vente", asking_price: spelling,
            listing_url: null }),
        expected_head_id: first.heads[0]!.id, command_key: randomUUID() });
      expect(repeated.events).toHaveLength(0);
      expect(repeated.heads.map((head) => head.id)).toEqual(
        first.heads.map((head) => head.id));
      expect(await lotEventCount(f)).toBe(before);
    }
  });

  it("should recognize price no-ops inside batches", async () => {
    const f = await lotFixture();
    const lots = [await displayedFor(f, 0), await displayedFor(f, 1)];
    const key = randomUUID();
    const items = lots.map(({ target, displayed }) => ({ target,
      displayed_version: displayed, expected_head_id: null,
      mutation: { action: "set_market", status: "en_vente", asking_price: "10.5",
        listing_url: null } as const }));
    const result = await writeLotBatch(f.db, f.contributor.sub, f.workspaceId,
      "workspace", { contract_version: "lot-facets-v1", command_key: key,
        mode: "real", items });
    expect(result).toMatchObject({ targets: 2, changed: 2, eventsAppended: 2 });
    expect(result.items.flatMap((item) => item.events.map((event) => event.askingPrice)))
      .toEqual(["10.50", "10.50"]);
    const repeated = await writeLotBatch(f.db, f.contributor.sub, f.workspaceId,
      "workspace", { contract_version: "lot-facets-v1", command_key: randomUUID(),
        mode: "real",
        items: lots.map(({ target, displayed }, index) => ({ target,
          displayed_version: displayed,
          expected_head_id: result.items[index]!.heads[0]!.id,
          mutation: { action: "set_market", status: "en_vente", asking_price: "010.50",
            listing_url: null } as const })) });
    expect(repeated).toMatchObject({ targets: 2, changed: 0, unchanged: 2,
      eventsAppended: 0 });
    expect(await lotEventCount(f)).toBe(2);
  });

  it("should still append when the canonical price changes", async () => {
    const f = await lotFixture();
    const { target } = await displayedFor(f);
    const resolved = await resolveLotSource(f.db, target);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, resolved.displayed, { action: "set_market", status: "en_vente",
        asking_price: "10", listing_url: null }));
    const changed = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
      "workspace", { ...lotCommand(target, resolved.displayed,
        { action: "set_market", status: "en_vente", asking_price: "10.51",
          listing_url: null }),
      expected_head_id: first.heads[0]!.id, command_key: randomUUID() });
    expect(changed.events).toHaveLength(1);
    expect(changed.events[0]!.askingPrice).toBe("10.51");
    expect(await lotEventCount(f)).toBe(2);
  });
});

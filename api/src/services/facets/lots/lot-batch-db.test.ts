// 6J atomic lot batch: all-or-nothing commits, exact replay, key conflicts.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEvents } from "../../../db/schema.js";
import { resolveLotSource } from "./lot-target.js";
import { setLotCapability } from "./lot-capabilities.js";
import { writeLotBatch } from "./lot-batch.js";
import type { LotBatchCommand, LotCommandItem } from "./lot-commands.js";
import {
  describeDb,
  lotFixture,
  type LotFixture,
} from "./lot-fixture.js";

async function itemsFor(f: LotFixture, indexes: number[]): Promise<LotCommandItem[]> {
  return Promise.all(indexes.map(async (index, position) => {
    const canonicalId = ["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"][index]!;
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId };
    const displayed = (await resolveLotSource(f.db, target)).displayed;
    const actions = [
      { action: "select", basket_id: f.selectionBasket },
      { action: "set_pipeline", status: "sollicite" },
      { action: "set_market", status: "en_vente", asking_price: "75000.50",
        listing_url: "https://synthetic.invalid/annonce/6j" },
    ] as const;
    return {
      target,
      displayed_version: displayed,
      expected_head_id: null,
      mutation: actions[position % actions.length]!,
    };
  }));
}

function batch(items: LotCommandItem[], key = randomUUID()): LotBatchCommand {
  return {
    contract_version: "lot-facets-v1",
    command_key: key,
    mode: "real",
    items,
  };
}

async function eventCount(f: LotFixture): Promise<number> {
  return (await f.db.select({ id: facetEvents.id }).from(facetEvents)).length;
}

describeDb("6J atomic lot batch", () => {
  it("should commit every item atomically with per-item results", async () => {
    const f = await lotFixture();
    const result = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch(await itemsFor(f, [0, 1])));
    expect(result.targets).toBe(2);
    expect(result.changed).toBe(2);
    expect(result.unchanged).toBe(0);
    expect(result.eventsAppended).toBe(2);
    expect(result.items.map((item) => item.appended)).toEqual([true, true]);
    expect(await eventCount(f)).toBe(2);
  });

  it("should roll back every item when one version conflicts", async () => {
    const f = await lotFixture();
    const items = await itemsFor(f, [0, 1]);
    const tampered = { ...items[1]!,
      displayed_version: { ...items[1]!.displayed_version, fingerprint: "c".repeat(64) } };
    const before = await eventCount(f);
    const failure = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch([items[0]!, tampered]))
      .then(() => { throw new Error("expected target_version_conflict"); }, (error) => error);
    expect(failure).toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(failure.current.target.canonicalId).toBe("lot-canonical-syn-6j-02");
    expect(await eventCount(f)).toBe(before);
  });

  it("should roll back every item when one head conflicts", async () => {
    const f = await lotFixture();
    const items = await itemsFor(f, [0, 1]);
    const stale = { ...items[0]!,
      expected_head_id: "6a000000-0000-4000-8000-000000000099" };
    const before = await eventCount(f);
    await expect(writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch([stale, items[1]!])))
      .rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
    expect(await eventCount(f)).toBe(before);
  });

  it("should roll back every item when one right is missing", async () => {
    const f = await lotFixture();
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      capability: "lot_pipeline", granted: false, reason: "synthetic batch check",
      expectedRevision: 1 });
    const before = await eventCount(f);
    await expect(writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch(await itemsFor(f, [0, 1]))))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    expect(await eventCount(f)).toBe(before);
  });

});

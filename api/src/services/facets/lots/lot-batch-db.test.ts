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

  it("should reject duplicate native targets, empty batches, and oversized batches", async () => {
    const f = await lotFixture();
    const items = await itemsFor(f, [0]);
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace",
      batch([items[0]!, { ...items[0]!, mutation: { action: "clear_pipeline" } }])))
      .rejects.toMatchObject({ status: 400 });
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", batch([])))
      .rejects.toMatchObject({ status: 400 });
    const many = Array.from({ length: 501 }, (_, position) => ({
      ...items[0]!,
      target: { ...items[0]!.target, canonicalId: `lot-canonical-syn-6j-${position}` },
    }));
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", batch(many)))
      .rejects.toMatchObject({ status: 400 });
    expect(await eventCount(f)).toBe(0);
  });

  it("should roll back an appended item when a later reason is invalid", async () => {
    const f = await lotFixture();
    const items = await itemsFor(f, [0, 1]);
    items[1]!.mutation = { action: "discard", reasonCode: "N-UNKNOWN" };
    await expect(writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", batch(items)))
      .rejects.toMatchObject({ status: 422, message: "invalid_reason_code" });
    expect(await eventCount(f)).toBe(0);
    for (const table of ["facet_streams", "facet_event_bindings", "facet_heads", "facet_commands",
      "facet_command_contexts"]) {
      expect((await f.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
    }
  });

  it("should report no events for an unchanged batch with a new key", async () => {
    const f = await lotFixture();
    const items = await itemsFor(f, [0, 1]);
    const first = await writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", batch(items));
    for (const item of items) {
      item.expected_head_id = first.items.find((result) =>
        result.target.canonicalId === item.target.canonicalId)!.heads[0]!.id;
    }
    const result = await writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", batch(items));
    expect(result).toMatchObject({ targets: 2, changed: 0, unchanged: 2, eventsAppended: 0 });
    expect(await eventCount(f)).toBe(2);
  });

  it("should replay exact batches without appending and reject reused keys", async () => {
    const f = await lotFixture();
    const key = randomUUID();
    const first = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch(await itemsFor(f, [0]), key));
    const before = await eventCount(f);
    const replayed = await writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch(await itemsFor(f, [0]), key));
    expect(replayed).toEqual(first);
    expect(await eventCount(f)).toBe(before);
    await expect(writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "workspace", batch(await itemsFor(f, [1]), key)))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  });

  it("should restrict personal batches to archive and restoration", async () => {
    const f = await lotFixture();
    await expect(writeLotBatch(
      f.db, f.contributor.sub, f.workspaceId, "personal", batch(await itemsFor(f, [0]))))
      .rejects.toMatchObject({ status: 400 });
    expect(await eventCount(f)).toBe(0);
  });

  it("should refuse batch writes while the destination gate is closed", async () => {
    const f = await lotFixture();
    await expect(writeLotBatch(
      f.db, f.contributor.sub, f.otherId, "workspace", batch(await itemsFor(f, [0]))))
      .rejects.toMatchObject({ status: 503 });
  });
});

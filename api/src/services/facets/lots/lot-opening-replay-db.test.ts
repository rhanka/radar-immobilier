// B2 replay and batch boundaries through the opening guard.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lotCutoverState, lotDestinationState, lotVersions } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { resolveLotSource } from "./lot-target.js";
import { setLotCapability } from "./lot-capabilities.js";
import type { LotCommandItem } from "./lot-commands.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("B2 lot replay and batch boundaries", () => {
  it("should replay exact keys byte-identically without mutating", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const key = randomUUID();
    const base = { ...lotCommand(target, displayed,
      { action: "set_pipeline", status: "sollicite" as const }), command_key: key };
    const created = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", base);
    const before = await lotEventCount(f);
    expect(await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", base))
      .toEqual(created);
    expect(await lotEventCount(f)).toBe(before);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      { ...base, mutation: { action: "clear_pipeline" as const } }))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  });

  it("should conflict on stale heads and same-UUID content changes", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const before = await lotEventCount(f);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "deselect", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
    await f.db.update(lotVersions).set({ rawRef: "synthetic-6j-revised-b2" })
      .where(eq(lotVersions.id, displayed.lot_version_id));
    const conflict = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" as const }))
      .catch((error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(conflict.current.version.lot_version_id).toBe(displayed.lot_version_id);
    expect(conflict.current.version.fingerprint).not.toBe(displayed.fingerprint);
    expect(await lotEventCount(f)).toBe(before);
    expect(first.heads[0]!.id).toBeDefined();
  });

  it("should bind keys to their workspace and keep batches atomic", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const key = randomUUID();
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      { ...lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }), command_key: key });
    await f.db.insert(lotDestinationState).values({ workspaceId: f.otherId,
      enabled: true, selectionBasket: f.selectionBasket });
    await f.db.insert(lotCutoverState).values({ workspaceId: f.otherId,
      maintenanceBarrier: true, destinationOpen: true });
    await setLotCapability(f.db, { workspaceId: f.otherId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      capability: "lot_select", granted: true, reason: "synthetic cross-workspace grant",
      expectedRevision: null });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.otherId, "workspace",
      { ...lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }), command_key: key }))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    const second = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-02" };
    const secondDisplayed = (await resolveLotSource(f.db, second)).displayed;
    const items: LotCommandItem[] = [
      { target, displayed_version: displayed, expected_head_id: selected.heads[0]!.id,
        mutation: { action: "select", basket_id: f.selectionBasket } },
      { target: second, displayed_version: { ...secondDisplayed, fingerprint: "d".repeat(64) },
        expected_head_id: null, mutation: { action: "select", basket_id: f.selectionBasket } },
    ];
    const before = await lotEventCount(f);
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace",
      { contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real", items }))
      .rejects.toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(await lotEventCount(f)).toBe(before);
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace",
      { contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real", items: [] }))
      .rejects.toMatchObject({ status: 400 });
    expect(await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub, capability: "lot_select",
      granted: true, reason: "synthetic re-grant", expectedRevision: 1 }))
      .toMatchObject({ granted: true });
  });
});

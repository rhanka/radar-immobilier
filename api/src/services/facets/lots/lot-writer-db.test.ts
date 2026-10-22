// 6J lot writer: four independent facets, head and version conflicts.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lotVersions } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6J lot writer families", () => {
  it("should keep selection, pipeline, market, and archive independent", async () => {
    const f = await lotFixture();
    const basket = f.selectionBasket;
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: basket }));
    expect(selected.events[0]).toMatchObject({ facet: "selection", state: "active", basket });
    const solicited = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }));
    expect(solicited.events[0]).toMatchObject({ facet: "pipeline", state: "active",
      pipelineStatus: "sollicite" });
    const market = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "250000.00", listing_url: "https://synthetic.invalid/annonce/1" }));
    expect(market.events[0]).toMatchObject({ askingPrice: "250000.00",
      listingUrl: "https://synthetic.invalid/annonce/1" });
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    expect(archived.events[0]).toMatchObject({ facet: "archive", state: "active" });
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.selection.map((head) => head.state)).toEqual(["active"]);
    expect(state.pipeline).toMatchObject({ state: "active", pipelineStatus: "sollicite" });
    expect(state.market).toMatchObject({ askingPrice: "250000.00" });
    expect(state.archive.effectiveDiscarded).toBe(true);
    expect(state.capabilities).toEqual({ select: true, changePipeline: true,
      changeMarket: true, discardPersonally: true, moderateArchive: false });
    const restored = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "restore" }, archived.heads[0]!.id));
    expect(restored.events[0]).toMatchObject({ state: "inactive" });
    const visible = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(visible.archive.effectiveDiscarded).toBe(false);
    expect(visible.selection.map((head) => head.state)).toEqual(["active"]);
    expect(visible.pipeline).toMatchObject({ pipelineStatus: "sollicite" });
    expect(visible.market).toMatchObject({ askingPrice: "250000.00" });
  });

  it("should conflict on a stale head without leaking private attribution", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const before = await lotEventCount(f);
    const conflict = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "deselect", basket_id: f.selectionBasket }))
      .then(() => { throw new Error("expected facet_head_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "facet_head_conflict" });
    expect(conflict.current.heads.map((head: { id: string }) => head.id))
      .toEqual([first.heads[0]!.id]);
    for (const head of conflict.current.heads) {
      expect(head).not.toHaveProperty("actorId");
      expect(head).not.toHaveProperty("ownerId");
      expect(head).not.toHaveProperty("commandDigest");
    }
    expect(await lotEventCount(f)).toBe(before);
  });

  it("should conflict on displayed source changes without mutating", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    await f.db.update(lotVersions).set({ rawRef: "synthetic-6j-revised" })
      .where(eq(lotVersions.id, displayed.lot_version_id));
    const before = await lotEventCount(f);
    const conflict = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }))
      .then(() => { throw new Error("expected target_version_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(conflict.current.version.lot_version_id).toBe(displayed.lot_version_id);
    expect(conflict.current.version.fingerprint).not.toBe(displayed.fingerprint);
    expect(await lotEventCount(f)).toBe(before);
  });

  it("should refuse an ambiguous lot identity without selecting a version", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    // Model a corrupt restored source in this disposable database only.
    await f.pool.query("ALTER TABLE lot_versions DROP CONSTRAINT lot_versions_no_overlap");
    await f.db.insert(lotVersions).values({
      id: randomUUID(), canonicalId: target.canonicalId, noLot: target.canonicalId,
      citySlug: target.citySlug, reconStatus: "validated",
      validFrom: "2025-01-01", knownFrom: new Date("2025-01-01T00:00:00.000Z"),
      rawRef: "synthetic-6j-duplicate",
    });
    const before = await lotEventCount(f);
    const failure = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }))
      .then(() => { throw new Error("expected lot_identity_unresolved"); }, (error) => error);
    expect(failure).toMatchObject({ status: 409, message: "lot_identity_unresolved" });
    expect(await lotEventCount(f)).toBe(before);
  });
});

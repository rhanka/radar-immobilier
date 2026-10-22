// 6J D4 rights: distinct selection, pipeline, and market capabilities,
// moderator-only common archive, and archive independence.
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { facetEvents } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { setLotCapability } from "./lot-capabilities.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import type { LotMutation } from "./lot-commands.js";

describeDb("6J lot D4 rights", () => {
  it("should refuse common archive and restoration to contributors", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" })))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    expect(archived).toMatchObject({ facet: "archive", state: "active" });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "restore" }, archived!.id)))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    const stored = await f.db.select().from(facetEvents)
      .where(eq(facetEvents.id, archived!.id));
    expect(stored[0]).toMatchObject({ scope: "workspace", ownerId: null,
      actorId: f.moderator.id, reasonCode: "N-NON-RES" });
  });

  it("should keep personal restoration without effect on the workspace archive", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    const common = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    const personal = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(personal.archive.personal).toMatchObject({ state: "active" });
    const restored = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "restore" }, personal.archive.personal!.id));
    expect(restored).toMatchObject({ state: "inactive" });
    const stillHidden = await readLotState(
      f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(stillHidden.archive.personal).toMatchObject({ state: "inactive" });
    expect(stillHidden.archive.workspace).toMatchObject({ id: common!.id, state: "active" });
    expect(stillHidden.archive.effectiveDiscarded).toBe(true);
  });

  it("should keep workspace restoration without effect on personal hiding", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const personal = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    const common = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "restore" }, common!.id));
    const view = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(view.archive.personal).toMatchObject({ id: personal!.id, state: "active" });
    expect(view.archive.effectiveDiscarded).toBe(true);
  });

  it("should enforce each D4 right independently", async () => {
    const cases = [
      { capability: "lot_select" as const,
        mutation: { action: "select", basket_id: "synthetic-historical-favorites" } as LotMutation },
      { capability: "lot_pipeline" as const,
        mutation: { action: "set_pipeline", status: "sollicite" } as LotMutation },
      { capability: "lot_market" as const,
        mutation: { action: "set_market", status: "en_vente",
          asking_price: "10.00", listing_url: null } as LotMutation },
    ] as const;
    for (const { capability, mutation } of cases) {
      const f = await lotFixture();
      const { target, displayed } = await displayedFor(f);
      await setLotCapability(f.db, { workspaceId: f.workspaceId,
        targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
        capability, granted: false, reason: "synthetic independent check",
        expectedRevision: 1 });
      await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
        lotCommand(target, displayed, { ...mutation })))
        .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    }
  });

  it("should require moderation plus selection for composite discard", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }));
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.moderator.id, actorSub: f.moderator.sub,
      capability: "lot_select", granted: false, reason: "synthetic composite check",
      expectedRevision: 1 });
    await expect(writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket, expected_head_id: selected!.id }] })))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
  });
});

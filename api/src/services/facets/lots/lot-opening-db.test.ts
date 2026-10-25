// B2 opening: public services stay closed without an open destination.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lotCutoverState } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { readLotCity } from "./lot-city.js";
import { readLotHistory, readLotSourceHistory } from "./lot-history.js";
import { setLotCapability } from "./lot-capabilities.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

async function closeDestination(f: Awaited<ReturnType<typeof lotFixture>>) {
  await f.db.update(lotCutoverState).set({ destinationOpen: false })
    .where(eq(lotCutoverState.workspaceId, f.workspaceId));
}

describeDb("B2 lot opening in services", () => {
  it("should serve reads and writes while the destination stays open", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const written = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(written.events[0]).toMatchObject({ facet: "selection", state: "active" });
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.selection.map((head) => head.state)).toEqual(["active"]);
    const city = await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", target.citySlug);
    expect(city.heads.map((head) => head.target.canonicalId)).toContain(target.canonicalId);
    const history = await readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 20);
    expect(history.events.length).toBeGreaterThan(0);
  });

  it("should return no business state, history or receipt once closed", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const key = randomUUID();
    const command = { ...lotCommand(target, displayed,
      { action: "set_pipeline", status: "sollicite" as const }), command_key: key };
    const created = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", command);
    const before = await lotEventCount(f);
    await closeDestination(f);
    await expect(readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target))
      .rejects.toMatchObject({ status: 503, message: `lot_destination_disabled:${f.workspaceId}` });
    await expect(readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", target.citySlug))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 20))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotSourceHistory(f.db, f.contributor.sub, f.workspaceId, "chain-syn-1", 0, 20))
      .rejects.toMatchObject({ status: 503 });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 503 });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", command))
      .rejects.toMatchObject({ status: 503 });
    expect(await lotEventCount(f)).toBe(before);
    expect(created.events[0]).toMatchObject({ facet: "pipeline" });
  });

  it("should stay closed without cutover state and enforce revocation while open", async () => {
    const f = await lotFixture();
    await f.db.delete(lotCutoverState).where(eq(lotCutoverState.workspaceId, f.workspaceId));
    const { target } = await displayedFor(f);
    await expect(readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target))
      .rejects.toMatchObject({ status: 503 });
    const reopened = await lotFixture();
    const shown = await displayedFor(reopened);
    await setLotCapability(reopened.db, { workspaceId: reopened.workspaceId,
      targetAccountId: reopened.contributor.id, actorSub: reopened.moderator.sub,
      capability: "lot_select", granted: false, reason: "synthetic revocation",
      expectedRevision: 1 });
    await expect(writeLotFacet(reopened.db, reopened.contributor.sub, reopened.workspaceId,
      "workspace", lotCommand(shown.target, shown.displayed,
        { action: "select", basket_id: reopened.selectionBasket })))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    const kept = await writeLotFacet(reopened.db, reopened.contributor.sub, reopened.workspaceId,
      "workspace", lotCommand(shown.target, shown.displayed,
        { action: "set_pipeline", status: "sollicite" }));
    expect(kept.events[0]).toMatchObject({ facet: "pipeline", state: "active" });
  });
});

// 6J lot writer: exact replay, no-op shortcuts, concurrency, composites.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { setLotCapability } from "./lot-capabilities.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6J lot writer replay and composition", () => {
  it("should replay exact keys and reject reused keys with different payloads", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const key = randomUUID();
    const base = { ...lotCommand(target, displayed,
      { action: "set_pipeline", status: "sollicite" }), command_key: key };
    const created = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", base);
    const before = await lotEventCount(f);
    expect(await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", base))
      .toEqual(created);
    expect(await lotEventCount(f)).toBe(before);
    const reused = { ...base, mutation: { action: "clear_pipeline" as const } };
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", reused))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  });

  it("should treat an unchanged command as a no-op without appending", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "10.00", listing_url: null }));
    const before = await lotEventCount(f);
    const repeated = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "10.00", listing_url: null }, first!.id));
    expect(repeated!.id).toBe(first!.id);
    expect(await lotEventCount(f)).toBe(before);
  });

  it("should serialize concurrent first writes into one success and one conflict", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const attempts = await Promise.allSettled([0, 1].map(() =>
      writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
        lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }))));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await lotEventCount(f)).toBe(1);
  });

  it("should retire selected baskets on composite discard and never restore them", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket, expected_head_id: selected!.id }] }));
    expect(archived).toMatchObject({ facet: "archive", state: "active" });
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.selection.map((head) => head.state)).toEqual(["inactive"]);
    const restored = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "restore" }, archived!.id));
    expect(restored).toMatchObject({ state: "inactive" });
    const visible = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(visible.selection.map((head) => head.state)).toEqual(["inactive"]);
  });

  it("should keep real and simulation streams independent", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const simulation = { ...lotCommand(target, displayed,
      { action: "select", basket_id: f.selectionBasket }), mode: "simulation" as const };
    const simulated = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId,
      "workspace", simulation);
    expect(simulated).toMatchObject({ state: "active" });
    const realState = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    const simulationState = await readLotState(
      f.db, f.contributor.sub, f.workspaceId, "simulation", target);
    expect(realState.selection).toHaveLength(1);
    expect(simulationState.selection).toHaveLength(1);
    expect(realState.selection[0]!.id).not.toBe(simulationState.selection[0]!.id);
  });

  it("should revoke one D4 right without touching the others", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      capability: "lot_market", granted: false, reason: "synthetic revocation",
      expectedRevision: 1 });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "10.00", listing_url: null })))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(selected).toMatchObject({ state: "active" });
  });
});

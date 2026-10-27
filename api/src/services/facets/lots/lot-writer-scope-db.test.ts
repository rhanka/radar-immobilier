// 6J lot writer scope: import-only provenance, forged fields, personal
// scope, and the closed destination gate.
import { expect, it } from "vitest";
import { writeLotFacet } from "./lot-writer.js";
import { readLotState } from "./lot-reader.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import type { LotMutation } from "./lot-commands.js";

describeDb("6J lot writer scope", () => {
  it("should reject import-only provenance on ordinary commands", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "legacy-unknown" })))
      .rejects.toMatchObject({ status: 422 });
    await expect(writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace", {
      ...lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }),
      mutation: { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: "other-basket", expected_head_id: null }] },
    })).rejects.toMatchObject({ status: 400 });
  });

  it("should refuse client-supplied actor and owner fields", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const forged = lotCommand(target, displayed, {
      action: "select", basket_id: f.selectionBasket, actor: "synthetic-forged",
    } as unknown as LotMutation);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", forged))
      .rejects.toMatchObject({ status: 400, message: "invalid_facet_command" });
  });

  it("should restrict personal scope to archive and restoration", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 400 });
    const archived = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES" }));
    expect(archived.events[0]).toMatchObject({ facet: "archive", state: "active" });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "personal",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: f.selectionBasket, expected_head_id: null }] })))
      .rejects.toMatchObject({ status: 400 });
  });

  it("should stay unavailable while the destination gate is closed", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await expect(writeLotFacet(f.db, f.contributor.sub, f.otherId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 503,
        message: expect.stringMatching(/^lot_destination_disabled/) });
    await expect(readLotState(f.db, f.contributor.sub, f.otherId, "real", target))
      .rejects.toMatchObject({ status: 503 });
  });
});

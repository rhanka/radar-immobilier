// Stored receipts never bypass current opening, approval or authority.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { accountUsers, lotCutoverState } from "../../../db/schema.js";
import { revokeMembership } from "../../workspaces/mutations.js";
import { setLotCapability } from "./lot-capabilities.js";
import { writeLotFacet } from "./lot-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";

describeDb("B2 stored receipt authority", () => {
  it.each(["single", "batch"] as const)(
    "should reject closed and revoked %s replays after the original command", async (kind) => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const command = lotCommand(target, displayed,
      { action: "select", basket_id: f.selectionBasket });
    const batch = { contract_version: "lot-facets-v1" as const, command_key: randomUUID(),
      mode: "real" as const, items: [command] };
    const replay = () => kind === "single"
      ? writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", command)
      : writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", batch);
    const original = await replay();
    const snapshot = () => Promise.all(["facet_events", "facet_streams", "facet_heads",
      "facet_event_bindings", "facet_commands", "facet_command_contexts"].map(async (table) =>
      (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    expect(JSON.stringify(await replay())).toBe(JSON.stringify(original));
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(replay()).rejects.toMatchObject({ status: 503 });
    await f.db.update(lotCutoverState).set({ destinationOpen: true })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub, capability: "lot_select",
      granted: false, reason: "synthetic replay revocation", expectedRevision: 1 });
    await expect(replay()).rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub, capability: "lot_select",
      granted: true, reason: "synthetic replay restoration", expectedRevision: 2 });
    await f.db.update(accountUsers).set({ status: "pending" }).where(eq(accountUsers.id, f.contributor.id));
    await expect(replay()).rejects.toMatchObject({ status: 403 });
    await f.db.update(accountUsers).set({ status: "approved" }).where(eq(accountUsers.id, f.contributor.id));
    await revokeMembership(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      expectedRevision: 1, reason: "synthetic replay membership revocation" });
    await expect(replay()).rejects.toMatchObject({ status: 403 });
    expect(await snapshot()).toEqual(before);
  });
});

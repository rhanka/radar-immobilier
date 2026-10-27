// 6J lot capability grants: explicit, revised, audited. No defaults.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotCapabilityEvents } from "../../../db/schema.js";
import { setLotCapability } from "./lot-capabilities.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

describeDb("6J lot capability grants", () => {
  it("should grant and revoke one right with revisions and audit rows", async () => {
    const f = await lotFixture();
    const before = (await f.db.select().from(lotCapabilityEvents)).length;
    const mutation = { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, capability: "lot_market" as const,
      reason: "synthetic grant" };
    const revoked = await setLotCapability(f.db, { ...mutation,
      granted: false, expectedRevision: 1 });
    expect(revoked).toEqual({ granted: false, revision: 2, changed: true });
    const noop = await setLotCapability(f.db, { ...mutation,
      granted: false, expectedRevision: 2 });
    expect(noop).toEqual({ granted: false, revision: 2, changed: false });
    const events = await f.db.select().from(lotCapabilityEvents);
    expect(events.length).toBe(before + 1);
    expect(events[events.length - 1]).toMatchObject({ kind: "capability_revoked",
      capability: "lot_market", accountId: f.contributor.id, actorId: f.moderator.id });
  });

  it("should conflict on stale revisions and reject missing ones", async () => {
    const f = await lotFixture();
    const mutation = { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, capability: "lot_select" as const,
      granted: false, reason: "synthetic revision" };
    await expect(setLotCapability(f.db, { ...mutation, expectedRevision: 999 }))
      .rejects.toMatchObject({ status: 409 });
    await expect(setLotCapability(f.db, { ...mutation,
      expectedRevision: undefined }))
      .rejects.toMatchObject({ status: 400, message: "invalid_workspace_command" });
  });

  it("should refuse grants from non-managers and to unapproved accounts", async () => {
    const f = await lotFixture();
    await expect(setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.contributor.sub,
      capability: "lot_pipeline", granted: false,
      reason: "synthetic refusal", expectedRevision: 1 }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    await expect(setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: randomUUID(), actorSub: f.moderator.sub,
      capability: "lot_pipeline", granted: true,
      reason: "synthetic refusal", expectedRevision: null }))
      .rejects.toMatchObject({ status: 403 });
    await expect(setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      capability: "lot_unknown" as never, granted: true,
      reason: "synthetic refusal", expectedRevision: 1 }))
      .rejects.toMatchObject({ status: 400 });
  });
});

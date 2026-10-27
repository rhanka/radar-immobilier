import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { scopedSignalFacetsRoute } from "../../src/routes/scoped-signal-facets.js";
import { scopedWorkspaceArchiveRoute } from "../../src/routes/scoped-workspace-archive.js";
import { readScopedPersonalHeads } from "../../src/services/facets/scoped-reader.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { setMembershipCapability } from "../../src/services/workspaces/capabilities.js";
import { applyMembershipCommand } from "../../src/services/workspaces/membership-command.js";
import {
  describeDb,
  workspaceFixture,
  workspaceSignal,
} from "../../src/services/facets/workspace-archive-fixture.js";

const db = {} as Database;
const auth = { enabled: true };
const INVALID_WORKSPACE = "not-a-uuid";

function writerApp(session: { sub: string; via?: string }): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  app.route("/", scopedSignalFacetsRoute({ db, auth }));
  app.route("/", scopedWorkspaceArchiveRoute({ db, auth }));
  return app;
}

describeDb("base-api scoped authority and revocation", () => {
  it("isolates personal heads across viewers", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const viewer = await readScopedPersonalHeads(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug);
    expect(viewer.map((head) => head.id)).toHaveLength(1);
    const other = await readScopedPersonalHeads(f.db, f.moderator.sub,
      f.workspaceId, target.citySlug);
    expect(other).toEqual([]);
  });

  it("isolates the same account across workspaces", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const command = { action: "select" as const, basket: "pertinent" as const, target,
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    const first = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command);
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.otherId, command))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    expect(await readScopedPersonalHeads(f.db, f.contributor.sub,
      f.otherId, target.citySlug)).toEqual([]);
    expect(first!.id).toBeDefined();
  });

  it("requires the moderation capability for the common archive", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    await expect(writeWorkspaceArchiveFacet(f.db, f.contributor.sub, f.workspaceId, command))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    const granted = await setMembershipCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub, reason: "synthetic grant",
      expectedRevision: 1, capability: "moderate_archive", granted: true });
    expect(granted.record.moderateArchive).toBe(true);
    const event = await writeWorkspaceArchiveFacet(f.db, f.contributor.sub,
      f.workspaceId, { ...command, commandKey: randomUUID() });
    expect(event).toMatchObject({ state: "active" });
  });

  it("closes reads and writes after membership revocation", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await f.pool.query(
      "UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND account_id = $2",
      [f.workspaceId, f.contributor.id]);
    await expect(readScopedPersonalHeads(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug)).rejects.toMatchObject({ status: 403 });
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "deselect", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("surfaces authorized conflict payloads", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const selected = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "deselect", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() }))
      .rejects.toMatchObject({ status: 409, current: { heads: [{ id: selected!.id }] } });
    await expect(applyMembershipCommand(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.contributor.id, actorSub: f.moderator.sub,
      reason: "synthetic stale", expectedRevision: 999 }))
      .rejects.toMatchObject({ status: 409, current: expect.objectContaining({}) });
  });
});

describe("base-api bearer authority guard", () => {
  it("denies bearer writes while preserving bearer reads", async () => {
    const bearer = writerApp({ sub: "user-1", via: "bearer" });
    const write = await bearer.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/personal/select`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: "browser_session_required" });
    const common = await bearer.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/workspace/discard`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(common.status).toBe(403);
    const read = await bearer.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/personal/cities/c`);
    expect(read.status).toBe(400);
    expect(await read.json()).toMatchObject({ error: "invalid_scoped_identity" });
  });
});

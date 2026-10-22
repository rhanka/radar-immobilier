import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { accountUsers } from "../db/schema.js";
import { scopedWorkspaceArchiveRoute } from "./scoped-workspace-archive.js";
import { initializeWorkspaceStore } from "../services/workspaces/init-store.js";
import { database, safety } from "../services/facets/scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "../services/facets/activation-run.js";
import { attachPersonalHistory } from "../services/facets/attachment.js";
import { graphNodes } from "../db/schema.js";
import { targetFingerprint } from "../services/facets/target.js";
import { describeDb, workspaceFixture } from "../services/facets/workspace-archive-fixture.js";

describeDb("6I workspace archive HTTP contract", () => {
  it("should gate reads and writes on activation, session, and moderation", async () => {
    const handle = await database();
    const { db } = handle;
    const moderator = { id: randomUUID(), sub: `synthetic-moderator-${randomUUID()}` };
    await db.insert(accountUsers).values({ ...moderator, status: "approved" });
    const init = await initializeWorkspaceStore(db, {
      workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic 6I closed",
      approvedAccountIds: [moderator.id], managerAccountIds: [moderator.id],
      moderatorAccountIds: [moderator.id], actorAccountId: moderator.id,
      reason: "synthetic initialization",
    });
    let session: { sub: string; via?: string } | null = null;
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedWorkspaceArchiveRoute({ db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${init.workspaceId}/signal-facets/workspace`;
    expect((await app.request(`${base}/discard`, { method: "POST" })).status).toBe(401);
    session = { sub: moderator.sub };
    const closed = await app.request(
      `/api/v1/workspaces/${init.workspaceId}/signal-facets/archive/cities/synthetic-city`);
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
    await attachPersonalHistory(db, { actorAccountId: moderator.id, reason: "synthetic attachment",
      entries: [{ accountId: moderator.id, workspaceId: init.workspaceId }] });
    await runPersonalAttachmentActivation(db, { workspaceId: init.workspaceId,
      actorSub: moderator.sub, reason: "synthetic activation" }, safety);
    const [node] = await db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic 6I HTTP signal" }).returning();
    const target = { citySlug: node!.citySlug, type: "Signal", id: node!.id };
    const body = { target, reasonCode: "N-NON-RES", expectedHeadId: null,
      displayedFingerprint: targetFingerprint(node!) };
    session = { sub: moderator.sub, via: "bearer" };
    expect((await app.request(`${base}/discard`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body) })).status).toBe(403);
    session = { sub: moderator.sub };
    expect((await app.request(`${base}/discard`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body) })).status).toBe(400);
  });

  it("should authorize moderators, refuse contributors, and return separated heads", async () => {
    const f = await workspaceFixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic 6I HTTP archive" }).returning();
    const target = { citySlug: node!.citySlug, type: "Signal", id: node!.id };
    const fingerprint = targetFingerprint(node!);
    let session: { sub: string; via?: string } = { sub: f.moderator.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedWorkspaceArchiveRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/workspace`;
    const post = (action: string, key = randomUUID(), payload: unknown) =>
      app.request(`${base}/${action}`, { method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(payload) });
    const key = randomUUID();
    const discard = { target, reasonCode: "N-NON-RES", expectedHeadId: null,
      displayedFingerprint: fingerprint };
    const created = await post("discard", key, discard);
    expect(created.status).toBe(200);
    const original = await created.json();
    expect(await (await post("discard", key, discard)).json()).toEqual(original);
    session = { sub: f.contributor.sub };
    expect((await post("discard", randomUUID(), discard)).status).toBe(403);
    session = { sub: f.outsider.sub };
    expect((await app.request(
      `/api/v1/workspaces/${f.workspaceId}/signal-facets/archive/cities/synthetic-city`)).status)
      .toBe(403);
    session = { sub: f.moderator.sub };
    const stale = await post("discard", randomUUID(), discard);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "facet_head_conflict",
      current: { heads: [{ id: (original.event as { id: string }).id }] } });
    const cities = await app.request(
      `/api/v1/workspaces/${f.workspaceId}/signal-facets/archive/cities/synthetic-city`);
    expect(cities.status).toBe(200);
    expect(await cities.json()).toMatchObject({ ok: true,
      heads: [{ target, personal: null, effectiveDiscarded: true,
        workspace: { state: "active" },
        capabilities: { discardPersonally: true, moderateArchive: true } }] });
  });
});

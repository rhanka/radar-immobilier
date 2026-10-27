import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { accountUsers, workspaceMembershipEvents, workspaceMemberships } from "../../db/schema.js";
import { workspacesRoute } from "../../routes/workspaces.js";
import { db, describeDb, fixture, pool } from "./db-fixture.js";

function http(sub?: string, via = "session", enabled = true) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (sub) c.set("session" as never, { sub, via } as never);
    return next();
  });
  app.route("/", workspacesRoute({ db, auth: { enabled } }));
  return app;
}
const list = "/api/v1/workspaces";

describeDb("workspace HTTP authority", () => {
  afterAll(() => pool.end());

  it("should require authentication and private responses on the exact list path", async () => {
    const response = await http().request(list);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await http("synthetic", "session", false).request(list)).status).toBe(401);
  });

  it("should reject bearer mutations, moderators and global administrators", async () => {
    const f = await fixture();
    const path = `${list}/${f.workspaceId}/memberships`;
    for (const [sub, via] of [[f.manager.sub, "bearer"], [f.moderator.sub, "session"],
      [f.outsider.sub, "session"]]) {
      const response = await http(sub, via).request(path, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: f.member.id, manageMembers: true, expectedRevision: 1 }) });
      expect(response.status).toBe(403);
    }
    expect((await http(f.outsider.sub).request(list)).status).toBe(200);
    expect(await (await http(f.outsider.sub).request(list)).json()).toMatchObject({ workspaces: [] });
  });

  it("should compare the client revision before grants and before no-ops", async () => {
    const f = await fixture();
    const app = http(f.manager.sub);
    const post = (body: object) => app.request(`${list}/${f.workspaceId}/memberships`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await post({ accountId: f.member.id, manageMembers: true })).status).toBe(400);
    expect((await post({ accountId: f.member.id, manageMembers: true, expectedRevision: 99 })).status).toBe(409);
    const granted = await post({ accountId: f.member.id, manageMembers: true, expectedRevision: 1 });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ membership: { revision: 2, manageMembers: true } });
    expect((await post({ accountId: f.member.id, manageMembers: true, expectedRevision: 1 })).status).toBe(409);
  });

  it("should reject contradictory revocation payloads and untrusted actor fields", async () => {
    const f = await fixture();
    for (const extra of [{ status: "revoked", manageMembers: true }, { actorSub: f.manager.sub }]) {
      const response = await http(f.manager.sub).request(`${list}/${f.workspaceId}/memberships`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: f.member.id, expectedRevision: 1, ...extra }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("should withdraw a capability without reactivating a revoked membership", async () => {
    const f = await fixture();
    const app = http(f.manager.sub);
    const post = (body: object) => app.request(`${list}/${f.workspaceId}/memberships`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const revoked = await post({ accountId: f.member.id, status: "revoked", expectedRevision: 1 });
    expect(revoked.status).toBe(200);
    const { membership } = await revoked.json() as { membership: { revision: number } };
    const before = await db.select().from(workspaceMemberships)
      .where(eq(workspaceMemberships.accountId, f.member.id));
    const events = await db.select().from(workspaceMembershipEvents)
      .where(eq(workspaceMembershipEvents.accountId, f.member.id));
    const withdrawal = await post({ accountId: f.member.id, manageMembers: false,
      expectedRevision: membership.revision });
    expect(withdrawal.status).toBe(404);
    expect(await withdrawal.json()).toMatchObject({ error: "workspace_membership_not_found" });
    expect(await db.select().from(workspaceMemberships)
      .where(eq(workspaceMemberships.accountId, f.member.id))).toEqual(before);
    expect(await db.select().from(workspaceMembershipEvents)
      .where(eq(workspaceMembershipEvents.accountId, f.member.id))).toEqual(events);
    expect(await (await http(f.member.sub).request(list)).json()).toMatchObject({ workspaces: [] });
  });

  it("should permit a capability withdrawal on a suspended account", async () => {
    const f = await fixture();
    const app = http(f.manager.sub);
    const post = (body: object) => app.request(`${list}/${f.workspaceId}/memberships`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const granted = await post({ accountId: f.member.id, moderateArchive: true, expectedRevision: 1 });
    expect(granted.status).toBe(200);
    const { membership } = await granted.json() as { membership: { revision: number } };
    await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.id, f.member.id));
    const withdrawal = await post({ accountId: f.member.id, moderateArchive: false,
      expectedRevision: membership.revision });
    expect(withdrawal.status).toBe(200);
    expect(await withdrawal.json()).toMatchObject(
      { membership: { status: "active", revision: membership.revision + 1, moderateArchive: false } });
  });

  it("should return 409 and the current membership for a concurrent explicit-absence creation", async () => {
    const f = await fixture();
    const app = http(f.manager.sub);
    const post = () => app.request(`${list}/${f.workspaceId}/memberships`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: f.outsider.id, status: "active", expectedRevision: null }),
    });
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find((response) => response.status === 409)!.json()).toMatchObject({
      error: "workspace_revision_conflict", current: { accountId: f.outsider.id, revision: 1 },
    });
  });
});

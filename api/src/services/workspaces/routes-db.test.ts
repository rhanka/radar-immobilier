import { afterAll, expect, it } from "vitest";
import { Hono } from "hono";
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
});

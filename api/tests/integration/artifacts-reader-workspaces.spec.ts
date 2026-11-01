import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";

describeDb("reader workspace discovery against PostgreSQL", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("readerws", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should isolate active memberships, reflect availability and stop after revocation", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.otherId, f.data.contributor.id]);
    await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1", [f.data.otherId]);
    const read = async (sub: string) => {
      const auth = await f.credentials(sub);
      return app.request(`https://${f.host}/__reader/api/workspaces.list.v1`, {
        headers: { host: f.host, cookie: auth.cookie, "x-preview-grant": auth.grant },
      });
    };
    for (const [sub, id, availability] of [
      [f.data.contributor.sub, f.data.workspaceId, { state: "open" }],
      [f.data.outsider.sub, f.data.otherId, { state: "closed", reason: "maintenance" }],
    ] as const) {
      const response = await read(sub);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.workspaces).toEqual([{ id, slug: expect.any(String), label: "Synthetic 6I", signals: { availability } }]);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    const manager = await read(f.data.moderator.sub);
    expect((await manager.json()).workspaces).toHaveLength(2);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.workspaceId, f.data.contributor.id]);
    expect(await (await read(f.data.contributor.sub)).json()).toEqual({ ok: true, workspaces: [] });
    await f.data.pool.query("UPDATE account_users SET status='pending' WHERE id=$1", [f.data.contributor.id]);
    const denied = await read(f.data.contributor.sub);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: "account_not_approved" } });
    await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2",
      [f.artifactId, f.data.outsider.sub]);
    const revoked = await read(f.data.outsider.sub);
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
  });
});

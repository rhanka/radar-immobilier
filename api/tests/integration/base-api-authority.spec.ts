import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture, verifiedBearer } from "./base-api-http-fixture.js";
import { baseCookie } from "./base-api-fixture.js";

describeDb("base-api composed authority", () => {
  it("keeps authentication denials private before scoped dispatch", async () => {
    const f = await httpFixture();
    const response = await f.app.request(f.path("personal/cities/synthetic-city"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });

  it("supports verified bearer reads while rejecting bearer writes and SSE", async () => {
    const f = await httpFixture();
    const headers = verifiedBearer(f.data.contributor.sub);
    const read = await f.request(f.path("personal/cities/synthetic-city"),
      f.data.contributor.sub, { headers });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ ok: true, heads: [] });
    const catalog = await f.request(f.path("reason-codes"), f.data.contributor.sub, { headers });
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get("cache-control")).toBe("private, no-store");
    for (const [suffix, init] of [
      ["personal/select", { method: "POST", headers }],
      ["projection-events?citySlug=synthetic-city&mode=signal", { headers }],
    ] as const) {
      const response = await f.request(f.path(suffix), f.data.contributor.sub, init);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "browser_session_required" });
    }
  });

  it("rejects unauthorized common commands without a personal fallback", async () => {
    const f = await httpFixture();
    const before = (await f.data.pool.query("SELECT COUNT(*)::integer AS events FROM facet_events")).rows;
    const response = await f.command("workspace", "discard", {
      target: f.signal.target, displayedFingerprint: f.signal.fingerprint,
      expectedHeadId: null, reasonCode: "N-NON-RES",
    });
    expect(response.status).toBe(403);
    expect((await f.data.pool.query("SELECT COUNT(*)::integer AS events FROM facet_events")).rows)
      .toEqual(before);
  });

  it("rechecks membership on reads with an unchanged signed session", async () => {
    const f = await httpFixture();
    const url = f.path("personal/cities/synthetic-city");
    const headers = { cookie: await baseCookie(f.data.contributor.sub) };
    expect((await f.app.request(url, { headers })).status).toBe(200);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.workspaceId, f.data.contributor.id]);
    const response = await f.app.request(url, { headers });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(f.signal.node.label);
  });

  it("isolates workspace membership for two approved viewers", async () => {
    const f = await httpFixture();
    const denied = await f.request(f.path("personal/cities/synthetic-city"), f.data.outsider.sub);
    expect(denied.status).toBe(403);
    const allowed = await f.request(
      `/api/v1/workspaces/${f.data.otherId}/signal-facets/personal/cities/synthetic-city`,
      f.data.outsider.sub);
    expect(allowed.status).toBe(200);
  });
});

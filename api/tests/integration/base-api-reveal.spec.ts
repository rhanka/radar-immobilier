import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { scopedSignalRevealRoute } from "../../src/routes/scoped-signal-reveal.js";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture } from "./base-api-http-fixture.js";

type Session = { sub: string; via?: string } | null;

const db = {} as Database;
const INVALID_WORKSPACE = "not-a-uuid";
const VALID_WORKSPACE = "123e4567-e89b-12d3-a456-426614174000";

function mount(session: Session): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, session as never);
    await next();
  });
  app.route("/", scopedSignalRevealRoute({ db, auth: { enabled: true } }));
  return app;
}

describe("base-api scoped reason codes", () => {
  it("guards the scoped catalog without legacy readers", async () => {
    const anonymous = mount(null);
    const denied = await anonymous.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reason-codes`,
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(denied.headers.get("vary")).toBe("Cookie, Authorization");
    const bearer = mount({ sub: "user-1", via: "bearer" });
    const invalid = await bearer.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reason-codes`,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_scoped_identity" });
  });

  it("guards the reveal read without restoring anything", async () => {
    const anonymous = mount(null);
    const denied = await anonymous.request(
      `/api/v1/workspaces/${VALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal&id=x`,
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    const reader = mount({ sub: "user-1", via: "bearer" });
    const invalidQuery = await reader.request(
      `/api/v1/workspaces/${VALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal`,
    );
    expect(invalidQuery.status).toBe(400);
    expect(await invalidQuery.json()).toMatchObject({ error: "invalid_scoped_identity" });
    const invalidWorkspace = await reader.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal&id=x`,
    );
    expect(invalidWorkspace.status).toBe(400);
  });
});

describeDb("base-api composed reveal and restoration", () => {
  it("reveals the current content and restores only the personal archive", async () => {
    const f = await httpFixture();
    const body = { target: f.signal.target, displayedFingerprint: f.signal.fingerprint,
      expectedHeadId: null, reasonCode: "N-NON-RES" };
    expect((await f.command("workspace", "discard", body, f.data.moderator.sub)).status).toBe(200);
    expect((await f.command("personal", "discard", body)).status).toBe(200);
    const url = f.path(`reveal?citySlug=synthetic-city&type=Signal&id=${f.signal.target.id}`);
    const reveal = await f.request(url);
    expect(reveal.status).toBe(200);
    const displayed = await reveal.json();
    expect(displayed.signal).toMatchObject({ id: f.signal.node.id, label: f.signal.node.label,
      facetFingerprint: f.signal.fingerprint });
    expect(displayed.signal.classification).toBeTypeOf("object");
    expect(displayed.effectiveDiscarded).toBe(true);
    expect(displayed.displayedFingerprint).toBe(f.signal.fingerprint);
    expect(displayed.heads.workspace.state).toBe("active");
    const restored = await f.command("personal", "restore", { target: f.signal.target,
      expectedHeadId: displayed.heads.personal.id,
      displayedFingerprint: displayed.displayedFingerprint });
    expect(restored.status).toBe(200);
    const after = await (await f.request(url)).json();
    expect(after.heads.personal.state).toBe("inactive");
    expect(after.heads.workspace).toEqual(displayed.heads.workspace);
    expect(after.effectiveDiscarded).toBe(true);
    const catalog = await f.request(f.path("reason-codes"));
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).codes).toContainEqual({ code: "N-NON-RES", verdict: "non_pertinent" });
    const context = await f.request("/api/v1/workspaces");
    expect(context.status).toBe(200);
    expect((await context.json()).workspaces).toHaveLength(2);
  });

  it("rejects restore when the source changes after reveal", async () => {
    const f = await httpFixture();
    expect((await f.command("personal", "discard", { target: f.signal.target,
      displayedFingerprint: f.signal.fingerprint, expectedHeadId: null,
      reasonCode: "N-NON-RES" })).status).toBe(200);
    const url = f.path(`reveal?citySlug=synthetic-city&type=Signal&id=${f.signal.target.id}`);
    const displayed = await (await f.request(url)).json();
    await f.data.pool.query("UPDATE graph_nodes SET label = $1 WHERE id = $2",
      ["Synthetic changed content", f.signal.node.id]);
    const before = (await f.data.pool.query("SELECT * FROM facet_events ORDER BY id")).rows;
    const response = await f.command("personal", "restore", { target: f.signal.target,
      displayedFingerprint: displayed.displayedFingerprint,
      expectedHeadId: displayed.heads.personal.id });
    expect(response.status).toBe(409);
    const conflict = await response.json();
    expect(conflict.error).toBe("target_version_conflict");
    expect(conflict.current.version.fingerprint).not.toBe(displayed.displayedFingerprint);
    expect((await f.data.pool.query("SELECT * FROM facet_events ORDER BY id")).rows).toEqual(before);
    const after = await (await f.request(url)).json();
    expect(after.signal.label).toBe("Synthetic changed content");
    expect(after.effectiveDiscarded).toBe(true);
  });
});

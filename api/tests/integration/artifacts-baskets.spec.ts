import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

describeDb("published basket reads against PostgreSQL and S3", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3baskets", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should isolate readers, validate workspaces and continue after runtime reconstruction", async () => {
    const f = await publishedBaskets(h);
    let app = f.runtime();
    const alice = await f.credentials(f.data.contributor.sub);
    const bob = await f.credentials(f.data.moderator.sub);
    const outsider = await f.credentials(f.data.outsider.sub);
    const read = (auth: typeof alice, op = "search", extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ workspaceId: f.data.workspaceId,
        ...(op === "context" ? {} : { citySlug: "synthetic-city" }), ...extra });
      return app.request(`https://${f.host}/__reader/api/baskets.${op}.v1?${params}`, {
        headers: { host: f.host, cookie: auth.cookie, "x-preview-grant": auth.grant },
      });
    };
    for (const [reader, count] of [[alice, 2], [bob, 1]] as const) {
      const response = await read(reader, "search", { basket: "pertinent" });
      expect(response.status).toBe(200);
      expect((await response.json()).counts.matched).toBe(count);
      expect((await read(reader, "context")).status).toBe(200);
      const state = await read(reader, "state", { type: "Signal", id: f.first.target.id });
      expect(state.status).toBe(200);
      expect((await state.json()).item.facets.selection.pertinent !== null).toBe(reader === alice);
    }
    const first = await read(alice, "search", { limit: "1" });
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.page.nextCursor).toBeTypeOf("string");
    app = f.runtime();
    const page2 = await (await read(alice, "search", { limit: "1", cursor: page1.page.nextCursor })).json();
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].target.id).not.toBe(page1.items[0].target.id);
    expect(page2.page.nextCursor).toBeNull();
    const restarted = await promisify(execFile)(process.execPath, ["--import", "tsx",
      "tests/integration/artifacts-baskets-cursor-worker.helpers.ts", JSON.stringify({
        database: f.data.name, sub: f.data.contributor.sub, workspaceId: f.data.workspaceId, cursor: page1.page.nextCursor,
      })]);
    expect(JSON.parse(restarted.stdout).items.map((item: { target: { id: string } }) => item.target.id))
      .toEqual(page2.items.map((item: { target: { id: string } }) => item.target.id));
    for (const op of ["context", "search", "state"]) {
      const extra = op === "state" ? { type: "Signal", id: f.first.target.id } : {};
      const denied = await read(outsider, op, extra);
      expect(denied.status).toBe(403);
      expect((await denied.json()).error.code).toBe("workspace_not_authorized");
    }
    expect((await read(alice, "search", { workspaceId: "11111111-1111-4111-8111-111111111111" })).status).toBe(403);
    expect((await read(alice, "search", { ownerId: f.data.moderator.sub })).status).toBe(400);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.workspaceId, f.data.contributor.id]);
    for (const op of ["context", "search", "state"]) expect((await read(alice, op,
      op === "state" ? { type: "Signal", id: f.first.target.id } : {})).status).toBe(403);
    const changed = { ...bob, cookie: alice.cookie };
    expect((await read(changed)).status).toBe(401);
    await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [f.artifactId, f.data.moderator.sub]);
    expect((await read(bob)).status).toBe(401);
  });
});

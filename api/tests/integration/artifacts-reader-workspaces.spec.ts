import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "../../src/db/schema.js";
import * as facetContext from "../../src/services/facets/classification-context.js";
import { createBasketReadOperation } from "../../src/artifacts/reader-baskets.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER } from "../../src/artifacts/reader-test-fixture.js";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";

describeDb("reader workspace discovery against PostgreSQL", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("readerws", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should discard all workspace metadata when an earlier membership is revoked during a later read", async () => {
    const f = await publishedBaskets(h);
    const sub = f.data.contributor.sub;
    await h.pool.query("INSERT INTO workspaces (id,slug,label) VALUES ($1::uuid,$1::text,'Workspace A'),($2::uuid,$2::text,'Workspace B')",
      [f.data.workspaceId, f.data.otherId]);
    await h.pool.query(`INSERT INTO workspace_memberships (workspace_id,account_id)
      SELECT w.id,a.id FROM workspaces w CROSS JOIN account_users a
      WHERE w.id=ANY($1::uuid[]) AND a.sub=$2`, [[f.data.workspaceId, f.data.otherId], sub]);
    const reads: string[] = [];
    const readContext = facetContext.readFacetContext;
    const context = vi.spyOn(facetContext, "readFacetContext").mockImplementation(async (db, readerSub, workspaceId) => {
      const result = await readContext(db, readerSub, workspaceId);
      if (reads.length === 1) await h.pool.query(`UPDATE workspace_memberships SET status='revoked',revoked_at=now()
        WHERE workspace_id=$1 AND account_id=(SELECT id FROM account_users WHERE sub=$2)`, [reads[0], readerSub]);
      reads.push(workspaceId);
      return result;
    });
    try {
      const app = createReaderContentApp({ ...f.stored(), contentBase: "pages.example.test", issuer: ISSUER,
        grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
        readOperation: createBasketReadOperation({ db: drizzle(h.pool, { schema }), store: {} as never }) });
      const auth = await f.credentials(sub);
      const response = await app.request(`https://${f.host}/__reader/api/workspaces.list.v1`, {
        headers: { host: f.host, cookie: auth.cookie, "x-preview-grant": auth.grant },
      });
      expect(reads).toHaveLength(2);
      expect(new Set(reads)).toEqual(new Set([f.data.workspaceId, f.data.otherId]));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ ok: false, error: { code: "unauthenticated",
        message: "Authentication is required.", retryable: false, action: "authenticate" }, requestId: expect.any(String) });
    } finally { context.mockRestore(); }
  });
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

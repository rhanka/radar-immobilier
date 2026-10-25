import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { bumpGraphSourceRevision } from "../../src/services/facets/projection-revisions.js";
import { discoverFacetContext } from "../../src/services/facets/classification-discovery.js";
import * as context from "../../src/services/facets/classification-context.js";

function barrier() {
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { release, entered, wait: async () => { enter(); await released; return null; } };
}
async function withDocument() {
  const f = await classificationFixture();
  await f.data.pool.query("UPDATE graph_nodes SET props=$1::jsonb WHERE city_slug=$2 AND id=$3", [
    JSON.stringify({ refs: [{ docSha: "f".repeat(64), rawRef: "raw/synthetic/doc.pdf", excerpt: "Citation", page: 3 }] }),
    f.signal.target.citySlug, f.signal.target.id]);
  return f;
}
describeDb("classification races across real PostgreSQL connections", () => {
  for (const authority of ["approval", "membership"] as const) {
    it(`should abandon the response when ${authority} is revoked during enrichment`, async () => {
      const f = await withDocument();
      const gate = barrier();
      f.head.mockImplementationOnce(gate.wait);
      const reading = f.request("signal-facets/search?citySlug=synthetic-city");
      await gate.entered;
      try {
        if (authority === "approval") await f.data.pool.query("UPDATE account_users SET status='pending' WHERE id=$1", [f.data.contributor.id]);
        else await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1 AND workspace_id=$2", [f.data.contributor.id, f.data.workspaceId]);
      } finally { gate.release(); }
      const response = await reading;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe(authority === "approval" ? "account_not_approved" : "workspace_not_authorized");
      expect(body.items).toBeUndefined();
      expect(body.snapshot).toBeUndefined();
      expect(body.counts).toBeUndefined();
    });
  }
  it("should retry source/catalog drift with one shared canonical document cache", async () => {
    const f = await withDocument();
    const gate = barrier();
    f.head.mockImplementationOnce(gate.wait);
    const reading = f.request("signal-facets/search?citySlug=synthetic-city");
    await gate.entered;
    try {
      await f.data.pool.query("UPDATE graph_nodes SET label='Revised source' WHERE city_slug=$1 AND id=$2", [f.signal.target.citySlug, f.signal.target.id]);
      await f.data.db.transaction((tx) => bumpGraphSourceRevision(tx, f.signal.target.citySlug));
      await f.data.pool.query("INSERT INTO facet_reason_codes(profile_id,code,verdict) VALUES('immo-steve-2026-09','P-NEW-TEST','pertinent')");
    } finally { gate.release(); }
    const response = await reading;
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].card.label).toBe("Revised source");
    expect(f.head).toHaveBeenCalledTimes(1);
  });
  it("should reject a singleton selection when a second membership appears after the context await", async () => {
    const f = await classificationFixture();
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1 AND workspace_id=$2", [f.data.contributor.id, f.data.otherId]);
    const original = context.readFacetContext;
    const spy = vi.spyOn(context, "readFacetContext").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      await f.data.pool.query("UPDATE workspace_memberships SET status='active',revoked_at=null WHERE account_id=$1 AND workspace_id=$2", [f.data.contributor.id, f.data.otherId]);
      return result;
    });
    try { await expect(discoverFacetContext(f.data.db, f.data.contributor.sub, "h5")).rejects.toThrow("workspace_ambiguous"); }
    finally { spy.mockRestore(); }
  });
});

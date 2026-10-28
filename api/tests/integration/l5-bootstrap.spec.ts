import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { PW_PAGE_SCRIPT } from "../../src/artifacts/write-intent-page.js";
import { l5Fixture, L5_READ, L5_READ_KEY } from "./l5-fixture.js";
import { mintGrant, verifyGrant } from "../../src/artifacts/preview-grant.js";
import { effects } from "./pwe-fixture.js";

describeDb("L5 private bootstrap scope", () => {
  it("should reject a valid signed read grant bound to another reader", async () => {
    const h = await l5Fixture();
    try {
      const verified = await verifyGrant(h.readGrant, { ...L5_READ, host: h.pageHost }, L5_READ_KEY, Date.now());
      expect(verified).not.toBeNull();
      const { expiresAtMs: _expires, ...claims } = verified!;
      const foreign = await mintGrant({ ...claims, readerSub: h.f.moderator.sub }, L5_READ_KEY, Date.now());
      expect(await verifyGrant(foreign, { ...L5_READ, host: h.pageHost }, L5_READ_KEY, Date.now())).not.toBeNull();
      const response = await h.app.request(`${h.origin}/__reader/api/facets.write.bootstrap.v1?workspaceId=${h.f.workspaceId}`,
        { headers: { ...h.headers, "x-preview-grant": foreign } });
      expect(response.status).toBe(401);
    } finally { await h.close(); }
  });
  it("should serve the exact corrected PW script for the reader rather than the author", async () => {
    const h = await l5Fixture();
    try {
      const before = await effects(h.f);
      expect(h.privatePage).toMatchObject({ readerSub: h.f.contributor.sub, workspaceId: h.f.workspaceId });
      expect(h.privatePage.readerSub).not.toBe(h.author);
      expect(h.privatePage.readGrant).toBe(h.readGrant);
      expect(h.privatePage).not.toHaveProperty("challengeToken");
      const script = await h.app.request(`${h.origin}/__reader/write.js`, { headers: h.headers });
      expect(script.status).toBe(200);
      expect(script.headers.get("cache-control")).toContain("no-store");
      expect(await script.text()).toContain(PW_PAGE_SCRIPT);
      expect(await effects(h.f)).toEqual(before);
    } finally { await h.close(); }
  });

  it("should require an explicit workspace and matching read grant, then recheck membership", async () => {
    const h = await l5Fixture();
    try {
      const before = await effects(h.f);
      const bootstrap = (workspace: string, grant = h.readGrant) => h.app.request(
        `${h.origin}/__reader/api/facets.write.bootstrap.v1${workspace}`,
        { headers: { ...h.headers, "x-preview-grant": grant } });
      expect((await bootstrap("")).status).toBe(400);
      const selected = `?workspaceId=${h.f.workspaceId}`;
      expect((await bootstrap(selected, "")).status).toBe(401);
      expect((await bootstrap(selected, h.readGrant + "x")).status).toBe(401);
      await h.f.pool.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND account_id=$2",
        [h.f.workspaceId, h.f.contributor.id]);
      expect((await bootstrap(selected)).status).toBe(403);
      expect((await h.f.pool.query("SELECT count(*)::int AS count FROM pw_write_intents")).rows[0].count).toBe(0);
      expect(await effects(h.f)).toEqual(before);
    } finally { await h.close(); }
  });
});

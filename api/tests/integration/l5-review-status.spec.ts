import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { l5Fixture, L5_DOMAIN } from "./l5-fixture.js";
import { effects } from "./pwe-fixture.js";

describeDb("PR 938 page disclosure authority", () => {
  it.each(["moderation", "membership during final resolution"])("should mask a committed workspace receipt after %s loss", async (loss) => {
    const h = await l5Fixture();
    let release = () => {};
    try {
      await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=true WHERE workspace_id=$1 AND account_id=$2",
        [h.f.workspaceId, h.f.contributor.id]);
      const { basket: _basket, ...base } = h.body;
      const prepared = await h.prepare({}, { ...base, operation: "facets.signals.workspace.discard.v1", reasonCode: "N-NON-RES" });
      expect(prepared.status).toBe(201);
      const { data } = await prepared.json();
      const headers = { host: new URL(L5_DOMAIN.appOrigin).host, cookie: h.login.cookie };
      const summary = await h.app.request(data.confirmationUrl, { headers });
      const boot = bootstrapOf(await summary.text());
      const confirmed = await h.app.request(`${L5_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${data.intentId}/confirm`, {
        method: "POST", headers: { ...headers, origin: L5_DOMAIN.appOrigin, "content-type": "application/json",
          "x-artifact-write-csrf": String(boot.csrf) }, body: JSON.stringify({ challengeToken: boot.challengeToken }),
      });
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toHaveProperty("receipt.event");
      const before = await effects(h.f);
      const status = () => h.app.request(`${h.origin}/__reader/api/facets.write-intents.status.v1?intentId=${data.intentId}`,
        { headers: h.headers });
      if (loss === "moderation") {
        await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=false WHERE workspace_id=$1 AND account_id=$2",
          [h.f.workspaceId, h.f.contributor.id]);
      } else {
        const original = h.runtime.h5.resolvePage;
        let calls = 0;
        const held = new Promise<void>((resolve) => { release = resolve; });
        vi.spyOn(h.runtime.h5, "resolvePage").mockImplementation(async (...args) => {
          const result = await original(...args);
          if (++calls === 4) await held;
          return result;
        });
        const pending = status();
        await vi.waitFor(() => expect(calls).toBe(4), { timeout: 1500, interval: 10 });
        await h.f.pool.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND account_id=$2",
          [h.f.workspaceId, h.f.contributor.id]);
        release();
        const response = await pending;
        expect(response.status).toBe(403);
        expect(await response.json()).not.toHaveProperty("data.receipt");
      }
      const response = await status();
      expect(response.status).toBe(403);
      expect(await response.json()).not.toHaveProperty("data.receipt");
      expect(await effects(h.f)).toEqual(before);
    } finally { release(); vi.restoreAllMocks(); await h.close(); }
  });
});

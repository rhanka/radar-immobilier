import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { l5Fixture, L5_DOMAIN } from "./l5-fixture.js";
import { effects, ONE_COMMIT } from "./pwe-fixture.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import type { WritePrepareBody } from "../../src/artifacts/write-intent-schemas.js";

describeDb("PR 938 post-commit disclosure", () => {
  it.each(["membership", "artifact ACL", "moderation"])("should return only committed technical state after %s withdrawal", async (loss) => {
    const h = await l5Fixture();
    let release = () => {};
    try {
      let body: WritePrepareBody = h.body;
      if (loss === "moderation") {
        await h.f.pool.query("UPDATE workspace_memberships SET moderate_archive=true WHERE workspace_id=$1 AND account_id=$2",
          [h.f.workspaceId, h.f.contributor.id]);
        const { basket: _basket, ...base } = body;
        const projection = await readProjectionScope(h.f.db, h.f.contributor.sub, h.f.workspaceId, h.signal.target.citySlug, "signal");
        body = { ...base, operation: "facets.signals.workspace.discard.v1", reasonCode: "N-NON-RES",
          expectedProjectionToken: projection.token };
      }
      const prepared = await h.prepare({}, body);
      expect(prepared.status).toBe(201);
      const { data } = await prepared.json();
      const headers = { host: new URL(L5_DOMAIN.appOrigin).host, cookie: h.login.cookie };
      const boot = bootstrapOf(await (await h.app.request(data.confirmationUrl, { headers })).text());
      const before = await effects(h.f);
      const original = h.runtime.application.confirm!;
      let committed = false;
      const held = new Promise<void>((resolve) => { release = resolve; });
      h.runtime.application.confirm = async (...args) => {
        const result = await original(...args);
        committed = true;
        await held;
        return result;
      };
      const pending = h.app.request(`${L5_DOMAIN.appOrigin}/api/v1/artifacts/write-intents/${data.intentId}/confirm`, {
        method: "POST", headers: { ...headers, origin: L5_DOMAIN.appOrigin, "content-type": "application/json",
          "x-artifact-write-csrf": String(boot.csrf) }, body: JSON.stringify({ challengeToken: boot.challengeToken }),
      });
      await vi.waitFor(() => expect(committed).toBe(true), { timeout: 1500, interval: 10 });
      if (loss === "artifact ACL") await h.f.pool.query(
        "DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [h.artifactId, h.f.contributor.sub]);
      else await h.f.pool.query(loss === "membership"
        ? "DELETE FROM workspace_memberships WHERE workspace_id=$1 AND account_id=$2"
        : "UPDATE workspace_memberships SET moderate_archive=false WHERE workspace_id=$1 AND account_id=$2",
      [h.f.workspaceId, h.f.contributor.id]);
      release();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ intentId: data.intentId, state: "committed",
        executionState: "committed", revocationState: "active" });
      const after = await effects(h.f);
      for (const [key, delta] of Object.entries(ONE_COMMIT)) expect(after[key], key).toBe(before[key]! + delta);
    } finally { release(); await h.close(); }
  });
});

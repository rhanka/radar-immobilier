import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { discoverFacetContext } from "../../src/services/facets/classification-discovery.js";
import * as store from "../../src/services/workspaces/store.js";
import * as revisions from "../../src/services/facets/projection-revisions.js";
import { setMembershipCapability } from "../../src/services/workspaces/capabilities.js";
import { setLotCapability } from "../../src/services/facets/lots/lot-capabilities.js";

describeDb("classification final authority races", () => {
  for (const transport of ["h5", "mcp"] as const) {
    for (const selection of ["zero", "singleton", "many", "explicit"] as const) {
      it(`should refuse ${transport} ${selection} discovery when suspension commits during the final membership await`, async () => {
        const f = await classificationFixture();
        if (selection === "zero" || selection === "singleton") {
          await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1 AND ($2 OR workspace_id=$3)",
            [f.data.contributor.id, selection === "zero", f.data.otherId]);
        }
        const original = store.listWorkspacesForAccount;
        let calls = 0;
        const spy = vi.spyOn(store, "listWorkspacesForAccount").mockImplementation(async (...args) => {
          const result = await original(...args);
          if (++calls === 2) {
            await f.data.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.data.contributor.id]);
          }
          return result;
        });
        try {
          await expect(discoverFacetContext(f.data.db, f.data.contributor.sub, transport,
            selection === "explicit" ? f.data.workspaceId : undefined)).rejects.toMatchObject({
            status: 403, message: "account_not_approved",
          });
          expect(calls).toBe(2);
        } finally { spy.mockRestore(); }
      });
    }
  }
  for (const capability of ["moderate_archive", "lot_select", "lot_pipeline", "lot_market"] as const) {
    it(`should resample context when ${capability} is withdrawn during the second scope read`, async () => {
      const f = await classificationFixture();
      const mutation = { workspaceId: f.data.workspaceId, targetAccountId: f.data.contributor.id,
        actorSub: f.data.moderator.sub, reason: "Synthetic concurrent capability change" };
      const setGranted = async (granted: boolean) => {
        if (capability === "moderate_archive") {
          const row = await f.data.pool.query("SELECT revision FROM workspace_memberships WHERE workspace_id=$1 AND account_id=$2",
            [f.data.workspaceId, f.data.contributor.id]);
          await setMembershipCapability(f.data.db, { ...mutation, capability, granted, expectedRevision: row.rows[0].revision });
        } else {
          await setLotCapability(f.data.db, { ...mutation, capability, granted, expectedRevision: granted ? null : 1 });
        }
      };
      await setGranted(true);
      const original = revisions.readProjectionScope;
      let calls = 0;
      const spy = vi.spyOn(revisions, "readProjectionScope").mockImplementation(async (...args) => {
        if (++calls === 2) await setGranted(false);
        return original(...args);
      });
      try {
        const response = await f.request("facet-context");
        expect(response.status).toBe(200);
        const { context } = await response.json();
        const field = { moderate_archive: "canModerateArchive", lot_select: "canSelect",
          lot_pipeline: "canChangePipeline", lot_market: "canChangeMarket" }[capability];
        expect(context.lots[field]).toBe(false);
        expect(context.signals.canModerateArchive).toBe(false);
        expect(calls).toBeGreaterThan(2);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
      } finally { spy.mockRestore(); }
    });
  }
  it("should refuse context without data when rights keep changing across all three attempts", async () => {
    const f = await classificationFixture();
    const original = revisions.readProjectionScope;
    let granted = false;
    const spy = vi.spyOn(revisions, "readProjectionScope").mockImplementation(async (...args) => {
      granted = !granted;
      await f.data.pool.query("UPDATE workspace_memberships SET moderate_archive=$1 WHERE workspace_id=$2 AND account_id=$3",
        [granted, f.data.workspaceId, f.data.contributor.id]);
      return original(...args);
    });
    try {
      const response = await f.request("facet-context");
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe("projection_revision_unstable");
      expect(body.context).toBeUndefined();
      expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
    } finally { spy.mockRestore(); }
  });
});

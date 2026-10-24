import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { setLotCapability } from "../../src/services/facets/lots/lot-capabilities.js";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed current replay authority", () => {
  for (const kind of ["single", "batch"] as const) {
    it.each(["approval", "membership", "lot_select", "lot_pipeline", "lot_market"] as const)(
      `denies ${kind} recovery after revoking %s`, async (right) => {
      const f = await lotHttpFixture();
      const { target, displayed } = await f.resolve(0);
      const mutation = right === "lot_pipeline"
        ? { action: "set_pipeline", status: "sollicite" }
        : right === "lot_market"
          ? { action: "set_market", status: "en_vente", asking_price: "250000.00", listing_url: null }
          : { action: "select", basket_id: f.fixture.selectionBasket };
      const item = { target, displayed_version: displayed, expected_head_id: null, mutation };
      const key = randomUUID();
      const replay = () => kind === "single"
        ? f.command("workspace", { mode: "real", ...item }, f.fixture.contributor.sub, key)
        : f.batch("workspace", { mode: "real", items: [item] }, f.fixture.contributor.sub, key);
      const created = await replay();
      expect(created.status).toBe(200);
      const original = await created.text();
      const before = await f.sqlSnapshot();
      expect(await (await replay()).text()).toBe(original);
      if (right === "approval") {
        await f.fixture.pool.query("UPDATE account_users SET status='pending' WHERE id=$1",
          [f.fixture.contributor.id]);
      } else if (right === "membership") {
        await f.fixture.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
          [f.fixture.workspaceId, f.fixture.contributor.id]);
      } else {
        await setLotCapability(f.fixture.db, { workspaceId: f.fixture.workspaceId,
          targetAccountId: f.fixture.contributor.id, actorSub: f.fixture.moderator.sub,
          capability: right, granted: false, expectedRevision: 1, reason: "synthetic replay revoke" });
      }
      const denied = await replay();
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual(right === "approval"
        ? { error: "account_not_approved", status: "pending" }
        : { error: right === "membership" ? "workspace_membership_required" : "workspace_capability_required" });
      expect(await f.sqlSnapshot()).toEqual(before);
      if (right.startsWith("lot_")) {
        const other = right === "lot_pipeline"
          ? { action: "select", basket_id: f.fixture.selectionBasket }
          : { action: "set_pipeline", status: "sollicite" };
        expect((await f.command("workspace", { ...item, mode: "real", mutation: other },
          f.fixture.contributor.sub)).status).toBe(200);
      }
    });
  }
});

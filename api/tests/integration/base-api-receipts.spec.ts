import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture } from "./base-api-http-fixture.js";
import { baseCookie } from "./base-api-fixture.js";

async function sqlState(f: Awaited<ReturnType<typeof httpFixture>>) {
  const tables = ["facet_events", "facet_heads", "facet_commands", "facet_command_contexts",
    "personal_projection_revisions", "workspace_projection_revisions"];
  return Promise.all(tables.map(async (table) => (await f.data.pool.query(
    `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
}

describeDb("base-api composed receipt recovery", () => {
  it("preserves SQL state on exact personal and common replay", async () => {
    const f = await httpFixture();
    const body = { target: f.signal.target, displayedFingerprint: f.signal.fingerprint,
      expectedHeadId: null, reasonCode: "N-NON-RES" };
    for (const family of ["personal", "workspace"] as const) {
      const key = randomUUID();
      const sub = family === "personal" ? f.data.contributor.sub : f.data.moderator.sub;
      const first = await f.command(family, "discard", body, sub, key);
      expect(first.status).toBe(200);
      const receipt = await first.text();
      const before = await sqlState(f);
      const replay = await f.command(family, "discard", body, sub, key);
      expect(replay.status).toBe(200);
      expect(await replay.text()).toBe(receipt);
      expect(await sqlState(f)).toEqual(before);
    }
  });

  it("denies revoked receipt recovery without disclosing the receipt", async () => {
    const f = await httpFixture();
    const key = randomUUID();
    const body = { target: f.signal.target, displayedFingerprint: f.signal.fingerprint,
      expectedHeadId: null, reasonCode: "N-NON-RES" };
    const headers = { cookie: await baseCookie(f.data.contributor.sub),
      "content-type": "application/json", "idempotency-key": key };
    const request = () => f.app.request(f.path("personal/discard"), {
      method: "POST", headers, body: JSON.stringify(body) });
    const first = await request();
    expect(first.status).toBe(200);
    const receipt = await first.json();
    const before = await sqlState(f);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.workspaceId, f.data.contributor.id]);
    const denied = await request();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "workspace_membership_required" });
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(receipt.event.id).toBeDefined();
    expect(await sqlState(f)).toEqual(before);
  });
});

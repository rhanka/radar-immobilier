import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture, verifiedLotBearer } from "./base-api-lot-http-fixture.js";
import { baseCookie } from "./base-api-fixture.js";

describeDb("b5 composed lot authority", () => {
  it("rejects unauthenticated lot reads before scoped dispatch", async () => {
    const f = await lotHttpFixture();
    const target = "citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real";
    const response = await f.app.request(`${f.lotBase}?${target}`);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });

  it("supports verified bearer reads while rejecting bearer writes", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const headers = verifiedLotBearer(f.fixture.contributor.sub);
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    const read = await f.request(`${f.lotBase}?${query}`, f.fixture.contributor.sub, { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    const single = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, f.fixture.contributor.sub, randomUUID());
    expect(single.status).toBe(200);
    const denied = await f.app.request(`${f.lotBase}/workspace/commands`, {
      method: "POST", headers: { "content-type": "application/json",
        "idempotency-key": randomUUID(), ...headers },
      body: JSON.stringify({ mode: "real", target, displayed_version: displayed,
        expected_head_id: null, mutation: { action: "clear_pipeline" } }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "browser_session_required" });
  });

  it("isolates outsiders without facet mutation", async () => {
    const f = await lotHttpFixture();
    const before = await f.sqlSnapshot();
    const { target } = await f.resolve(0);
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    const denied = await f.request(`${f.lotBase}?${query}`, f.fixture.outsider.sub);
    expect(denied.status).toBe(403);
    const { displayed } = await f.resolve(0);
    const write = await f.command("workspace", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, f.fixture.outsider.sub);
    expect(write.status).toBe(403);
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("rechecks membership on reads with an unchanged signed session", async () => {
    const f = await lotHttpFixture();
    const { target } = await f.resolve(0);
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    const headers = { cookie: await baseCookie(f.fixture.contributor.sub) };
    expect((await f.app.request(`${f.lotBase}?${query}`, { headers })).status).toBe(200);
    await f.fixture.pool.query(
      "UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.fixture.workspaceId, f.fixture.contributor.id]);
    const response = await f.app.request(`${f.lotBase}?${query}`, { headers });
    expect(response.status).toBe(403);
  });

  it("keeps moderation and scope separation on writes", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const discard = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "discard", reasonCode: "N-NON-RES" } };
    const before = await f.sqlSnapshot();
    const forbidden = await f.command("workspace", discard, f.fixture.contributor.sub);
    expect(forbidden.status).toBe(403);
    expect(await f.sqlSnapshot()).toEqual(before);
    const allowed = await f.command("workspace", discard, f.fixture.moderator.sub);
    expect(allowed.status).toBe(200);
    const commonHead = (await allowed.json()).result.heads[0].id as string;
    const personal = await f.command("personal", {
      mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket },
    }, f.fixture.contributor.sub);
    expect(personal.status).toBe(400);
    const archived = await f.command("personal", discard, f.fixture.contributor.sub);
    expect(archived.status).toBe(200);
    const personalHead = (await archived.json()).result.heads[0].id as string;
    const restored = await f.command("workspace", { ...discard, expected_head_id: commonHead,
      mutation: { action: "restore" } }, f.fixture.moderator.sub);
    expect(restored.status).toBe(200);
    const state = await f.request(`${f.lotBase}?citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`,
      f.fixture.contributor.sub);
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ archive: { workspace: { state: "inactive" },
      personal: { id: personalHead, state: "active" }, effectiveDiscarded: true } });
  });
});

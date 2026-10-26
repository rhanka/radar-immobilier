import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";

describeDb("PW-A application guards", () => {
  it("should refuse Authorization on every app route even with a valid cookie", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    for (const [path, method] of [[`/artifact-write/intents/${id}`, "GET"], [`${APP}/${id}`, "GET"],
      [`${APP}/${id}/confirm`, "POST"], [`${APP}/${id}/revoke`, "POST"]]) {
      const response = await a.request(path!, { method: method!, headers: { cookie: await a.cookie(), authorization: "Bearer synthetic" } });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "cookie_required" } });
    }
    expect(a.counters().confirms).toBe(0);
  });

  it("should refuse absent or invalid cookies and untrusted forwarded hosts", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const url = `/artifact-write/intents/${id}`;
    const missing = await a.request(url);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ error: { code: "unauthenticated" } });
    const invalid = await a.request(url, { headers: { cookie: "radar_session=invalid" } });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ error: { code: "session_expired" } });
    for (const header of ["forwarded", "x-forwarded-host", "x-forwarded-proto"]) {
      const forwarded = await a.request(url, { headers: { cookie: await a.cookie(), [header]: "untrusted" } });
      expect(forwarded.status).toBe(503);
      expect(await forwarded.json()).toMatchObject({ error: { code: "write_transport_closed" } });
    }
  });

  it("should refuse isolated CSRF failures on confirm and revoke before any side effect", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const cookie = await a.cookie();
    const bootstrap = await (await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } })).json();
    const before = await baseState(a.f);
    const good = { cookie, origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
      "x-artifact-write-csrf": bootstrap.csrf };
    for (const action of ["confirm", "revoke"]) {
      const cases = [{ origin: "https://other.example.test" }, { origin: "null" }, { origin: "" },
        { "x-artifact-write-csrf": "" }, { "x-artifact-write-csrf": "v1.1." + "a".repeat(64) },
        { "x-reader-csrf": "reader-token" }, { "sec-fetch-site": "same-site" },
        { "sec-fetch-mode": "navigate" }, { "sec-fetch-dest": "document" }];
      for (const patch of cases) {
        const response = await a.request(`${APP}/${id}/${action}`, { method: "POST", headers: { ...good, ...patch },
          body: JSON.stringify(action === "confirm" ? { challengeToken: bootstrap.challengeToken } : {}) });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "csrf_refused" } });
      }
    }
    a.clock.now += 1000;
    const reminted = await a.cookie();
    expect(reminted).not.toBe(cookie);
    const oldCsrf = await a.request(`${APP}/${id}/revoke`, { method: "POST", headers: { ...good, cookie: reminted }, body: "{}" });
    expect(oldCsrf.status).toBe(403);
    expect(await oldCsrf.json()).toMatchObject({ error: { code: "csrf_refused" } });
    const crossed = await a.request(`${APP}/${randomUUID()}/revoke`, { method: "POST", headers: good, body: "{}" });
    expect(crossed.status).toBe(403);
    expect(await crossed.json()).toMatchObject({ error: { code: "csrf_refused" } });
    expect(a.counters().confirms).toBe(0);
    expect(await baseState(a.f)).toEqual(before);
    const state = await a.f.pool.query("SELECT revoked_at, challenge_state FROM pw_write_intents");
    expect(state.rows).toEqual([{ revoked_at: null, challenge_state: "pending" }]);
  });

  it("should expose no bootstrap to another principal and allow owner revoke after approval loss", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const other = await a.request(`/artifact-write/intents/${id}`, { headers: { cookie: await a.cookie(a.f.outsider.sub) } });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "confirmation_identity_mismatch" } });
    await a.f.pool.query("UPDATE account_users SET status = 'pending' WHERE id = $1", [a.f.contributor.id]);
    const cookie = await a.cookie();
    const management = await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } });
    expect(management.status).toBe(200);
    const data = await management.json();
    expect(data.management).toBe(true);
    expect(data.challengeToken).toBeUndefined();
    const revoked = await a.request(`${APP}/${id}/revoke`, { method: "POST", headers: { cookie,
      origin: a.writeApp.domain.appOrigin, "content-type": "application/json", "x-artifact-write-csrf": data.csrf }, body: "{}" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ committed: false });
  });
});

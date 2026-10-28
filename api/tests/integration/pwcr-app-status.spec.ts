import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";
import { effects } from "./pwe-fixture.js";

describeDb("PW-C Astra application status recovery", () => {
  it("should reread a committed I after GET paused on account validation and its deadline passed", async () => {
    const h = await authorityFixture();
    const prepared = await h.prepare(); expect(prepared.status).toBe(201);
    const data = (await prepared.json()).data, cookie = await h.cookie();
    const summary = await h.request(`/artifact-write/intents/${data.intentId}`, { headers: { cookie } });
    const boot = await summary.json();
    let release!: () => void, paused!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { paused = resolve; });
    let intercept = true;
    h.writeApp.accounts = { query: async (text, values) => {
      if (intercept) { intercept = false; paused(); await gate; }
      const result = await h.f.pool.query(text, values); return { rows: result.rows };
    } };
    const pending = h.request(`${APP}/${data.intentId}`, { headers: { cookie } });
    await entered;
    try {
      const confirmed = await h.request(`${APP}/${data.intentId}/confirm`, { method: "POST",
        headers: { cookie, origin: h.writeApp.domain.appOrigin, "content-type": "application/json",
          "x-artifact-write-csrf": boot.csrf }, body: JSON.stringify({ challengeToken: boot.challengeToken }) });
      expect(confirmed.status).toBe(200);
      const receipt = await confirmed.json();
      h.clock.now = Date.parse(data.expiresAt) + 1; release();
      const result = await pending; expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ state: "committed", executionState: "committed",
        revocationState: "active", commandId: receipt.commandId, receipt: receipt.receipt });
      expect(h.counters().confirms).toBe(1);
    } finally { release(); await pending; }
  });

  it.each([false, true])("should distinguish revocation with committed=%s through read-only recovery", async (commit) => {
    const h = await authorityFixture(), prepared = await h.prepare(), data = (await prepared.json()).data;
    const cookie = await h.cookie(), summary = await h.request(`/artifact-write/intents/${data.intentId}`, { headers: { cookie } });
    const boot = await summary.json();
    const post = (action: string, body: unknown) => h.request(`${APP}/${data.intentId}/${action}`, { method: "POST",
      headers: { cookie, origin: h.writeApp.domain.appOrigin, "content-type": "application/json",
        "x-artifact-write-csrf": boot.csrf }, body: JSON.stringify(body) });
    const receipt = commit ? await (await post("confirm", { challengeToken: boot.challengeToken })).json() : null;
    expect((await post("revoke", {})).status).toBe(200);
    const before = await effects(h.f);
    const result = await h.request(`${APP}/${data.intentId}`, { headers: { cookie } });
    const body = await result.json();
    expect(body).toMatchObject({ state: "revoked", revocationState: "revoked", executionState: commit ? "committed" : "pending" });
    if (commit) expect(body).toMatchObject({ commandId: receipt.commandId, receipt: receipt.receipt });
    else expect(body).not.toHaveProperty("receipt");
    expect(body).not.toHaveProperty("challengeToken"); expect(await effects(h.f)).toEqual(before);
    expect(h.counters().confirms).toBe(commit ? 1 : 0);
  });
});

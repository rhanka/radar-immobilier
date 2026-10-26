import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { admitSyntheticWrite, baseState, preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { authorityFixture, APP, H5 } from "./pw-write-authority-fixture.js";

describeDb("PW-A approved PW-D integration", () => {
  it("should preserve the I/P polling budget through H5 with the exact rate refusal", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const poll = () => a.request(`${H5}/${id}`, { headers: { "x-synthetic-page-proof": a.page.grant.sessionId } });
    expect((await poll()).status).toBe(200);
    a.clock.now += 1999;
    const refused = await poll();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("2");
    expect(await refused.json()).toEqual({ operation: "facets.write-intents.status.v1", requestId: expect.any(String),
      error: { code: "write_rate_limited", message: "Write request rate exceeded.", action: "wait_then_check_status",
        retryable: true, attemptOutcome: "not_executed" } });
    a.clock.now += 1;
    expect((await poll()).status).toBe(200);
    expect((await a.f.pool.query("SELECT initial_reads FROM pw_write_status_budgets")).rows).toEqual([{ initial_reads: 2 }]);
  });

  it("should project the durable terminal refusal without an external rejection reader", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const cookie = await a.cookie();
    const bootstrap = await (await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } })).json();
    await admitSyntheticWrite(a.f.db, a.f.contributor.sub, await preparedSelect(a.f));
    const before = await baseState(a.f);
    const refused = await a.request(`${APP}/${id}/confirm`, { method: "POST",
      headers: { cookie, origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
        "x-artifact-write-csrf": bootstrap.csrf }, body: JSON.stringify({ challengeToken: bootstrap.challengeToken }) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "projection_revision_conflict",
      action: "refresh_and_confirm", attemptOutcome: "not_executed" } });
    const status = await a.request(`${H5}/${id}`, { headers: { "x-synthetic-page-proof": a.page.grant.sessionId } });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ operation: "facets.write-intents.status.v1",
      reader: { sub: a.f.contributor.sub }, data: { intentId: id, state: "rejected", error: { code: "projection_revision_conflict" } } });
    expect(await baseState(a.f)).toEqual(before);
  });

  it("should pass authenticated cookie expiry through confirm and refuse expiry after a SQL wait", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const cookie = await a.cookie(a.f.contributor.sub, 1);
    const expiry = Math.floor(a.clock.now / 1000) * 1000 + 1000;
    const bootstrap = await (await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } })).json();
    const before = await baseState(a.f);
    const blocker = await a.f.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify(["workspace", a.f.workspaceId])]);
      const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      pending = Promise.resolve(a.request(`${APP}/${id}/confirm`, { method: "POST",
        headers: { cookie, origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
          "x-artifact-write-csrf": bootstrap.csrf }, body: JSON.stringify({ challengeToken: bootstrap.challengeToken }) }));
      await vi.waitFor(async () => {
        const { rows } = await a.f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
          WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
        expect(rows[0].blocked).toBe(true);
      }, { timeout: 800, interval: 5 });
      expect(a.counters().sessionExpiry).toBe(expiry);
      a.clock.now = expiry;
      await blocker.query("ROLLBACK");
      const response = await pending;
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ operation: "facets.write-intents.confirm.v1", requestId: expect.any(String),
        error: { code: "session_expired", message: "Application session expired.", action: "authenticate",
          retryable: false, attemptOutcome: "not_executed" } });
      expect(await baseState(a.f)).toEqual(before);
      expect((await a.f.pool.query("SELECT challenge_state,execution_state FROM pw_write_intents")).rows)
        .toEqual([{ challenge_state: "pending", execution_state: "pending" }]);
      expect((await a.f.pool.query("SELECT count(*)::int AS n FROM pw_write_receipt_links")).rows[0].n).toBe(0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
  });
});

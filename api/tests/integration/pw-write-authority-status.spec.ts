import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { revokePwAuthority } from "../../src/services/facets/pw-write-fences.js";
import { readCommittedSignalReceipt } from "../../src/services/facets/signal-write-receipt.js";
import { authorityFixture, APP, H5 } from "./pw-write-authority-fixture.js";

describeDb("PW-A status disclosure after receipt wait", () => {
  it.each(["intent", "grant", "page_session", "expiry"] as const)(
    "should mask the receipt when %s withdrawal completes during projection", async (kind) => {
      const a = await authorityFixture();
      const id = (await (await a.prepare()).json()).data.intentId;
      const cookie = await a.cookie();
      const bootstrap = await (await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } })).json();
      const headers = { cookie, origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
        "x-artifact-write-csrf": bootstrap.csrf };
      const committed = await a.request(`${APP}/${id}/confirm`, { method: "POST", headers,
        body: JSON.stringify({ challengeToken: bootstrap.challengeToken }) });
      expect(committed.status).toBe(200);
      const poll = () => a.request(`${H5}/${id}`, { headers: { "x-synthetic-page-proof": a.page.grant.sessionId } });
      const before = await poll();
      expect(before.status).toBe(200);
      expect(await before.json()).toMatchObject({ data: { state: "committed", receipt: { event: { state: "active" } } } });
      const blocker = await a.f.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [JSON.stringify(["workspace", a.f.workspaceId])]);
        const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
        pending = Promise.resolve(poll());
        await vi.waitFor(async () => {
          const { rows } = await a.f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
          expect(rows[0].blocked).toBe(true);
        }, { timeout: 800, interval: 5 });
        if (kind === "intent") {
          const revoked = await a.request(`${APP}/${id}/revoke`, { method: "POST", headers, body: "{}" });
          expect(revoked.status).toBe(200);
          expect(await revoked.json()).toEqual({ committed: true });
        } else if (kind === "expiry") a.clock.now = a.page.pageExpiresAtMs;
        else await a.f.db.transaction((tx) => revokePwAuthority(tx, kind, a.page.authorityReferences[kind]!));
        await blocker.query("ROLLBACK");
        const response = await pending;
        if (kind === "intent") {
          expect(response.status).toBe(200);
          expect((await response.json()).data).toEqual({ intentId: id, state: "revoked" });
        } else {
          expect(response.status).toBe(kind === "expiry" ? 401 : 403);
          expect(await response.json()).toMatchObject({ error: { code: kind === "expiry"
            ? "page_session_expired" : kind === "grant" ? "write_grant_revoked" : "page_session_revoked",
          action: kind === "expiry" ? "authenticate" : "request_access" } });
        }
        expect(a.counters().confirms).toBe(1);
        expect((await readCommittedSignalReceipt(a.f.db, a.f.contributor.sub, a.f.workspaceId,
          a.input.commandKey))?.state).toBe("active");
      } finally {
        await blocker.query("ROLLBACK"); blocker.release(); await pending;
      }
    });
});

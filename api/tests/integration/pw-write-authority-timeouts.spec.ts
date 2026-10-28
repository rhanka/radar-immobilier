import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { writeIntentTransaction } from "../../src/artifacts/write-intent-transaction.js";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";

describeDb("PW-A bounded SQL waits", () => {
  it.each(["prepare", "summary", "management", "revoke"] as const)(
    "should refuse %s contention exactly within the one second lock budget", async (action) => {
      const a = await authorityFixture();
      const id = (await (await a.prepare()).json()).data.intentId;
      const cookie = await a.cookie();
      const bootstrap = await (await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } })).json();
      const blocker = await a.f.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        if (action === "prepare") await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [JSON.stringify(["workspace", a.f.workspaceId])]);
        else await blocker.query("SELECT * FROM pw_write_intents WHERE intent_id = $1 FOR UPDATE", [id]);
        const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
        const started = performance.now();
        pending = Promise.resolve(action === "prepare" ? a.prepare() : a.request(action === "summary"
          ? `/artifact-write/intents/${id}` : `${APP}/${id}${action === "revoke" ? "/revoke" : ""}`, {
          method: action === "revoke" ? "POST" : "GET", headers: { cookie,
            origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
            "x-artifact-write-csrf": bootstrap.csrf }, ...(action === "revoke" ? { body: "{}" } : {}) }));
        await vi.waitFor(async () => {
          const { rows } = await a.f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
            WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
          expect(rows[0].blocked).toBe(true);
        }, { timeout: 800, interval: 5 });
        let timer: ReturnType<typeof setTimeout>;
        const response = await Promise.race([pending, new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 1800);
        })]);
        clearTimeout(timer!);
        expect(response, "lock wait must settle within its budget").not.toBeNull();
        expect(performance.now() - started).toBeLessThan(2000);
        expect(response!.status).toBe(503);
        expect(await response!.json()).toMatchObject({ error: { code: "write_fence_unavailable",
          action: "contact_operator", attemptOutcome: "not_executed" } });
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
      const rows = await a.f.pool.query("SELECT revoked_at, challenge_state FROM pw_write_intents");
      expect(rows.rows).toEqual([{ revoked_at: null, challenge_state: "pending" }]);
      expect(a.counters().confirms).toBe(0);
    });

  it("should cancel a slow SQL statement before the five second ceiling", async () => {
    const a = await authorityFixture();
    const started = performance.now();
    await expect(writeIntentTransaction(a.f.db, async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(6)`);
    })).rejects.toMatchObject({ status: 503, message: "write_fence_unavailable" });
    expect(performance.now() - started).toBeLessThan(5800);
  });
});

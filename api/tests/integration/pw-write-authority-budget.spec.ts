import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { authorityFixture } from "./pw-write-authority-fixture.js";

const waits = vi.hoisted(() => ({ completed: 0 }));
vi.mock("../../src/services/facets/pw-write-prepare.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/facets/pw-write-prepare.js")>();
  return { ...actual, preparePwWriteIntentInTx: async (...args: Parameters<typeof actual.preparePwWriteIntentInTx>) => {
    const result = await actual.preparePwWriteIntentInTx(...args);
    // Each statement is admissible alone; only their cumulative duration exceeds five seconds.
    for (let i = 0; i < 8; i++) { await args[0].execute(sql`SELECT pg_sleep(0.8)`); waits.completed++; }
    return result;
  } };
});

describeDb("PW-A cumulative transaction budget", () => {
  it.each([0, 4, 5])("should cancel cumulative SQL waits with %i held pool connections and roll back with the exact refusal", async (held) => {
    const a = await authorityFixture();
    const before = await baseState(a.f);
    const clients = await Promise.all(Array.from({ length: held }, () => a.f.pool.connect()));
    // With all five held, admission spends part of the SAME budget acquiring a connection.
    const release = held === 5 ? setTimeout(() => clients.pop()!.release(), 1800) : undefined;
    waits.completed = 0;
    const started = performance.now();
    let response: Response;
    try { response = await a.prepare(); }
    finally { clearTimeout(release); for (const client of clients) client.release(); }
    expect(performance.now() - started).toBeLessThan(5800);
    expect(waits.completed).toBeGreaterThanOrEqual(held === 5 ? 3 : 5);
    expect(waits.completed).toBeLessThan(held === 5 ? 5 : 8);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ operation: "facets.write-intents.prepare.v1", requestId: expect.any(String),
      error: { code: "write_fence_unavailable", message: "Write authority fence is unavailable.",
        action: "contact_operator", retryable: false, attemptOutcome: "not_executed" } });
    expect(await baseState(a.f)).toEqual(before);
    for (const table of ["pw_write_intents", "pw_write_key_reservations", "pw_write_audit", "pw_write_outbox"]) {
      expect((await a.f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
    expect((await a.f.pool.query("SELECT 1 AS alive")).rows).toEqual([{ alive: 1 }]);
  });

  it.each([3000, 10_000])("should refuse pool acquisition after its %ims timeout or the global deadline without late effects", async (timeout) => {
    const a = await authorityFixture();
    const before = await baseState(a.f);
    a.f.pool.options.connectionTimeoutMillis = timeout;
    const clients = await Promise.all(Array.from({ length: 5 }, () => a.f.pool.connect()));
    const releaseAll = () => { for (const client of clients.splice(0)) client.release(); };
    const safety = setTimeout(releaseAll, 6200);
    waits.completed = 0;
    const started = performance.now();
    let response: Response;
    try { response = await a.prepare(); }
    finally { clearTimeout(safety); releaseAll(); }
    expect(performance.now() - started).toBeLessThan(5800);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ operation: "facets.write-intents.prepare.v1", requestId: expect.any(String),
      error: { code: "write_fence_unavailable", message: "Write authority fence is unavailable.",
        action: "contact_operator", retryable: false, attemptOutcome: "not_executed" } });
    // This query queues behind any late lease; it must be returned without executing work.
    expect((await a.f.pool.query("SELECT 1 AS alive")).rows).toEqual([{ alive: 1 }]);
    expect(a.f.pool.waitingCount).toBe(0);
    expect(waits.completed).toBe(0);
    expect(await baseState(a.f)).toEqual(before);
    for (const table of ["pw_write_intents", "pw_write_key_reservations", "pw_write_audit", "pw_write_outbox"]) {
      expect((await a.f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });
});

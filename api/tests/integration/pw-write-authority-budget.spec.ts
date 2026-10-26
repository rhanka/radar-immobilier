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
  it("should cancel cumulative SQL waits and roll back the prepared intent with the exact refusal", async () => {
    const a = await authorityFixture();
    const before = await baseState(a.f);
    waits.completed = 0;
    const started = performance.now();
    const response = await a.prepare();
    expect(performance.now() - started).toBeLessThan(5800);
    expect(waits.completed).toBeGreaterThanOrEqual(5);
    expect(waits.completed).toBeLessThan(8);
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
});

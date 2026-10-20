import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ArtifactConnectionError, createArtifactsPool, withArtifactAdvisoryLock } from "@radar/artifacts-host";
import { loadConfig } from "../../src/config.js";

let pool: pg.Pool;
let admin: pg.Pool;
beforeAll(() => {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  pool = createArtifactsPool(params, 1);
  admin = new pg.Pool(params);
});
afterAll(async () => { await pool?.end(); await admin?.end(); });

describe("artifact advisory lock connection loss", () => {
  it("fails the pending operation with a typed error and frees the lock and pool", async () => {
    const key = "cd".repeat(16);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let started!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => { started = resolve; });
    const pending = withArtifactAdvisoryLock(pool, key, async (client) => {
      const pid = await client.query("SELECT pg_backend_pid() AS pid");
      started(pid.rows[0]?.pid as number);
      await gate;
      return "never";
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(ArtifactConnectionError);
    try {
      const backendPid = await ready;
      expect(backendPid).toBeGreaterThan(0);
      await admin.query("SELECT pg_terminate_backend($1)", [backendPid]);
      await rejected;
    } finally {
      releaseGate();
    }
    await expect(withArtifactAdvisoryLock(pool, key, async (client) =>
      (await client.query("SELECT 'recovered' AS value")).rows[0]?.value,
    )).resolves.toBe("recovered");
    expect(pool.idleCount).toBe(1);
    expect(pool.waitingCount).toBe(0);
  }, 15000);
});

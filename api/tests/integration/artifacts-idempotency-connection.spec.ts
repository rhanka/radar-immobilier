import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
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
  it.each(["backend-termination", "client-end"])("fails the pending operation with a typed error and frees the lock and pool after %s", async (mode) => {
    const key = randomBytes(16).toString("hex");
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let started!: (pid: number) => void;
    const ready = new Promise<number>((resolve) => { started = resolve; });
    let endConnection!: () => Promise<void>;
    const pending = withArtifactAdvisoryLock(pool, key, async (client) => {
      // Fault injection closes the underlying Client; PoolClient omits end.
      endConnection = () => (client as unknown as pg.Client).end();
      const pid = await client.query("SELECT pg_backend_pid() AS pid");
      started(pid.rows[0]?.pid as number);
      await gate;
      return "never";
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(ArtifactConnectionError);
    try {
      const backendPid = await ready;
      expect(backendPid).toBeGreaterThan(0);
      if (mode === "client-end") await endConnection();
      else await admin.query("SELECT pg_terminate_backend($1)", [backendPid]);
      await rejected;
      await expect(pending).rejects.toMatchObject({ code: "artifact_connection_lost", cause: expect.any(Error) });
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

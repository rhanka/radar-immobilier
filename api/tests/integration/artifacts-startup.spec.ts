import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startArtifactControl } from "../../src/artifacts/control-route-startup.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import type { Database } from "../../src/db/client.js";
import { auth, cookie } from "./artifacts-h2.helpers.js";

const env = loadConfig();
const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD, database: "artifacts_h2_empty_startup" };
const admin = new pg.Pool({ ...params, database: env.POSTGRES_DB });
beforeAll(async () => { await admin.query(`CREATE DATABASE ${params.database}`); });
afterAll(async () => {
  await admin.query(`DROP DATABASE ${params.database} WITH (FORCE)`);
  await admin.end();
});

describe("artifact startup dependency failures", () => {
  it.each(["empty schema", "unreachable Postgres"])("keeps control at 503 and API live with %s", async (failure) => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = await startArtifactControl({ auth, logger, contentBase: "pages.example.test",
      poolParams: { ...params, ...(failure === "unreachable Postgres" ? { port: 1 } : {}) },
      input: { storageScope: "startup", orgId: "org", s3Bucket: "test-startup",
        s3Endpoint: env.S3_ENDPOINT, s3Region: "ca-central-1", s3AccessKey: "test", s3SecretKey: "test" } });
    expect(deps).not.toBeNull();
    try {
      expect(deps?.backend).toBeUndefined();
      const cause = logger.error.mock.calls[0]?.[0].err as Error & { code?: string };
      if (failure === "empty schema") expect(cause.message).toContain("migration journal absent");
      else expect(cause.code).toBe("ECONNREFUSED");
      const app = createApp({ auth, artifactsControl: deps!, store: {} as ObjectStore, db: {} as Database,
        checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
      const response = await app.request("https://app.example.test/api/v1/artifacts/control/list", {
        headers: { cookie: await cookie("alice") } });
      expect(response.status).toBe(503);
      expect((await app.request("https://app.example.test/livez")).status).toBe(200);
    } finally { await (deps!.accounts as pg.Pool).end(); }
  });
});

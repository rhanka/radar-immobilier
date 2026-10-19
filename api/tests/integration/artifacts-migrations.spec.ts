import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeArtifactHost } from "@radar/artifacts-host";
import { createApp } from "../../src/app.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { auth, cookie } from "./artifacts-h2.helpers.js";
import { startHarness, migrationsFolder, type Harness } from "./artifacts-h2.helpers.js";

let h: Harness;
beforeAll(async () => { h = await startHarness("migrations"); });
afterAll(async () => { await h?.close(); });
describe("artifact journal and startup guard", () => {
  it("installs both package hashes, replays cleanly and repairs a missing journal row", async () => {
    const before = (await h.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    expect(before).toHaveLength(15);
    for (const [index, name] of [[13, "0001_artifacts.sql"], [14, "0002_lifecycle.sql"]] as const) {
      const bytes = readFileSync(createRequire(import.meta.url).resolve(`@sentropic/artifacts/migrations/${name}`));
      expect(before[index].hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    await migrate(drizzle(h.pool), { migrationsFolder });
    expect((await h.pool.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count).toBe("15");
    await h.pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [before[14].created_at]);
    await expect(composeArtifactHost(h.pool, h.config)).rejects.toThrow("0015 absent or hash mismatch");
    const app = createApp({ checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore, auth,
      artifactsControl: { auth, accounts: h.pool } });
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ('schema-reader', 'approved')");
    const unavailable = await app.request("https://app.example.test/api/v1/artifacts/control/list", {
      headers: { cookie: await cookie("schema-reader"), origin: auth.appBaseUrl } });
    expect(unavailable.status).toBe(503);
    expect((await app.request("https://app.example.test/livez")).status).toBe(200);
    await migrate(drizzle(h.pool), { migrationsFolder });
    const repaired = (await h.pool.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")).rows[0];
    expect(repaired.hash).toBe(before[14].hash);
    const restarted = await composeArtifactHost(h.pool, h.config);
    expect(restarted).toBeDefined(); restarted?.close();
  });
  it("refuses a scope bound to a different organization without overwriting it", async () => {
    await expect(composeArtifactHost(h.pool, { ...h.config, orgId: "another-org" })).rejects.toThrow("organization mismatch");
    expect((await h.pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = $1", [h.config.storageScope])).rows[0].org_id).toBe(h.config.orgId);
  });
  it("refuses a 0015 journal row with a different hash without writing a scope", async () => {
    const when = 1791100002000;
    const original = (await h.pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [when])).rows[0].hash;
    try {
      await h.pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", ["0".repeat(64), when]);
      await expect(composeArtifactHost(h.pool, { ...h.config, storageScope: "hash_mismatch" }))
        .rejects.toThrow("0015 absent or hash mismatch");
      expect((await h.pool.query("SELECT count(*) FROM artifacts.storage_scopes WHERE id = 'hash_mismatch'")).rows[0].count).toBe("0");
    } finally {
      await h.pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", [original, when]);
    }
  });
});

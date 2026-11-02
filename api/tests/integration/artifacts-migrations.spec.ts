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

const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const artifactEntries = ["0015_artifacts_core", "0016_artifacts_lifecycle"].map((tag) => {
  const entry = journal.entries.find((item) => item.tag === tag);
  if (!entry) throw new Error(`missing artifact migration ${tag}`);
  return entry;
});

let h: Harness;
beforeAll(async () => { h = await startHarness("migrations"); });
afterAll(async () => { await h?.close(); });
describe("artifact journal and startup guard", () => {
  it("should apply actor quotas 0025 before reader tickets 0026", async () => {
    const quota = journal.entries.find((entry) => entry.tag === "0025_artifacts_actor_quotas")!;
    const reader = journal.entries.find((entry) => entry.tag === "0026_artifacts_reader_tickets")!;
    expect([quota.idx, reader.idx]).toEqual([24, 25]);
    expect(reader.when).toBeGreaterThan(quota.when);
    for (const entry of [quota, reader]) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url));
      const rows = (await h.pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [entry.when])).rows;
      expect(rows).toEqual([{ hash: createHash("sha256").update(sql).digest("hex") }]);
    }
    const tables = await h.pool.query("SELECT to_regclass('artifacts.host_actor_quotas') AS quotas, to_regclass('artifacts.host_actor_rate') AS rate, to_regclass('artifacts.reader_tickets') AS tickets");
    expect(tables.rows[0]).toEqual({ quotas: expect.any(String), rate: expect.any(String), tickets: expect.any(String) });
  });
  it("installs both package hashes, replays cleanly and repairs a missing journal row", async () => {
    const before = (await h.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    expect(before).toHaveLength(journal.entries.length);
    for (const [index, name] of [[0, "0001_artifacts.sql"], [1, "0002_lifecycle.sql"]] as const) {
      const entry = artifactEntries[index]!;
      const bytes = readFileSync(createRequire(import.meta.url).resolve(`@sentropic/artifacts/migrations/${name}`));
      const rows = before.filter((row) => String(row.created_at) === String(entry.when));
      expect(rows).toHaveLength(1);
      expect(rows[0].hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    await migrate(drizzle(h.pool), { migrationsFolder });
    expect((await h.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(before);
    // Later rows must also go: Drizzle replays only beyond its last recorded timestamp.
    const replaySince = artifactEntries[1]!.when;
    const deleted = await h.pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= $1", [replaySince]);
    expect(deleted.rowCount).toBe(journal.entries.filter((entry) => entry.when >= replaySince).length);
    await expect(composeArtifactHost(h.pool, h.config, undefined, h.hostOptions)).rejects.toThrow("0016 absent or hash mismatch");
    const app = createApp({ checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore, auth,
      artifactsControl: { auth, accounts: h.pool } });
    await h.pool.query("INSERT INTO account_users (sub, status) VALUES ('schema-reader', 'approved')");
    const unavailable = await app.request("https://app.example.test/api/v1/artifacts/control/list", {
      headers: { cookie: await cookie("schema-reader"), origin: auth.appBaseUrl } });
    expect(unavailable.status).toBe(503);
    expect((await app.request("https://app.example.test/livez")).status).toBe(200);
    await migrate(drizzle(h.pool), { migrationsFolder });
    const repaired = (await h.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    expect(repaired).toEqual(before);
    const restarted = await composeArtifactHost(h.pool, h.config, undefined, h.hostOptions);
    expect(restarted).toBeDefined(); restarted?.close();
  });
  it("refuses a scope bound to a different organization without overwriting it", async () => {
    await expect(composeArtifactHost(h.pool, { ...h.config, orgId: "another-org" }, undefined, h.hostOptions)).rejects.toThrow("organization mismatch");
    expect((await h.pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = $1", [h.config.storageScope])).rows[0].org_id).toBe(h.config.orgId);
  });
  it("refuses a 0016 journal row with a different hash without writing a scope", async () => {
    const when = artifactEntries[1]!.when;
    const original = (await h.pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [when])).rows[0].hash;
    try {
      await h.pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", ["0".repeat(64), when]);
      await expect(composeArtifactHost(h.pool, { ...h.config, storageScope: "hash_mismatch" }, undefined, h.hostOptions))
        .rejects.toThrow("0016 absent or hash mismatch");
      expect((await h.pool.query("SELECT count(*) FROM artifacts.storage_scopes WHERE id = 'hash_mismatch'")).rows[0].count).toBe("0");
    } finally {
      await h.pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", [original, when]);
    }
  });
});

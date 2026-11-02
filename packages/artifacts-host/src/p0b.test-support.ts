import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createMemoryBlobStore } from "@sentropic/artifacts/server/publication";
import { composeArtifactHost } from "./composition.js";
import { createDeleteConfirmation } from "./delete-confirmation.js";
import { createArtifactControl } from "./facade.js";
import { ARTIFACTS_COORDINATOR_HASH, ARTIFACTS_COORDINATOR_WHEN, ARTIFACTS_LIFECYCLE_HASH, ARTIFACTS_LIFECYCLE_WHEN } from "./storage.js";

export async function p0bFixture() {
  const connectionString = process.env.P0B_DATABASE_URL!;
  const url = new URL(connectionString);
  if (url.hostname !== "postgres" || url.pathname !== "/p0b") throw new Error("p0b_test_database_required");
  const pool = new pg.Pool({ connectionString, max: 8, options: "-c statement_timeout=5000 -c lock_timeout=1000" });
  for (const name of ["0015_artifacts_core", "0016_artifacts_lifecycle", "0024_artifacts_coordinator", "0025_artifacts_actor_quotas", "0028_artifacts_p0b"]) {
    await pool.query(readFileSync(new URL(`../../../api/drizzle/${name}.sql`, import.meta.url), "utf8"));
  }
  await pool.query(`CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (created_at bigint, hash text);
    CREATE TABLE account_users (id UUID DEFAULT gen_random_uuid(), sub TEXT PRIMARY KEY, status TEXT);
    INSERT INTO account_users (sub,status) VALUES ('alice','approved'), ('idp-bob','approved'), ('pending','pending');`);
  for (const [when, hash] of [[ARTIFACTS_LIFECYCLE_WHEN, ARTIFACTS_LIFECYCLE_HASH], [ARTIFACTS_COORDINATOR_WHEN, ARTIFACTS_COORDINATOR_HASH]]) {
    await pool.query("INSERT INTO drizzle.__drizzle_migrations VALUES ($1,$2)", [when, hash]);
  }
  const confirmation = createDeleteConfirmation(pool, "p0b", "https://app.test");
  const host = await composeArtifactHost(pool, { enabled: true, storageScope: "p0b", orgId: "test",
    s3Bucket: "test", s3Endpoint: "http://unused.test", s3Region: "test", s3AccessKey: "test", s3SecretKey: "test" },
  createMemoryBlobStore(), { confirmation, contentBase: "pages.test", readActivation: () => ({ enabled: true,
    subjects: [], expiresAtMs: Number.POSITIVE_INFINITY, mode: "general" }) });
  await pool.query("INSERT INTO artifacts.host_quotas (storage_scope_id,operation_limit,byte_limit) VALUES ('p0b',1000,10000000)");
  const control = createArtifactControl(host, "p0b", "pages.test");
  const call = (op: string, args: unknown, actor = "alice") => control.handle(op, actor, args);
  const page = async () => {
    const bindingName = randomUUID();
    const ensured = await call("ensure", { bindingName, idempotencyKey: randomUUID() });
    if (ensured.status !== 201) throw new Error(JSON.stringify(ensured));
    const { artifactId } = ensured.body as { artifactId: string };
    const files = [{ path: "index.html", mimeType: "text/html", text: "<h1>Before</h1>" }];
    const published = await call("publish", { artifactId, files, idempotencyKey: randomUUID() });
    if (published.status !== 201) throw new Error(JSON.stringify(published));
    return { artifactId, releaseId: (published.body as { releaseId: string }).releaseId, files, bindingName };
  };
  return { pool, host, confirmation, call, page, async close() { host.close(); await pool.end(); } };
}

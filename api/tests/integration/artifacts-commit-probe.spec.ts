import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@sentropic/artifacts/http", async (original) => {
  const { withCandidateProfile } = await import("./artifacts-legacy-profile.helpers.js");
  return withCandidateProfile(await original<typeof import("@sentropic/artifacts/http")>());
});
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import {
  ArtifactS3TimeoutError,
  composeArtifactHost,
  createArtifactControl,
  createArtifactsPool,
  createMemoryCommitLedger,
  deriveIdempotencyKey,
} from "@radar/artifacts-host";
import { loadConfig } from "../../src/config.js";
import { migrationsFolder } from "./artifacts-h2.helpers.js";

const DATABASE = "artifacts_h2_commit_probe";
const SCOPE = "probe_scope";
const ORG = "probe_org";
const BASE = "pages.example.test";
const BUCKET = "h2-artifacts-commit-probe";

let admin: pg.Pool;
let pool: pg.Pool;
let s3: S3Client;
let endpoint = "";
let accessKey = "";
let secretKey = "";

const rawBlobs = () => createTestS3BlobStore({ client: s3, bucket: BUCKET });
const storageConfig = () => ({ enabled: true as const, storageScope: SCOPE, orgId: ORG,
  s3Bucket: BUCKET, s3Endpoint: endpoint, s3Region: "us-east-1",
  s3AccessKey: accessKey, s3SecretKey: secretKey });

async function tableCount(table: string): Promise<number> {
  return Number((await pool.query(`SELECT count(*) FROM artifacts.${table}`)).rows[0].count);
}

async function ensureArtifact(
  control: ReturnType<typeof createArtifactControl>, key: string,
): Promise<string> {
  const response = await control.handle("ensure", "alice", { bindingName: "probe", idempotencyKey: key });
  expect(response.status).toBe(201);
  return (response.body as { artifactId: string }).artifactId;
}

beforeAll(async () => {
  const env = loadConfig();
  endpoint = env.S3_ENDPOINT; accessKey = env.S3_ACCESS_KEY; secretKey = env.S3_SECRET_KEY;
  admin = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  await admin.query(`CREATE DATABASE ${DATABASE}`);
  pool = createArtifactsPool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
  await migrate(drizzle(pool), { migrationsFolder });
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2)", [SCOPE, ORG]);
  await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit)
    VALUES ($1, 1000, 1000000)`, [SCOPE]);
  s3 = new S3Client({ endpoint, forcePathStyle: true, region: "us-east-1",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  await pool.query("INSERT INTO account_users (sub, email, status) VALUES ('alice','alice@example.test','approved')");
});

afterAll(async () => {
  for (const key of await rawBlobs().listKeys(`artifacts/${SCOPE}/`)) await rawBlobs().deleteBlob(key);
  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
  s3.destroy();
  await pool.end();
  await admin.query(`DROP DATABASE ${DATABASE} WITH (FORCE)`);
  await admin.end();
});

describe("commit probe against the real provider stack [T05 T13]", () => {
  it("maps a below-layer S3 timeout converted to 500 back to 503", async () => {
    const { ledger, entries } = createMemoryCommitLedger();
    const broken = (await composeArtifactHost(pool, storageConfig(), { ...rawBlobs(),
      async putBlob() { throw new ArtifactS3TimeoutError("blobs.putBlob"); } }))!;
    const control = createArtifactControl(broken, SCOPE, BASE, undefined, { ledger });
    try {
      const id = await ensureArtifact(control, "probe-s3-ensure");
      expect(await tableCount("releases")).toBe(0);
      const response = await control.handle("publish", "alice",
        { artifactId: id, files: [{ path: "index.html", mimeType: "text/html", text: "s3 timeout probe" }],
          idempotencyKey: "probe-s3" });
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
        reason: "provider_unavailable", status: 503, atMs: expect.any(Number) }]);
    } finally {
      broken.close();
    }
  });

  it("maps a below-layer connection loss converted to 409 back to 503", async () => {
    const armed = { current: false };
    const flaky = new Proxy(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => {
          throw Object.assign(new Error("terminating connection"), { code: "57P06" });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(flaky, storageConfig(), rawBlobs()))!;
    const control = createArtifactControl(host, SCOPE, BASE, undefined, { ledger });
    armed.current = true;
    try {
      const response = await control.handle("ensure", "alice",
        { bindingName: "probe-conn", idempotencyKey: "probe-conn" });
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(entries).toEqual([{ invocationId: expect.any(String), op: "ensure", actorId: "alice",
        reason: "provider_unavailable", status: 503, atMs: expect.any(Number) }]);
    } finally {
      armed.current = false;
      host.close();
    }
  });

  it("keeps a below-layer lock conflict as 409 conflict", async () => {
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
    const control = createArtifactControl(host, SCOPE, BASE, undefined, { ledger });
    try {
      const id = await ensureArtifact(control, "probe-lock-ensure");
      const clientKey = "probe-lock";
      const lockId = deriveIdempotencyKey(
        { scope: SCOPE, sub: "alice", op: "publish", artifactId: id, clientKey });
      const holder = await pool.connect();
      try {
        await pool.query("INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [SCOPE, lockId]);
        await holder.query("BEGIN");
        await holder.query("SELECT 1 FROM artifacts.operation_keys WHERE storage_scope_id=$1 AND internal_key=$2 FOR UPDATE", [SCOPE, lockId]);
        const response = await control.handle("publish", "alice",
          { artifactId: id, files: [{ path: "index.html", mimeType: "text/html", text: "lock conflict probe" }],
            idempotencyKey: clientKey });
        expect(response).toEqual({ status: 409, body: { error: "conflict" } });
        expect(entries).toEqual([{ invocationId: expect.any(String), op: "publish", actorId: "alice",
          reason: "provider_conflict", status: 409, atMs: expect.any(Number) }]);
      } finally {
        await holder.query("ROLLBACK");
        holder.release();
      }
    } finally {
      host.close();
    }
  });

});

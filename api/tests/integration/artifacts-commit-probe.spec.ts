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
  createMemoryProviderProbe,
  deriveIdempotencyKey,
  type AdmissionAuthority,
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

async function s3KeyCount(): Promise<number> {
  return [...(await rawBlobs().listKeys(`artifacts/${SCOPE}/`))].length;
}

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
    const probe = createMemoryProviderProbe();
    const { ledger, entries } = createMemoryCommitLedger();
    const broken = (await composeArtifactHost(pool, storageConfig(), { ...rawBlobs(),
      async putBlob() { throw new ArtifactS3TimeoutError("blobs.putBlob"); } }, probe.record))!;
    const control = createArtifactControl(broken, SCOPE, BASE, undefined, { ledger, probe });
    try {
      const id = await ensureArtifact(control, "probe-s3-ensure");
      expect(await tableCount("releases")).toBe(0);
      const response = await control.handle("publish", "alice",
        { artifactId: id, files: [{ path: "index.html", mimeType: "text/html", text: "s3 timeout probe" }],
          idempotencyKey: "probe-s3" });
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(entries).toEqual([{ op: "publish", actorId: "alice",
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
    const probe = createMemoryProviderProbe();
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(flaky, storageConfig(), rawBlobs(), probe.record))!;
    const control = createArtifactControl(host, SCOPE, BASE, undefined, { ledger, probe });
    armed.current = true;
    try {
      const response = await control.handle("ensure", "alice",
        { bindingName: "probe-conn", idempotencyKey: "probe-conn" });
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(entries).toEqual([{ op: "ensure", actorId: "alice",
        reason: "provider_unavailable", status: 503, atMs: expect.any(Number) }]);
    } finally {
      armed.current = false;
      host.close();
    }
  });

  it("keeps a below-layer lock conflict as 409 conflict", async () => {
    const probe = createMemoryProviderProbe();
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs(), probe.record))!;
    const control = createArtifactControl(host, SCOPE, BASE, undefined, { ledger, probe });
    try {
      const id = await ensureArtifact(control, "probe-lock-ensure");
      const clientKey = "probe-lock";
      const lockId = deriveIdempotencyKey(
        { scope: SCOPE, sub: "alice", op: "publish", artifactId: id, clientKey }).slice(0, 16);
      const holder = await pool.connect();
      try {
        await holder.query("SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)", [lockId]);
        const response = await control.handle("publish", "alice",
          { artifactId: id, files: [{ path: "index.html", mimeType: "text/html", text: "lock conflict probe" }],
            idempotencyKey: clientKey });
        expect(response).toEqual({ status: 409, body: { error: "conflict" } });
        expect(entries).toEqual([{ op: "publish", actorId: "alice",
          reason: "provider_conflict", status: 409, atMs: expect.any(Number) }]);
      } finally {
        await holder.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
        holder.release();
      }
    } finally {
      host.close();
    }
  });

  it("documents the uncompensated residue of a publish revoked while blocked", async () => {
    // Upstream gap: without a provider commit-time authorization hook the
    // 403 below masks a committed publication. This test pins the leak; it
    // must be inverted (no denied success) when finalization authorization lands.
    const authority: AdmissionAuthority = {
      readActivation: () => ({ enabled: true, subjects: ["alice"], expiresAtMs: Date.now() + 3_600_000 }),
      nowMs: () => Date.now(),
      readStatus: async (sub: string) =>
        (await pool.query("SELECT status FROM account_users WHERE sub = $1", [sub])).rows[0]?.status ?? null,
    };
    const probe = createMemoryProviderProbe();
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs(), probe.record))!;
    const control = createArtifactControl(host, SCOPE, BASE, authority, { ledger, probe });
    try {
      const id = await ensureArtifact(control, "probe-revoke-ensure");
      const clientKey = "probe-revoke";
      const body = { artifactId: id,
        files: [{ path: "index.html", mimeType: "text/html", text: "revoked while blocked" }],
        idempotencyKey: clientKey };
      const lockId = deriveIdempotencyKey(
        { scope: SCOPE, sub: "alice", op: "publish", artifactId: id, clientKey }).slice(0, 16);
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const s3Before = await s3KeyCount();
      const holder = await pool.connect();
      try {
        await holder.query("SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)", [lockId]);
        const pending = control.handle("publish", "alice", body);
        await expect.poll(async () => Number((await pool.query(
          "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted " +
          "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
        )).rows[0].count)).toBe(1);
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
        await holder.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
        const response = await pending;
        expect(response).toEqual({ status: 403,
          body: { error: "account_not_approved", status: "suspended" } });
        expect(entries).toEqual([{ op: "publish", actorId: "alice",
          reason: "unauthorized_at_commit", status: 403, atMs: expect.any(Number) }]);
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await s3KeyCount()).toBeGreaterThan(s3Before);
        expect(await control.handle("publish", "alice", body)).toEqual(response);
      } finally {
        await holder.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
        holder.release();
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      }
      const release = (await pool.query(
        "SELECT id, state FROM artifacts.releases WHERE artifact_id = $1", [id],
      )).rows[0];
      expect(release.state).toBe("ready");
      const current = (await pool.query(
        "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [id],
      )).rows;
      expect(current).toEqual([{ release_id: release.id }]);
      const stored = (await pool.query("SELECT key, result FROM artifacts.idempotency_keys")).rows;
      expect(stored.some((row) => JSON.stringify(row.result).includes(release.id))).toBe(true);
      const objectsAfter = await s3KeyCount();
      const replayHost = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
      try {
        const replay = await createArtifactControl(replayHost, SCOPE, BASE, authority)
          .handle("publish", "alice", body);
        expect(replay.status).toBe(201);
        expect((replay.body as { releaseId: string }).releaseId).toBe(release.id);
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await s3KeyCount()).toBe(objectsAfter);
        console.log("[commit-residue]", JSON.stringify({ release: release.state,
          releasesAdded: 1, idempotencyAdded: 1, objectsAdded: objectsAfter - s3Before,
          current, replay: replay.status, sameRelease: true }));
      } finally { replayHost.close(); }
    } finally {
      host.close();
    }
  });
});

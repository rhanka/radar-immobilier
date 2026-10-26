import pg from "pg";
import { randomUUID } from "node:crypto";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { composeArtifactHost, createArtifactControl, createArtifactAdmissionAuthority } from "@radar/artifacts-host";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import { loadConfig } from "../../src/config.js";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import { cleanupArtifactTestResources } from "./artifacts-s3.helpers.js";

export const ALICE = "astra-alice";
export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const SECOND = "22222222-2222-4222-8222-222222222222";
export const BASE = "pages.example.test";
export const live = () => ({ enabled: true as const, subjects: [ALICE], expiresAtMs: Date.parse("2030-01-01T00:00:00Z") });
export function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function startAstra(name: string, max = 5) {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  const admin = new pg.Pool(params);
  const database = `artifacts_astra_a5_${name}`;
  const pool = new pg.Pool({ ...params, database, max, connectionTimeoutMillis: 200,
    options: "-c lock_timeout=1000 -c statement_timeout=5000" });
  const config = { enabled: true as const, storageScope: `astra_${name}`, orgId: "astra_org",
    s3Bucket: `astra-a5-${name}`, s3Endpoint: env.S3_ENDPOINT, s3Region: "us-east-1",
    s3AccessKey: env.S3_ACCESS_KEY, s3SecretKey: env.S3_SECRET_KEY };
  const s3 = new S3Client({ endpoint: config.s3Endpoint, forcePathStyle: true, region: config.s3Region,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey } });
  let created = false;
  let bucket = false;
  const hosts: Awaited<ReturnType<typeof composeArtifactHost>>[] = [];
  async function close() {
    for (const host of hosts) host.close();
    await cleanupArtifactTestResources({ s3, bucket: bucket ? config.s3Bucket : undefined,
      pool, admin, database: created ? database : undefined });
  }
  try {
    await admin.query(`CREATE DATABASE ${database}`); created = true;
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    await s3.send(new CreateBucketCommand({ Bucket: config.s3Bucket })); bucket = true;
    await pool.query("INSERT INTO account_users (sub, status) VALUES ($1,'approved')", [ALICE]);
    await pool.query("INSERT INTO workspaces (id, slug, label) VALUES ($1,'astra-one','One'),($2,'astra-two','Two')",
      [WORKSPACE, SECOND]);
    const memberships = async (ids: string[]) => {
      await pool.query("DELETE FROM workspace_memberships");
      for (const id of ids) await pool.query(`INSERT INTO workspace_memberships (workspace_id, account_id)
        SELECT $1, id FROM account_users WHERE sub=$2`, [id, ALICE]);
    };
    await memberships([WORKSPACE]);
    const blobs = createTestS3BlobStore({ client: s3, bucket: config.s3Bucket });
    const openHost = async (store: PublicationBlobStore = blobs) => {
      const host = await composeArtifactHost(pool, config, store, { readActivation: live, contentBase: BASE });
      hosts.push(host);
      await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit)
        VALUES ($1,1000000,1000000000) ON CONFLICT DO NOTHING`, [config.storageScope]);
      return { host, control: createArtifactControl(host, config.storageScope, BASE,
        createArtifactAdmissionAuthority(pool, live)) };
    };
    const durable = async () => (await pool.query(`SELECT
      (SELECT count(*) FROM artifacts.artifacts)::int AS artifacts,
      (SELECT count(*) FROM artifacts.releases)::int AS releases,
      (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
      (SELECT operations_used FROM artifacts.host_quotas)::int AS operations,
      (SELECT bytes_used FROM artifacts.host_quotas)::int AS bytes`)).rows[0];
    const invocation = (host: Awaited<ReturnType<typeof composeArtifactHost>>) => ({
      invocationId: randomUUID(), actorId: ALICE, storageScopeId: config.storageScope,
      authorizeCommit: host.authorizeCommit,
    });
    const bindingEnv = { IMMO_MCP_ARTIFACT_DATABASE_URL:
      `postgres://${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@${params.host}:${params.port}/${database}`,
      ARTIFACTS_STORAGE_SCOPE: config.storageScope, ARTIFACTS_ORG_ID: config.orgId,
      ARTIFACTS_S3_BUCKET: config.s3Bucket, ARTIFACTS_S3_ENDPOINT: config.s3Endpoint,
      ARTIFACTS_S3_REGION: config.s3Region, ARTIFACTS_S3_ACCESS_KEY: config.s3AccessKey,
      ARTIFACTS_S3_SECRET_KEY: config.s3SecretKey, ARTIFACTS_CONTENT_BASE: BASE,
      ARTIFACTS_CONTROL_MODE: "validation", ARTIFACTS_VALIDATION_SUBJECTS: ALICE,
      ARTIFACTS_VALIDATION_UNTIL: "2030-01-01T00:00:00Z" };
    return { pool, params: { ...params, database }, config, blobs, memberships, openHost, durable,
      invocation, bindingEnv, close };
  } catch (error) { await close(); throw error; }
}
export type Astra = Awaited<ReturnType<typeof startAstra>>;

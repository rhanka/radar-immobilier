import pg from "pg";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { generateKeyPair, SignJWT } from "jose";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  composeArtifactHost,
  createArtifactAdmissionAuthority,
  createArtifactControl,
  guardArtifactPool,
} from "@radar/artifacts-host";
import type { ArtifactMcpBinding } from "../../../packages/immo-mcp/src/registry/artifact-provider.js";
import type { ImmoHttpDeps } from "../../../packages/immo-mcp/src/server-http.js";
import { loadConfig } from "../../src/config.js";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import { cleanupArtifactTestResources } from "./artifacts-s3.helpers.js";

export const ALICE = "ouverture-alice";
export const BOB = "ouverture-bob";
export const CAROL = "ouverture-carol";
export const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STALE = "99999999-9999-4999-8999-999999999999";
export const BASE = "pages.example.test";
export const SCOPE = "ouverture_scope";
export const UNKNOWN_ARTIFACT = "123e4567-e89b-12d3-a456-426614174009";
type VerifiedMcpRequest = Parameters<ArtifactMcpBinding["invoke"]>[2];

export const general = () => ({ enabled: true as const, subjects: [] as string[],
  expiresAtMs: Number.POSITIVE_INFINITY, mode: "general" as const });

export const body = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text);

export function bindingRequest(sub: string, scopes: readonly string[] = ["immo:read"]): VerifiedMcpRequest {
  return {
    principal: { issuer: "synthetic", sub, scopes: [...scopes], claims: [], attributes: {} },
    resource: "synthetic:mcp", correlationId: "ouverture", signal: new AbortController().signal,
  };
}

export const ISSUER = "https://auth.test.local";
export const RESOURCE = "https://immo.test.local/mcp";

export interface OuvertureKeys {
  publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  keySource: NonNullable<ImmoHttpDeps["keySource"]>;
}

export async function ouvertureKeys(): Promise<OuvertureKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  return { publicKey, privateKey, keySource: { resolveKey: async () => publicKey } };
}

export async function signToken(privateKey: OuvertureKeys["privateKey"], overrides: Record<string, unknown> = {}): Promise<string> {
  const { scope = "immo:read", sub = ALICE, ...rest } = overrides;
  return new SignJWT({ scope, client_id: "immo-cli", tid: "radar", ...rest })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setSubject(String(sub))
    .setAudience(RESOURCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export interface Ouverture {
  pool: pg.Pool;
  host: Awaited<ReturnType<typeof composeArtifactHost>>;
  beforeUpload: (hook: () => Promise<void>) => void;
  control: ReturnType<typeof createArtifactControl>;
  durable: () => Promise<Record<string, number>>;
  memberships: (ids: string[]) => Promise<void>;
  setStatus: (sub: string, status: string) => Promise<void>;
  bindingEnv: NodeJS.ProcessEnv;
  close: () => Promise<void>;
}

export async function startOuverture(name: "host" | "mcp" | "commit" | "review_replay" | "review_attempts"): Promise<Ouverture> {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  const admin = new pg.Pool(params);
  const database = `artifacts_ouverture_${name}`;
  const pool = guardArtifactPool(new pg.Pool({ ...params, database }));
  const config = { enabled: true as const, storageScope: SCOPE, orgId: "ouverture_org",
    s3Bucket: `ouverture-${name.replaceAll("_", "-")}`, s3Endpoint: env.S3_ENDPOINT, s3Region: "us-east-1",
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
    for (const sub of [ALICE, BOB, CAROL]) {
      await pool.query("INSERT INTO account_users (sub, status) VALUES ($1,'approved') ON CONFLICT DO NOTHING", [sub]);
    }
    await pool.query("INSERT INTO workspaces (id, slug, label) VALUES ($1,'ouverture-one','One'),($2,'ouverture-two','Two') ON CONFLICT DO NOTHING",
      [W1, W2]);
    const memberships = async (ids: string[]) => {
      await pool.query("DELETE FROM workspace_memberships WHERE account_id = (SELECT id FROM account_users WHERE sub=$1)", [ALICE]);
      for (const id of ids) {
        await pool.query(`INSERT INTO workspace_memberships (workspace_id, account_id)
          SELECT $1, id FROM account_users WHERE sub=$2 ON CONFLICT DO NOTHING`, [id, ALICE]);
      }
    };
    const setStatus = async (sub: string, status: string) => {
      await pool.query("UPDATE account_users SET status=$2 WHERE sub=$1", [sub, status]);
    };
    const blobs = createTestS3BlobStore({ client: s3, bucket: config.s3Bucket });
    let uploadHook = async () => {};
    const host = await composeArtifactHost(pool, config, { ...blobs, async putBlob(...args) {
      await uploadHook(); return blobs.putBlob(...args);
    } }, { readActivation: general, contentBase: BASE });
    hosts.push(host);
    await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit)
      VALUES ($1,1000000,1000000000) ON CONFLICT DO NOTHING`, [config.storageScope]);
    const control = createArtifactControl(host, config.storageScope, BASE,
      createArtifactAdmissionAuthority(pool, general, config.storageScope));
    const durable = async () => (await pool.query(`SELECT
      (SELECT count(*) FROM artifacts.artifacts)::int AS artifacts,
      (SELECT count(*) FROM artifacts.releases)::int AS releases,
      (SELECT count(*) FROM artifacts.operation_receipts)::int AS receipts,
      (SELECT operations_used FROM artifacts.host_quotas)::int AS operations,
      (SELECT bytes_used FROM artifacts.host_quotas)::int AS bytes,
      (SELECT coalesce(sum(operations_used),0) FROM artifacts.host_actor_quotas)::int AS actor_operations,
      (SELECT coalesce(sum(bytes_used),0) FROM artifacts.host_actor_quotas)::int AS actor_bytes,
      (SELECT coalesce(sum(count),0) FROM artifacts.host_actor_rate)::int AS rate`)).rows[0];
    const bindingEnv: NodeJS.ProcessEnv = { ...process.env,
      IMMO_MCP_ARTIFACT_DATABASE_URL:
        `postgres://${encodeURIComponent(params.user)}:${encodeURIComponent(params.password)}@${params.host}:${params.port}/${database}`,
      ARTIFACTS_STORAGE_SCOPE: config.storageScope, ARTIFACTS_ORG_ID: config.orgId,
      ARTIFACTS_S3_BUCKET: config.s3Bucket, ARTIFACTS_S3_ENDPOINT: config.s3Endpoint,
      ARTIFACTS_S3_REGION: config.s3Region, ARTIFACTS_S3_ACCESS_KEY: config.s3AccessKey,
      ARTIFACTS_S3_SECRET_KEY: config.s3SecretKey, ARTIFACTS_CONTENT_BASE: BASE,
      ARTIFACTS_CONTROL_MODE: "general" };
    return { pool, host, beforeUpload: (hook) => { uploadHook = hook; }, control,
      durable, memberships, setStatus, bindingEnv, close };
  } catch (error) { await close(); throw error; }
}

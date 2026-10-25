import pg from "pg";
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import { composeArtifactHost, createArtifactControl, createArtifactsPool } from "@radar/artifacts-host";
import { loadConfig, type AuthConfig } from "../../src/config.js";
import { signSession } from "../../src/services/auth/session.js";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
export const auth: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar", clientSecret: "test-client",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback", scopes: "openid",
  appBaseUrl: "https://app.example.test", sessionSecret: "test-session-secret-32-bytes-padding",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/jwks", bearerAudiences: ["https://app.example.test"],
};
export async function cookie(sub: string) {
  return `radar_session=${await signSession({ sub }, { sessionSecret: auth.sessionSecret, ttlSeconds: 3600 })}`;
}

export async function startHarness(name: string) {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  const admin = new pg.Pool(params);
  const database = `artifacts_h2_${name}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const pool = createArtifactsPool({ ...params, database });
  await migrate(drizzle(pool), { migrationsFolder });
  const config = { enabled: true as const, storageScope: "h2_scope", orgId: "h2_org",
    s3Bucket: `h2-artifacts-${name}`, s3Endpoint: env.S3_ENDPOINT, s3Region: "us-east-1",
    s3AccessKey: env.S3_ACCESS_KEY, s3SecretKey: env.S3_SECRET_KEY };
  const s3 = new S3Client({ endpoint: config.s3Endpoint, forcePathStyle: true, region: config.s3Region,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey } });
  await s3.send(new CreateBucketCommand({ Bucket: config.s3Bucket }));
  const blobs = createTestS3BlobStore({ client: s3, bucket: config.s3Bucket });
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2)",
    [config.storageScope, config.orgId]);
  await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit)
    VALUES ($1, 1000000, 1000000000)`, [config.storageScope]);
  const host = (await composeArtifactHost(pool, config, blobs))!;
  const control = createArtifactControl(host, config.storageScope, "pages.example.test");
  return { pool, config, host, control, blobs,
    async close() {
      for (const key of await blobs.listKeys(`artifacts/${config.storageScope}/`)) await blobs.deleteBlob(key);
      await s3.send(new DeleteBucketCommand({ Bucket: config.s3Bucket }));
      host.close(); s3.destroy();
      await pool.end();
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
    },
  };
}
export type Harness = Awaited<ReturnType<typeof startHarness>>;

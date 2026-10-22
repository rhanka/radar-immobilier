/**
 * Sentropic provider acceptance suite (H4 v3 upstream request + P7).
 *
 * TARGET behavior for `@sentropic/artifacts` deliveries: this suite MUST FAIL
 * against the current provider (0.1.2, no finalization authorization, no typed
 * cause, no capability selection) and PASS once Sentropic ships those contracts.
 * Real composed provider via `composeArtifactHost` with PostgreSQL + S3, same
 * composition as `artifacts-commit-probe.spec.ts` / `artifacts-mcp-adapter.spec.ts`.
 *
 * Gate: ARTIFACTS_PROVIDER_ACCEPTANCE=1; otherwise all six cases are skipped.
 *
 * Sentropic runbook (pin candidate dependencies before running):
 *   rtk make -f tools/artifact-host.mk test-provider-acceptance \
 *     ARTIFACTS_PROVIDER_ACCEPTANCE=1 API_PORT=18986 UI_PORT=15986 \
 *     MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance
 *   rtk make -f tools/artifact-host.mk down API_PORT=18986 UI_PORT=15986 \
 *     MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance
 * The runner propagates the gate, starts PostgreSQL/S3, migrates and always
 * runs down -v --remove-orphans. No .env is read. Omit the variable to skip.
 *
 * Provisional extension bindings live ONLY in artifacts-provider-contract.helpers.ts.
 * Missing contracts fail by name. Cases 4/5 require the selected provider profile:
 * Radar-only replay/hash compensation does not qualify a provider delivery.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import {
  ArtifactS3TimeoutError,
  checkAdmission,
  composeArtifactHost,
  createArtifactControl,
  createArtifactsPool,
  createMemoryCommitLedger,
  createMemoryProviderProbe,
  deriveIdempotencyKey,
  type AdmissionAuthority,
} from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie, migrationsFolder } from "./artifacts-h2.helpers.js";
import { loadConfig } from "../../src/config.js";
import { bindFinalization, providerCauses, requireSelectedProfile } from "./artifacts-provider-contract.helpers.js";

const ENABLED = process.env.ARTIFACTS_PROVIDER_ACCEPTANCE === "1";
const DATABASE = "artifacts_h2_provider_acceptance";
const SCOPE = "provider_acceptance_scope";
const ORG = "provider_acceptance_org";
const BASE = "pages.example.test";
const BUCKET = "h2-artifacts-provider-acceptance";
const ACTOR = "alice";

describe.skipIf(!ENABLED)("sentropic provider acceptance (set ARTIFACTS_PROVIDER_ACCEPTANCE=1)", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let s3: S3Client;
  let endpoint = "";
  let accessKey = "";
  let secretKey = "";
  let databaseCreated = false;
  let bucketCreated = false;

  const rawBlobs = () => createS3BlobStore({ client: s3, bucket: BUCKET });
  const storageConfig = () => ({ enabled: true as const, storageScope: SCOPE, orgId: ORG,
    s3Bucket: BUCKET, s3Endpoint: endpoint, s3Region: "us-east-1",
    s3AccessKey: accessKey, s3SecretKey: secretKey });

  async function s3KeyCount(): Promise<number> {
    return [...(await rawBlobs().listKeys(`artifacts/${SCOPE}/`))].length;
  }

  async function tableCount(table: "releases" | "idempotency_keys" | "artifacts"): Promise<number> {
    return Number((await pool.query(`SELECT count(*) FROM artifacts.${table}`)).rows[0].count);
  }

  async function currentReleaseId(artifactId: string): Promise<string | undefined> {
    const rows = (await pool.query(
      "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows;
    return rows[0]?.release_id as string | undefined;
  }

  async function ensureArtifact(
    control: ReturnType<typeof createArtifactControl>, key: string,
  ): Promise<string> {
    const response = await control.handle("ensure", ACTOR, { bindingName: "acceptance", idempotencyKey: key });
    expect(response.status).toBe(201);
    return (response.body as { artifactId: string }).artifactId;
  }

  function admissionFor(status: () => Promise<string | null>, nowMs?: () => number): AdmissionAuthority {
    return {
      readActivation: () => ({ enabled: true, subjects: [ACTOR], expiresAtMs: Date.now() + 3_600_000 }),
      nowMs: nowMs ?? Date.now,
      readStatus: status,
    };
  }

  beforeAll(async () => {
    const env = loadConfig();
    endpoint = env.S3_ENDPOINT; accessKey = env.S3_ACCESS_KEY; secretKey = env.S3_SECRET_KEY;
    admin = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    databaseCreated = true;
    pool = createArtifactsPool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
    await migrate(drizzle(pool), { migrationsFolder });
    s3 = new S3Client({ endpoint, forcePathStyle: true, region: "us-east-1",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    bucketCreated = true;
    await pool.query("INSERT INTO account_users (sub, email, status) VALUES ('alice','alice@example.test','approved')");
  });

  afterAll(async () => {
    try {
      if (bucketCreated) {
        for (const key of await rawBlobs().listKeys(`artifacts/${SCOPE}/`)) await rawBlobs().deleteBlob(key);
        await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
      }
    } finally {
      s3?.destroy();
      await pool?.end();
      try {
        if (databaseCreated) await admin.query(`DROP DATABASE ${DATABASE} WITH (FORCE)`);
      } finally { await admin?.end(); }
    }
  });

});

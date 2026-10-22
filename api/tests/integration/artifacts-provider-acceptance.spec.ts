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

  it("refuses authorization during a provider wait without durable effects", async () => {
    const probe = createMemoryProviderProbe();
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs(), probe.record))!;
    try {
      const authority = admissionFor(async () => (await pool.query(
        "SELECT status FROM account_users WHERE sub = 'alice'")).rows[0]?.status ?? null);
      const decisions: boolean[] = [];
      bindFinalization(host, async (context) => {
        expect(context).toMatchObject({ actorId: ACTOR, storageScopeId: SCOPE });
        const decision = await checkAdmission(authority, context.actorId);
        if (context.operation === "publish") decisions.push(decision.allowed);
        return decision;
      });
      const control = createArtifactControl(host, SCOPE, BASE, authority, { ledger, probe });
      const artifactId = await ensureArtifact(control, "acceptance-refusal-ensure");
      const clientKey = "acceptance-refusal";
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "refused while blocked" }],
        idempotencyKey: clientKey };
      const lockId = deriveIdempotencyKey(
        { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey }).slice(0, 16);
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const s3Before = await s3KeyCount();
      const holder = await pool.connect();
      let pending: ReturnType<typeof control.handle> | undefined;
      try {
        await holder.query("SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)", [lockId]);
        pending = control.handle("publish", ACTOR, body);
        await expect.poll(async () => Number((await pool.query(
          "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted " +
          "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
        )).rows[0].count)).toBe(1);
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
        await holder.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
        const response = await pending;
        expect(decisions).toContain(false);
        expect(response.status).toBe(403);
        expect(entries).toEqual([{ op: "publish", actorId: ACTOR,
          reason: "unauthorized_at_commit", status: 403, atMs: expect.any(Number) }]);
        expect(await tableCount("releases")).toBe(releasesBefore);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore);
        expect(await currentReleaseId(artifactId)).toBeUndefined();
        expect(await s3KeyCount()).toBe(s3Before);
        expect(await control.handle("publish", ACTOR, body)).toEqual(response);
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
        const retry = await control.handle("publish", ACTOR, body);
        expect(retry.status).toBe(201);
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await currentReleaseId(artifactId)).toBe(
          (retry.body as { releaseId: string }).releaseId);
        expect(entries).toHaveLength(1);
      } finally {
        await holder.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
        holder.release();
        await pending?.catch(() => {});
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      }
    } finally {
      host.close();
    }
  });

  it("maps an injected S3 timeout below the HTTP layer to 503 without internals", async () => {
    const { ledger, entries } = createMemoryCommitLedger();
    const fault = new ArtifactS3TimeoutError("blobs.putBlob");
    let injected = false;
    const broken = (await composeArtifactHost(pool, storageConfig(), { ...rawBlobs(),
      async putBlob() { injected = true; throw fault; } }))!;
    try {
      const { probe, causes } = providerCauses(broken);
      const control = createArtifactControl(broken, SCOPE, BASE, undefined, { ledger, probe });
      const artifactId = await ensureArtifact(control, "acceptance-s3-ensure");
      const releasesBefore = await tableCount("releases");
      const response = await control.handle("publish", ACTOR,
        { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "s3 timeout" }],
          idempotencyKey: "acceptance-s3" });
      expect(injected).toBe(true);
      expect(causes).toContain(fault);
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(JSON.stringify(response.body)).not.toMatch(/timeout|stack|connection|lost|Error/i);
      expect(entries).toEqual([{ op: "publish", actorId: ACTOR,
        reason: "provider_unavailable", status: 503, atMs: expect.any(Number) }]);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      broken.close();
    }
  });

  it("maps a lost Postgres connection to provider_unavailable, never conflict", async () => {
    const armed = { current: false };
    let injected = false;
    const flaky = new Proxy(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => {
          injected = true;
          throw Object.assign(new Error("terminating connection lost by peer"), { code: "57P06" });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const { ledger, entries } = createMemoryCommitLedger();
    const host = (await composeArtifactHost(flaky, storageConfig(), rawBlobs()))!;
    try {
      const { probe, causes } = providerCauses(host);
      const control = createArtifactControl(host, SCOPE, BASE, undefined, { ledger, probe });
      const before = await tableCount("artifacts");
      const keysBefore = await tableCount("idempotency_keys");
      armed.current = true;
      const response = await control.handle("ensure", ACTOR,
        { bindingName: "acceptance-lost", idempotencyKey: "acceptance-lost" });
      armed.current = false;
      expect(injected).toBe(true);
      expect(causes.length).toBeGreaterThan(0);
      expect(response).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(JSON.stringify(response.body)).not.toMatch(/lost|terminat|57P06|connection|Error/i);
      expect(entries).toEqual([{ op: "ensure", actorId: ACTOR,
        reason: "provider_unavailable", status: 503, atMs: expect.any(Number) }]);
      expect(await tableCount("artifacts")).toBe(before);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
    } finally {
      armed.current = false;
      host.close();
    }
  });

  it("replays HTTP to MCP and MCP to HTTP as one durable release per key", async () => {
    for (const direction of ["http-first", "mcp-first"]) {
      const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
      try {
        requireSelectedProfile(host);
        const control = createArtifactControl(host, SCOPE, BASE);
        const route = controlRoute({ auth, accounts: pool, backend: control });
        const httpPublish = async (args: unknown) => {
          const response = await route.request("https://app.example.test/publish", {
            method: "POST", headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
              "content-type": "application/json" }, body: JSON.stringify(args),
          });
          return { status: response.status, body: await response.json() as Record<string, unknown> };
        };
        const ensured = await control.handle("ensure", ACTOR,
          { bindingName: direction, idempotencyKey: direction });
        expect(ensured.status).toBe(201);
        const artifactId = (ensured.body as { artifactId: string }).artifactId;
        const second = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
        try {
          requireSelectedProfile(second);
          const adapter = createMcpArtifactAdapter(createArtifactControl(second, SCOPE, BASE));
          const args = { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
            idempotencyKey: ` ${direction} ` };
          const mcp = () => adapter.execute({ method: "POST", path: "/publish", args }, { actorId: ACTOR });
          const bodyOf = (value: unknown) => "body" in (value as Record<string, unknown>)
            ? (value as { body: unknown }).body
            : (value as { ok: boolean; data: unknown }).data;
          const releasesBefore = await tableCount("releases");
          const keysBefore = await tableCount("idempotency_keys");
          const objectsBefore = await s3KeyCount();
          const first = direction === "http-first" ? await httpPublish(args) : await mcp();
          const objectsAfter = await s3KeyCount();
          const replay = direction === "http-first" ? await mcp() : await httpPublish(args);
          expect(first.status).toBe(201);
          expect(replay.status).toBe(201);
          expect(await tableCount("releases")).toBe(releasesBefore + 1);
          expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
          expect(objectsAfter).toBeGreaterThan(objectsBefore);
          expect(await s3KeyCount()).toBe(objectsAfter);
          expect(bodyOf(replay)).toEqual(bodyOf(first));
          expect(bodyOf(first)).toEqual({ artifactId, releaseId: expect.any(String),
            digest: expect.any(String), stableUrl: expect.any(String), pinnedUrl: expect.any(String) });
          expect(await currentReleaseId(artifactId)).toBe((bodyOf(first) as { releaseId: string }).releaseId);
        } finally { second.close(); }
      } finally {
        host.close();
      }
    }
  });

});

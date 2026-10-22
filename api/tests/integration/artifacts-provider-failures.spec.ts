/**
 * Q2 extension: provider failure matrix (spec r2 sections 4.1 and 4.2, H4 P7).
 *
 * Extension of `artifacts-provider-acceptance.spec.ts`, which remains the
 * entrypoint. Same gate (`ARTIFACTS_PROVIDER_ACCEPTANCE=1`), same skip
 * behavior without it, same `[missing-contract]` failure naming the missing
 * upstream entry against 0.1.2.
 *
 * Every case injects BELOW the real `host.execute` path (broken blob store,
 * armed pool/connection proxy, query-text fault proxy), never by replacing
 * `app.execute` with a throwing stub. Typed outcomes are read from
 * `host.execute(request, invocation)` BEFORE projection with
 * `assertOutcomeFailure` (`outcome.ok === false`, private
 * `outcome.failure.cause`, category, invocation ID); the sanitized wire form
 * is read through `projectArtifactHttpOutcome`, and no private cause, stack,
 * SQL, endpoint, bucket name, storage ID or credential may appear in it.
 * The compensating Radar probe is disabled on this path: it must not repair
 * a broken upstream mapping.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, DeleteBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import {
  composeArtifactHost,
  createArtifactControl,
  createArtifactsPool,
  deriveIdempotencyKey,
} from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { auth, cookie, migrationsFolder } from "./artifacts-h2.helpers.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { loadConfig } from "../../src/config.js";
import {
  assertOutcomeFailure,
  authorizeTransaction,
  buildInvocationContext,
  FROZEN_CAPABILITIES,
  projectOutcomeHttp,
  proxyLeasedPool,
  requireCommitBarrier,
  requireCommitContract,
  requireHostExecute,
  requireOutcomeContract,
  requireSelectedProfile,
  type AuthorizeCommit,
  type InvocationContextShape,
} from "./artifacts-provider-contract.helpers.js";

let nextInvocationId = 1;
const ENABLED = process.env.ARTIFACTS_PROVIDER_ACCEPTANCE === "1";
if (!ENABLED) {
  console.info("[acceptance-disabled] provider failures skipped without ARTIFACTS_PROVIDER_ACCEPTANCE=1");
}
const DATABASE = "artifacts_h2_provider_failures";
const SCOPE = "provider_failures_scope";
const ORG = "provider_failures_org";
const BASE = "pages.example.test";
const BUCKET = "h2-artifacts-provider-failures";
const ACTOR = "alice";

describe.skipIf(!ENABLED)("provider failures Q2 (set ARTIFACTS_PROVIDER_ACCEPTANCE=1)", () => {
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

  async function tableCount(table: "releases" | "idempotency_keys" | "artifacts"): Promise<number> {
    return Number((await pool.query(`SELECT count(*) FROM artifacts.${table}`)).rows[0].count);
  }

  async function composeQ2Host(
    observer: unknown,
    overrides?: { readonly pool?: pg.Pool | undefined; readonly blobs?: unknown | undefined },
  ): Promise<NonNullable<Awaited<ReturnType<typeof composeArtifactHost>>> & Record<string, unknown>> {
    await requireCommitContract();
    const compose = composeArtifactHost as unknown as (
      pool: unknown, config: unknown, blobs: unknown, options?: unknown,
    ) => Promise<unknown>;
    return (await compose(overrides?.pool ?? pool, storageConfig(), overrides?.blobs ?? rawBlobs(), {
      profile: { selectedCapabilities: [...FROZEN_CAPABILITIES] },
      coordinator: { testObserver: observer },
    })) as NonNullable<Awaited<ReturnType<typeof composeArtifactHost>>> & Record<string, unknown>;
  }

  function invocationFor(authorizeCommit: AuthorizeCommit, suffix: string): Record<string, unknown> {
    return buildInvocationContext({
      invocationId: `q2-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    }) as unknown as Record<string, unknown>;
  }

  function allowAll(): AuthorizeCommit {
    return authorizeTransaction;
  }

  // Observe the real execute path. This wrapper neither classifies failures
  // nor repairs a response: HTTP and MCP must consume the provider outcome.
  function executeWithParity(host: Record<string, unknown>) {
    const execute = requireHostExecute(host);
    return async (request: unknown, invocation: unknown): Promise<unknown> => {
      const outcome = await execute(request, invocation) as Record<string, unknown>;
      if (outcome.ok !== false) return outcome;
      const failure = outcome.failure as Record<string, unknown>;
      const projected = await projectOutcomeHttp(outcome);
      const req = request as { method: string; path: string; body: Record<string, unknown> };
      for (const transport of ["http", "mcp"] as const) {
        const entries: Record<string, unknown>[] = [];
        const observed: Record<string, unknown>[] = [];
        const observe = async (r: unknown, context: unknown) => {
          const ctx = context as InvocationContextShape;
          const result = await execute(r, buildInvocationContext({ ...ctx,
            authorizeCommit: (invocation as InvocationContextShape).authorizeCommit })) as Record<string, unknown>;
          observed.push(result);
          return result;
        };
        const instrumented = { ...host, execute: observe,
          app: { ...host.app as object, execute: observe } };
        const control = createArtifactControl(instrumented as unknown as Parameters<typeof createArtifactControl>[0],
          SCOPE, BASE, undefined, { ledger: { record: (entry) => {
            entries.push(entry as unknown as Record<string, unknown>);
          } } });
        if (transport === "http") {
          const route = controlRoute({ auth, accounts: pool, backend: control });
          const path = req.method === "GET" ? `/meta?artifactId=${req.path.slice("/meta/".length)}` : req.path;
          const response = await route.request(`https://app.example.test${path}`, {
            method: req.method, headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
              "content-type": "application/json" },
            ...(req.method === "GET" ? {} : { body: JSON.stringify(req.body) }),
          });
          expect({ status: response.status, body: await response.json() }).toEqual(projected);
        } else {
          const result = await createMcpArtifactAdapter(control).execute({
            method: req.method, path: req.path, args: req.body }, { actorId: ACTOR });
          expect(result).toMatchObject({ ok: false, status: projected.status,
            code: failure.code, retryable: failure.retriable });
          expectRedacted({ status: result.status, body: result });
        }
        const dispatched = req.method === "POST" && ["/publish", "/ensure"].includes(req.path) &&
          failure.code !== "invalid_request" && failure.category !== "capability_unselected";
        expect(entries).toHaveLength(dispatched ? 1 : 0);
        if (dispatched) {
          expect(observed).toHaveLength(1);
          const actual = observed[0]!.failure as Record<string, unknown>;
          assertOutcomeFailure(observed[0], actual.invocationId as string);
          expect(entries[0]).toMatchObject({ invocationId: actual.invocationId,
            reason: failure.category === "conflict" ? "provider_conflict" : failure.category,
            status: projected.status });
        }
      }
      return outcome;
    };
  }

  async function ensureVia(
    execute: (request: unknown, invocation: unknown) => Promise<unknown>,
    authorizeCommit: AuthorizeCommit,
    bindingName: string,
    clientKey: string,
  ): Promise<string> {
    const outcome = await execute({ method: "POST", path: "/ensure",
      body: { bindingName, idempotencyKey: clientKey } },
      invocationFor(authorizeCommit, `ensure-${clientKey}`));
    expect(outcome).toMatchObject({ ok: true });
    return ((outcome as { result: unknown }).result as { body: { artifactId: string } }).body.artifactId;
  }

  function expectRedacted(projected: { status: number; body: unknown }): void {
    const text = JSON.stringify(projected.body);
    expect(text).not.toMatch(/stack|BEGIN|COMMIT|SELECT|secret|credential|password/i);
    expect(text).not.toContain(BUCKET);
    expect(text).not.toContain(endpoint);
    expect(text).not.toContain(accessKey);
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
        for (const key of await rawBlobs().listKeys("")) await rawBlobs().deleteBlob(key);
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

  it("maps an S3 request timeout to provider_unavailable with a redacted projection", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const faulty = { ...rawBlobs(),
      async putBlob() {
        throw Object.assign(new Error("request timeout"), { code: "artifact_s3_timeout" });
      } };
    const host = await composeQ2Host(barrier.observer, { blobs: faulty });
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const artifactId = await ensureVia(execute, allowAll(), "q2-s3", "q2-s3-ensure");
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(allowAll(), "s3");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "s3 request timeout" }],
          idempotencyKey: "q2-s3" } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(outcome["failure"]).toMatchObject({
        category: "provider_unavailable", retriable: true, commitState: "not_committed" });
      const projected = await projectOutcomeHttp(outcome);
      expect(projected).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expectRedacted(projected);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("maps an S3 body-stream timeout to provider_unavailable with a redacted projection", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    let streamReads = 0;
    const streaming = new Proxy(s3, { get(target, property) {
      if (property === "send") return async (command: unknown) => {
        const send = target.send.bind(target) as (command: unknown) => Promise<Record<string, unknown>>;
        const response = await send(command);
        if (!(command instanceof GetObjectCommand) || !response.Body) return response;
        // Headers arrived from S3. Failure occurs when the adapter consumes
        // the body, rather than before it sends PUT or GET.
        return { ...response, Body: new Proxy(response.Body as object, { get(body, key) {
          if (key === "transformToByteArray") return async () => {
            streamReads++;
            throw Object.assign(new Error("body stream stalled after headers"), {
              code: "artifact_s3_timeout", phase: "body-stream" });
          };
          const value = Reflect.get(body, key);
          return typeof value === "function" ? value.bind(body) : value;
        } }) };
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const faulty = createS3BlobStore({ client: streaming, bucket: BUCKET });
    const host = await composeQ2Host(barrier.observer, { blobs: faulty });
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const artifactId = await ensureVia(execute, allowAll(), "q2-s3stream", "q2-s3stream-ensure");
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(allowAll(), "s3stream");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "s3 body stream timeout" }],
          idempotencyKey: "q2-s3stream" } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(outcome["failure"]).toMatchObject({
        category: "provider_unavailable", retriable: true, commitState: "not_committed" });
      const projected = await projectOutcomeHttp(outcome);
      expect(projected).toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expectRedacted(projected);
      expect(streamReads).toBeGreaterThan(0);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("maps a pool acquisition timeout to provider_unavailable without a commit", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const armed = { current: false };
    const starved = proxyLeasedPool(pool, { get(target, property, receiver) {
      if (property === "connect" && armed.current) {
        return async (): Promise<never> => {
          throw Object.assign(new Error("pool acquisition timed out"), { code: "artifact_pool_timeout" });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as pg.Pool;
    const host = await composeQ2Host(barrier.observer, { pool: starved });
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const before = await tableCount("artifacts");
      const keysBefore = await tableCount("idempotency_keys");
      armed.current = true;
      try {
        const invocation = invocationFor(allowAll(), "pool");
        const outcome = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "q2-pool", idempotencyKey: "q2-pool" } },
          invocation) as unknown as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocation["invocationId"] as string);
        expect(outcome["failure"]).toMatchObject({
          category: "provider_unavailable", retriable: true, commitState: "not_committed" });
      } finally {
        armed.current = false;
      }
      expect(await tableCount("artifacts")).toBe(before);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });
});
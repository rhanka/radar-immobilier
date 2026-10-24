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
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, DeleteBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import {
  createArtifactControl,
  createArtifactsPool,
  deriveIdempotencyKey,
} from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { auth, cookie, migrationsFolder } from "./artifacts-h2.helpers.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { loadConfig } from "../../src/config.js";
import {
  assertMcpResultRedacted,
  assertOutcomeFailure,
  assertPublicBodyRedacted,
  authorizeTransaction,
  buildInvocationContext,
  composeR2AcceptanceHost,
  createPrivateMarker,
  projectOutcomeHttp,
  proxyLeasedPool,
  finalizationFaultPool,
  committedState,
  requireCommitBarrier,
  requireHostExecute,
  requirePhaseInjectionBinding,
  requireOutcomeContract,
  requireSelectedProfile,
  type AuthorizeCommit,
  type CommitBarrier,
  type CompiledArtifactsProfile,
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
    barrier: CommitBarrier,
    overrides?: { readonly pool?: pg.Pool | undefined; readonly blobs?: unknown | undefined },
  ): Promise<{ readonly host: Record<string, unknown>; readonly profile: CompiledArtifactsProfile }> {
    return composeR2AcceptanceHost({
      pool: overrides?.pool ?? pool,
      config: storageConfig(),
      blobs: overrides?.blobs ?? rawBlobs(),
      barrier,
    });
  }

  function invocationFor(authorizeCommit: AuthorizeCommit, suffix: string): InvocationContextShape {
    return buildInvocationContext({
      invocationId: `q2-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    });
  }

  function allowAll(): AuthorizeCommit {
    return authorizeTransaction;
  }

  async function failViaTransport(host: Record<string, unknown>,
    request: { method: string; path: string; body: Record<string, unknown> },
    transport: "http" | "mcp", guard: AuthorizeCommit = allowAll()): Promise<Record<string, unknown>> {
    const execute = requireHostExecute(host);
    const observed: Record<string, unknown>[] = [];
    const ids: string[] = [];
    const entries: Record<string, unknown>[] = [];
    const observe = async (req: unknown, context: unknown) => {
      const invocation = context as InvocationContextShape;
      ids.push(invocation.invocationId);
      const outcome = await execute(req, buildInvocationContext({ ...invocation,
        authorizeCommit: guard })) as Record<string, unknown>;
      observed.push(outcome);
      return outcome;
    };
    const control = createArtifactControl({ ...host, execute: observe,
      app: { ...host.app as object, execute: observe } } as never, SCOPE, BASE, undefined,
    { ledger: { record: (entry) => { entries.push({ ...entry }); } } });
    if (transport === "http") {
      const response = await controlRoute({ auth, accounts: pool, backend: control }).request(
        `https://app.example.test${request.path}`, {
          method: request.method, headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
            "content-type": "application/json" }, body: JSON.stringify(request.body),
        });
      expect(response.status).toBe(503);
      assertPublicBodyRedacted({ status: response.status, body: await response.json() },
        { error: "capability_unavailable" }, [], [BUCKET, endpoint, accessKey, SCOPE]);
    } else {
      const result = await createMcpArtifactAdapter(control).execute(
        { method: request.method, path: request.path, args: request.body }, { actorId: ACTOR });
      assertMcpResultRedacted(result, { status: 503, code: "capability_unavailable",
        retryable: true, publicError: "capability_unavailable" }, [], [BUCKET, endpoint, accessKey, SCOPE]);
    }
    expect(ids).toHaveLength(1);
    expect(observed).toHaveLength(1);
    const outcome = observed[0]!;
    assertOutcomeFailure(outcome, ids[0]);
    expect(outcome.failure).toMatchObject({ category: "provider_unavailable", status: 503,
      code: "capability_unavailable", retriable: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ invocationId: ids[0], reason: "provider_unavailable", status: 503 });
    return outcome;
  }

  // Observe the real execute path. This wrapper neither classifies failures
  // nor repairs a response: HTTP and MCP must consume the provider outcome.
  // Private fault markers travel with the wrapper so the MCP leg asserts the
  // same redaction as the direct projection: a correct MCP response carrying
  // the marker in any representation (text, error.debug, _meta) must fail.
  function executeWithParity(host: Record<string, unknown>,
    options?: { readonly privateMarkers?: readonly string[]; readonly secrets?: readonly string[] }) {
    const execute = requireHostExecute(host);
    const parityMarkers = options?.privateMarkers ?? [];
    const paritySecrets = options?.secrets ?? [BUCKET, endpoint, accessKey, SCOPE, secretKey];
    return async (request: unknown, invocation: unknown): Promise<unknown> => {
      const outcome = await execute(request, invocation) as Record<string, unknown>;
      if (outcome.ok !== false) return outcome;
      const failure = outcome.failure as Record<string, unknown>;
      const projected = await projectOutcomeHttp(outcome);
      const req = request as { method: string; path: string; body: Record<string, unknown> };
      for (const transport of ["http", "mcp"] as const) {
        const entries: Record<string, unknown>[] = [];
        const observed: Record<string, unknown>[] = [];
        const dispatchedIds: string[] = [];
        const observe = async (r: unknown, context: unknown) => {
          const ctx = context as InvocationContextShape;
          dispatchedIds.push(ctx.invocationId);
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
          // Reinforced structural check on the actually obtained MCP result:
          // exact public error shape plus marker/secret sweep over every
          // serialized representation. The old substring check let a correct
          // response augmented with the private stream marker through.
          const wireError = (projected.body as { error?: unknown } | null)?.error;
          assertMcpResultRedacted(result, { status: projected.status,
            code: String(failure.code), retryable: Boolean(failure.retriable),
            publicError: typeof wireError === "string" ? wireError : String(failure.code) },
            parityMarkers, paritySecrets);
        }
        const dispatched = req.method === "POST" && ["/publish", "/ensure"].includes(req.path) &&
          failure.code !== "invalid_request" && failure.category !== "capability_unselected";
        expect(entries).toHaveLength(dispatched ? 1 : 0);
        if (dispatched) {
          expect(observed).toHaveLength(1);
          assertOutcomeFailure(observed[0], dispatchedIds[0]);
          expect(entries[0]).toMatchObject({ invocationId: dispatchedIds[0],
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

  function expectRedacted(projected: { status: number; body: unknown }, privateMarkers: readonly string[] = []): void {
    const text = JSON.stringify(projected.body);
    expect(text).not.toMatch(/BEGIN|COMMIT|SELECT\s+\S+\s+FROM|FOR\s+(UPDATE|SHARE)|secret|credential|password/i);
    expect(text).not.toMatch(/storageScopeId|storageScope|internalKey|paramsHash/i);
    for (const marker of privateMarkers) {
      if (marker.length > 0) expect(text).not.toContain(marker);
    }
    expect(text).not.toContain(BUCKET);
    expect(text).not.toContain(endpoint);
    expect(text).not.toContain(accessKey);
    expect(text).not.toContain(SCOPE);
    if (secretKey.length > 0) expect(text).not.toContain(secretKey);
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
    const requestMarker = createPrivateMarker("s3_request");
    const faulty = { ...rawBlobs(),
      async putBlob() {
        throw Object.assign(new Error(`request timeout ${requestMarker}`), { code: "artifact_s3_timeout", phase: "s3-request" });
      } };
    const composed = await composeQ2Host(barrier, { blobs: faulty });
    const host = composed.host;
    const close = host["close"];
    try {
      const execute = executeWithParity(host, { privateMarkers: [requestMarker],
        secrets: [BUCKET, endpoint, accessKey, SCOPE, secretKey] });
      const artifactId = await ensureVia(execute, allowAll(), "q2-s3", "q2-s3-ensure");
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(allowAll(), "s3");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "s3 request timeout" }],
          idempotencyKey: "q2-s3" } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(outcome["failure"]).toMatchObject({
        category: "provider_unavailable", retriable: true, commitState: "not_committed", phase: "s3-request" });
      expect((outcome["failure"] as Record<string, unknown>)["cause"]).toMatchObject({ code: "artifact_s3_timeout" });
      const projected = await projectOutcomeHttp(outcome);
      assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [requestMarker], [BUCKET, endpoint, accessKey]);
      expectRedacted(projected, [requestMarker]);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("maps an S3 body-stream timeout to provider_unavailable with a redacted projection", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const streamMarker = createPrivateMarker("s3_body_stream");
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
            throw Object.assign(new Error(`body stream stalled after headers ${streamMarker}`), {
              code: "artifact_s3_timeout", phase: "body-stream", marker: streamMarker });
          };
          const value = Reflect.get(body, key);
          return typeof value === "function" ? value.bind(body) : value;
        } }) };
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const composed = await composeQ2Host(barrier, { blobs: createS3BlobStore({ client: streaming, bucket: BUCKET }) });
    const host = composed.host;
    const close = host["close"];
    try {
      const execute = executeWithParity(host, { privateMarkers: [streamMarker],
        secrets: [BUCKET, endpoint, accessKey, SCOPE, secretKey] });
      const artifactId = await ensureVia(execute, allowAll(), "q2-s3stream", "q2-s3stream-ensure");
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(allowAll(), "s3stream");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "s3 body stream timeout" }],
          idempotencyKey: "q2-s3stream" } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(outcome["failure"]).toMatchObject({
        category: "provider_unavailable", retriable: true, commitState: "not_committed", phase: "body-stream" });
      expect((outcome["failure"] as Record<string, unknown>)["cause"]).toMatchObject({ code: "artifact_s3_timeout" });
      const projected = await projectOutcomeHttp(outcome);
      assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [streamMarker], [BUCKET, endpoint, accessKey]);
      expectRedacted(projected, [streamMarker]);
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
    const { host } = await composeQ2Host(barrier, { pool: starved });
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

  it.each([
    ["57P06", Object.assign(new Error("terminating connection"), { code: "57P06" })],
    ["artifact_connection_lost", Object.assign(new Error("connection lost"), { code: "artifact_connection_lost" })],
    ["class-08", Object.assign(new Error("connection failure"), { code: "08006" })],
    ["network-reset", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["unqualified-55P03", Object.assign(new Error("unqualified timeout"), { code: "55P03" })],
  ])("maps connection loss %s to provider_unavailable, never conflict", async (_name, fault) => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const armed = { current: false };
    const flaky = proxyLeasedPool(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => { throw fault; };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as pg.Pool;
    const { host } = await composeQ2Host(barrier, { pool: flaky });
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const before = await tableCount("artifacts");
      armed.current = true;
      try {
        const invocation = invocationFor(allowAll(), "conn");
        const outcome = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "q2-conn", idempotencyKey: "q2-conn" } },
          invocation) as unknown as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocation["invocationId"] as string);
        expect(outcome["failure"]).toMatchObject({
          category: "provider_unavailable", retriable: true, commitState: "not_committed" });
        expect(outcome["failure"]).not.toMatchObject({ category: "conflict" });
      } finally {
        armed.current = false;
      }
      expect(await tableCount("artifacts")).toBe(before);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("maps real contention for the full scoped key to conflict and retains 55P03", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const keyLockAttempts = { keyLock: 0 };
    const timed = proxyLeasedPool(pool, { get(target, property, receiver) {
      if (property === "query") return async (text: unknown, params?: unknown) => {
        if (typeof text === "string" && /operation_keys/.test(text) && /FOR UPDATE/.test(text)) {
          keyLockAttempts.keyLock++;
        }
        const result = await (target.query as (...args: unknown[]) => Promise<unknown>)(text, params);
        if (typeof text === "string" && /^BEGIN/i.test(text)) {
          await target.query("SET LOCAL lock_timeout = '150ms'");
        }
        return result;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const composed = await composeQ2Host(barrier, { pool: timed });
    const host = composed.host;
    const holder = await pool.connect();
    try {
      const execute = executeWithParity(host);
      const artifactId = await ensureVia(execute, allowAll(), "q2-keylock", "q2-keylock-ensure");
      const internalKey = deriveIdempotencyKey({ scope: SCOPE, sub: ACTOR, op: "publish",
        artifactId, clientKey: "q2-keylock" });
      await pool.query("INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key) VALUES ($1,$2) ON CONFLICT DO NOTHING", [SCOPE, internalKey]);
      await holder.query("BEGIN");
      const locked = await holder.query("SELECT internal_key FROM artifacts.operation_keys WHERE storage_scope_id=$1 AND internal_key=$2 FOR UPDATE", [SCOPE, internalKey]);
      expect(locked.rows).toEqual([{ internal_key: internalKey }]);
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const invocation = invocationFor(allowAll(), "keylock");
      const outcome = await execute({ method: "POST", path: "/publish", body: { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "key lock conflict" }],
        idempotencyKey: "q2-keylock" } }, invocation) as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation.invocationId as string);
      expect(keyLockAttempts.keyLock).toBeGreaterThan(0);
      expect(outcome.failure).toMatchObject({ category: "conflict", retriable: false,
        commitState: "not_committed", cause: { code: "55P03" }, phase: "key-lock" });
      expect(await projectOutcomeHttp(outcome)).toEqual({ status: 409, body: { error: "conflict" } });
      expect(await tableCount("releases")).toBe(releasesBefore);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
    } finally {
      await holder.query("ROLLBACK"); holder.release(); (host["close"] as () => void)();
    }
  });

  it.each([
    "binding",
    "artifact-lifecycle",
    "acl",
    "pointer",
    "policy",
    "quota",
    "blob-reference",
    "deletion-claim",
  ])("maps a 55P03 outside the key row (%s) to provider_unavailable", async (lockClass) => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const probe = finalizationFaultPool(pool, { code: "55P03", lockClass });
    const { host } = await composeQ2Host(barrier, { pool: probe.pool });
    const close = host["close"];
    try {
      const setup = requireHostExecute(host);
      const artifactId = await ensureVia(setup, allowAll(), "q2-nonkey", "q2-nonkey-ensure");
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      // Each transport uses an independent caller key and a rearmed injection,
      // with one correlated write-ledger entry per failed dispatch.
      for (const transport of ["http", "mcp"] as const) {
        const clientKey = `q2-nonkey-${lockClass}-${transport}`;
        const isBinding = lockClass === "binding";
        const body = isBinding
          ? { bindingName: `q2-nonkey-${lockClass}-${transport}`, idempotencyKey: clientKey }
          : { artifactId,
            files: [{ path: "index.html", mimeType: "text/html", text: "non-key lock timeout" }],
            idempotencyKey: clientKey };
        Object.assign(probe.evidence, { armed: true, injections: 0, attempts: 0, writes: 0, phase: "" });
        try {
          const outcome = await failViaTransport(host, { method: "POST",
            path: isBinding ? "/ensure" : "/publish", body }, transport);
          expect(outcome.failure).toMatchObject({ cause: { code: "55P03" }, commitState: "not_committed" });
          expect(probe.evidence.injections).toBe(1);
          expect(probe.evidence.phase).toBe(lockClass);
          expect(probe.evidence.attempts).toBeLessThanOrEqual(1);
          expect(await tableCount("releases")).toBe(releasesBefore);
          expect(await tableCount("idempotency_keys")).toBe(keysBefore);
        } finally {
          probe.evidence.armed = false;
        }
      }
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each(["schema-infrastructure", "unqualified"] as const)(
    "requires an explicit phase-injection joint for E3 cause %s, never optional SQL",
    async (phase) => {
      // r2 imposes no LOCK TABLE / pg_catalog.* or SET LOCAL shape. A
      // conforming coordinator using implicit PostgreSQL locks must fail here
      // by named joint, never on an optional-form assertion.
      await requirePhaseInjectionBinding(phase);
    },
  );

  it.each(["40001", "40P01", "57014"])("maps %s after provisional writes without an internal retry", async (code) => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const probe = finalizationFaultPool(pool, { code });
    const { host } = await composeQ2Host(barrier, { pool: probe.pool });
    try {
      // One independent caller key and one rearmed injection per transport, with
      // one correlated ledger entry per failed dispatch. A hidden provider
      // retry would surface as injections !== 1 or as a second ledger entry.
      for (const transport of ["http", "mcp"] as const) {
        const clientKey = `q2-abort-${code}-${transport}`;
        const body = { bindingName: `q2-abort-${code}-${transport}`, idempotencyKey: clientKey };
        const before = await committedState(pool);
        Object.assign(probe.evidence, { armed: true, injections: 0, attempts: 0, writes: 0, phase: "" });
        try {
          const outcome = await failViaTransport(host, { method: "POST", path: "/ensure", body }, transport);
          expect(outcome.failure).toMatchObject({ cause: { code }, commitState: "not_committed" });
          expect(probe.evidence).toMatchObject({ injections: 1, attempts: 1, phase: "provisional-write" });
          expect(probe.evidence.writes).toBeGreaterThan(0);
          expect(await committedState(pool)).toEqual(before);
        } finally {
          probe.evidence.armed = false;
        }
      }
    } finally { (host["close"] as () => void)(); }
  });

  it.each(["http", "mcp"] as const)("reports commitState unknown on %s COMMIT loss and recovers by key", async (transport) => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const probe = finalizationFaultPool(pool, { code: "57P06", loseCommitAck: true });
    const state = probe.evidence;
    const { host } = await composeQ2Host(barrier, { pool: probe.pool });
    const close = host["close"];
    try {
      const execute = requireHostExecute(host);
      const artifactId = await ensureVia(execute, allowAll(), `q2-unknown-${transport}`, `q2-unknown-ensure-${transport}`);
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "commit uncertainty" }],
        idempotencyKey: `q2-unknown-${transport}` };
      const internalKey = deriveIdempotencyKey({ scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey: body.idempotencyKey });
      const releasesBefore = await tableCount("releases");
      const guard: AuthorizeCommit = async (context, transaction) => {
        const decision = await authorizeTransaction(context, transaction);
        state.guardPassed = true;
        state.armed = true;
        return decision;
      };
      const uncertain = await failViaTransport(host, { method: "POST", path: "/publish", body }, transport, guard);
      expect(state.commits).toBe(1);
      expect(uncertain.failure).toMatchObject({ category: "provider_unavailable", status: 503,
        retriable: true, cause: { code: "57P06" }, commitState: "unknown" });
      const commitState = (uncertain["commitState"] as string | undefined) ??
        ((uncertain["failure"] as Record<string, unknown> | undefined)?.["commitState"] as string | undefined);
      expect(commitState).toBe("unknown");
      expect(JSON.stringify(uncertain)).not.toMatch(/no effects/i);
      const env = (await import("../../src/config.js")).loadConfig();
      const peer = new (await import("pg")).default.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
        user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
      let durableReceipt: unknown;
      try {
        const durable = Number((await peer.query(
          "SELECT count(*) FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].count);
        expect(durable).toBe(1);
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        const success = (await peer.query("SELECT result FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows;
        expect(success).toHaveLength(1);
        durableReceipt = success[0].result;
        expect(durableReceipt).toBeDefined();
      } finally { await peer.end(); }
      state.armed = false;
      const retry = await execute({ method: "POST", path: "/publish", body },
        invocationFor(allowAll(), "uncertain-retry")) as unknown as Record<string, unknown>;
      expect(retry).toMatchObject({ ok: true, replayed: true });
      expect((retry.result as { body: unknown }).body).toEqual(durableReceipt);
      // The first uncertain issue (503, commitState unknown) is distinct from
      // the legitimate receipt replay below: both transports converge on the
      // same durable receipt with the same key and no new release.
      const entries: Record<string, unknown>[] = [];
      const parityControl = createArtifactControl(host as never, SCOPE, BASE, undefined,
        { ledger: { record: (entry) => { entries.push(entry as unknown as Record<string, unknown>); } } });
      const route = controlRoute({ auth, accounts: pool, backend: parityControl });
      const httpReplay = await route.request("https://app.example.test/publish", {
        method: "POST", headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
          "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect(httpReplay.status).toBe(201);
      expect(await httpReplay.json()).toEqual(durableReceipt);
      const adapter = createMcpArtifactAdapter(parityControl);
      const mcpReplay = await adapter.execute(
        { method: "POST", path: "/publish", args: body }, { actorId: ACTOR });
      expect(mcpReplay).toMatchObject({ ok: true, status: 201 });
      expect((mcpReplay as { ok: true; data: unknown }).data).toEqual(durableReceipt);
      expect(entries).toHaveLength(0);
      expect(await tableCount("releases")).toBe(releasesBefore + 1);
      const successRows = Number((await pool.query(
        "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows[0].count);
      expect(successRows).toBe(1);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("rejects same-key changed content as conflict with no extra release", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ2Host(barrier);
    const { host } = composed;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = executeWithParity(host);
      const artifactId = await ensureVia(execute, allowAll(), "q2-conflict", "q2-conflict-ensure");
      const files = [{ path: "index.html", mimeType: "text/html", text: "hello" }];
      const clientKey = "q2-conflict";
      const internalKey = deriveIdempotencyKey(
        { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey });
      const first = await execute({ method: "POST", path: "/publish", body: { artifactId, files, idempotencyKey: clientKey } },
        invocationFor(allowAll(), "conflict-first")) as unknown as Record<string, unknown>;
      expect(first).toMatchObject({ ok: true });
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const invocation = invocationFor(allowAll(), "conflict-changed");
      const conflicted = await execute({ method: "POST", path: "/publish",
        body: { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "changed" }],
          idempotencyKey: clientKey } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(conflicted, invocation["invocationId"] as string);
      expect(conflicted["failure"]).toMatchObject({
        category: "conflict", retriable: false, commitState: "not_committed" });
      const projected = await projectOutcomeHttp(conflicted);
      expect(projected).toEqual({ status: 409, body: { error: "conflict" } });
      expect(await tableCount("releases")).toBe(releasesBefore);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
      const successRows = Number((await pool.query(
        "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows[0].count);
      expect(successRows).toBe(1);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("sanitizes a commit denial to the existing host policy projection", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ2Host(barrier);
    const { host } = composed;
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const seenTransactions: unknown[] = [];
      const authorizeCommit: AuthorizeCommit = async (_context, transaction) => {
        expect(transaction).toBeDefined();
        seenTransactions.push(transaction);
        return { allowed: false, reason: "unauthorized_at_commit",
          publicCode: "account_not_approved", status: 403, retriable: false };
      };
      const artifactId = await ensureVia(execute, allowAll(), "q2-deny", "q2-deny-ensure");
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(authorizeCommit, "deny");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "denied" }],
          idempotencyKey: "q2-deny" } }, invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(seenTransactions.length).toBeGreaterThan(0);
      expect(outcome["failure"]).toMatchObject({
        category: "unauthorized_at_commit", commitState: "not_committed" });
      const projected = await projectOutcomeHttp(outcome);
      expect(projected.status).toBe(403);
      expectRedacted(projected);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each([
    ["plain-error", new Error("kaboom")],
    ["lost-text", new Error("lost and found in plain text")],
    ["conflict-text", new Error("conflict zone in plain text")],
    ["unknown-code", Object.assign(new Error("weird adapter failure"), { code: "E_TOTALLY_UNKNOWN" })],
  ])("maps unrecognized failure %s to provider_error without text inference", async (_name, fault) => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const armed = { current: false };
    const failing = proxyLeasedPool(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => { throw fault; };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as pg.Pool;
    const { host } = await composeQ2Host(barrier, { pool: failing });
    const close = host["close"];
    try {
      const execute = executeWithParity(host);
      const before = await tableCount("artifacts");
      armed.current = true;
      try {
        const invocation = invocationFor(allowAll(), "unknown");
        const outcome = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "q2-unknown", idempotencyKey: "q2-unknown" } },
          invocation) as unknown as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocation["invocationId"] as string);
        expect(outcome["failure"]).toMatchObject({ category: "provider_error", retriable: false });
        const projected = await projectOutcomeHttp(outcome);
        expect(projected).toEqual({ status: 500, body: { error: "internal_error" } });
        expectRedacted(projected);
      } finally {
        armed.current = false;
      }
      expect(await tableCount("artifacts")).toBe(before);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("keeps HTTP and MCP retry parity with one correlated outcome per dispatch", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const parityMarker = createPrivateMarker("parity_timeout");
    const faulty = { ...rawBlobs(),
      async putBlob() {
        throw Object.assign(new Error(`stream timeout ${parityMarker}`), { code: "artifact_s3_timeout" });
      } };
    const composed = await composeQ2Host(barrier, { blobs: faulty });
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = executeWithParity(host, { privateMarkers: [parityMarker],
        secrets: [BUCKET, endpoint, accessKey, SCOPE, secretKey] });
      const artifactId = await ensureVia(execute, allowAll(), "q2-parity", "q2-parity-ensure");
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "parity" }],
        idempotencyKey: "q2-parity" };
      const invocation = invocationFor(allowAll(), "parity");
      const invocationId = invocation["invocationId"] as string;
      const outcome = await execute({ method: "POST", path: "/publish", body },
        invocation) as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocationId);
      expect(outcome["failure"]).toMatchObject({ category: "provider_unavailable", retriable: true });
      const projected = await projectOutcomeHttp(outcome);
      assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [parityMarker], [BUCKET, endpoint, accessKey, SCOPE]);
      const peerComposed = (await composeQ2Host(barrier, { blobs: faulty }));
      try {
        const adapter = createMcpArtifactAdapter(createArtifactControl(peerComposed.host as never, SCOPE, BASE));
        const mcp = await adapter.execute({ method: "POST", path: "/publish", args: body }, { actorId: ACTOR });
        assertMcpResultRedacted(mcp,
          { status: 503, code: "capability_unavailable", retryable: true, publicError: "capability_unavailable" },
          [parityMarker], [BUCKET, endpoint, accessKey, SCOPE]);
      } finally {
        (peerComposed.host["close"] as () => void)();
      }
      const faults = [
        Object.assign(new Error("isolated connection"), { code: "57P06" }),
        Object.assign(new Error("isolated serialization"), { code: "40001" }),
      ];
      const local = new AsyncLocalStorage<Error>();
      let arrivals = 0;
      let releaseBoth!: () => void;
      const both = new Promise<void>((resolve) => { releaseBoth = resolve; });
      const failing = new Proxy(pool, { get(target, property, receiver) {
        if (property === "connect") return async () => {
          const cause = local.getStore();
          if (!cause) return target.connect();
          if (++arrivals === 2) releaseBoth();
          await both;
          throw cause;
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const isolated = await composeQ2Host(barrier, { pool: failing });
      try {
        const entries: Record<string, unknown>[] = [];
        const dispatched: Array<{ id: string; cause: Error; outcome: unknown }> = [];
        const direct = requireHostExecute(isolated.host);
        const observe = async (request: unknown, context: unknown) => {
          const invocation = context as InvocationContextShape;
          const id = invocation.invocationId; // captured BEFORE dispatch
          const cause = local.getStore()!;
          const outcome = await direct(request, buildInvocationContext({ ...invocation,
            authorizeCommit: allowAll() }));
          dispatched.push({ id, cause, outcome });
          return outcome;
        };
        const control = createArtifactControl({ ...isolated.host, execute: observe,
          app: { ...isolated.host.app as object, execute: observe } } as never,
          SCOPE, BASE, undefined, { ledger: { record: (entry) => { entries.push({ ...entry }); } } });
        await Promise.all(faults.map((cause, index) => local.run(cause, () =>
          control.handle("ensure", ACTOR, { bindingName: "q2-iso-" + index, idempotencyKey: "q2-iso-" + index }))));
        expect(dispatched).toHaveLength(2);
        expect(new Set(dispatched.map(({ id }) => id)).size).toBe(2);
        expect(entries).toHaveLength(2);
        for (const { id, cause, outcome } of dispatched) {
          assertOutcomeFailure(outcome, id);
          expect((outcome as { failure: { cause: unknown } }).failure.cause).toBe(cause);
          expect(entries.filter((entry) => entry.invocationId === id)).toEqual([
            expect.objectContaining({ invocationId: id, reason: "provider_unavailable", status: 503 }),
          ]);
        }
      } finally { (isolated.host["close"] as () => void)(); }
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("fails reads without a write-commit entry and distinguishes entry refusal", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const armed = { current: false, attempts: 0 };
    const readMarker = createPrivateMarker("read_conn");
    const flaky = proxyLeasedPool(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => {
          armed.attempts++;
          throw Object.assign(new Error(`terminating connection ${readMarker}`), { code: "57P06" });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as pg.Pool;
    const composed = await composeQ2Host(barrier, { pool: flaky });
    const host = composed.host;
    const close = host["close"];
    try {
      const execute = executeWithParity(host, { privateMarkers: [readMarker],
        secrets: [BUCKET, endpoint, accessKey, SCOPE, secretKey] });
      const artifactId = await ensureVia(execute, allowAll(), "q2-read", "q2-read-ensure");
      const keysBefore = await tableCount("idempotency_keys");
      const releasesBefore = await tableCount("releases");
      armed.current = true;
      try {
        const invocation = invocationFor(allowAll(), "read");
        const outcome = await execute({ method: "GET", path: `/meta/${artifactId}`, body: {} },
          invocation) as unknown as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocation["invocationId"] as string);
        expect(outcome["failure"]).toMatchObject({
          category: "provider_unavailable", code: "capability_unavailable", retriable: true, commitState: "not_committed" });
        const projected = await projectOutcomeHttp(outcome);
        assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [readMarker], []);
        expectRedacted(projected, [readMarker]);
        expect(projected.status).toBe(503);
      } finally {
        armed.current = false;
      }
      expect(armed.attempts).toBeGreaterThan(0);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
      expect(await tableCount("releases")).toBe(releasesBefore);
      const seenTransactions: unknown[] = [];
      const guard: AuthorizeCommit = async (context, transaction) => {
        seenTransactions.push(transaction);
        return authorizeTransaction(context, transaction);
      };
      const entry = await execute({ method: "POST", path: "/publish",
        body: { artifactId: "123e4567-e89b-12d3-a456-426614174000",
          files: [{ path: "index.html", mimeType: "text/html", text: "x" }],
          idempotencyKey: "   " } },
        invocationFor(guard, "entry")) as unknown as Record<string, unknown>;
      assertOutcomeFailure(entry);
      expect(entry["failure"]).toMatchObject({ code: "invalid_request" });
      expect(seenTransactions).toEqual([]);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });
});

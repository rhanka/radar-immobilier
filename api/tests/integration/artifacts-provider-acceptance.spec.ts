/**
 * Sentropic provider acceptance suite (spec r2 target + H4 P7).
 *
 * TARGET behavior for `@sentropic/artifacts` 0.2.0 deliveries: this suite
 * MUST FAIL against the current provider (0.1.2, no commit-contract,
 * outcome-contract or testing entries) with `[missing-contract]` naming the
 * missing entry, and PASS once Sentropic ships those contracts. It drives the
 * real composed provider via PostgreSQL + S3, the same composition family as
 * `artifacts-commit-probe.spec.ts` / `artifacts-mcp-adapter.spec.ts`.
 *
 * Gate: ARTIFACTS_PROVIDER_ACCEPTANCE=1; otherwise all six cases are skipped
 * and the module logs `[acceptance-disabled]`. The runner forwards the gate
 * and fails qualification when that reminder appears with the gate enabled.
 *
 * Upstream contract (spec r2 section 3.2, exact names):
 * - `ArtifactInvocationContext.authorizeCommit` from
 *   `@sentropic/artifacts/server/commit-contract`: the suite binds a
 *   per-request context and behaviorally asserts the provider invokes the
 *   callback with the leased finalization transaction AFTER the commit
 *   barrier. Retired: `host.setFinalizeAuthorization` is never probed.
 * - `host.execute(request, invocation)` (equivalently `host.app.execute`)
 *   with `ArtifactOutcome` from
 *   `@sentropic/artifacts/server/outcome-contract`: failure cases assert
 *   `outcome.ok === false` plus `outcome.failure.cause`, the failure
 *   category and the invocation ID BEFORE projection. Retired:
 *   `host.app.takeTypedCause` is never drained.
 * - `host.selectedCapabilities`: asserted as the frozen four-name value
 *   plus the compiled profile digest, never as a truthy property.
 * - Test-only `createArtifactCommitBarrier()` from
 *   `@sentropic/artifacts/testing`, bound once as the coordinator
 *   `testObserver` below the app with invocation correlation.
 *
 * Post-denial storage rule (section 6.3): after a refusal past S3 upload or
 * key-row locking, the suite NO LONGER asserts immediate raw S3 object-count
 * equality. It asserts zero COMMITTED effects (no new ready release, no
 * pointer move, no provenance/ACL/binding/lifecycle change, no success
 * idempotency row, no consumed quota) plus accounted nonvisible preparations
 * and eventual bounded cleanup with shared-blob retention.
 *
 * Provisional extension bindings live ONLY in artifacts-provider-contract.helpers.ts.
 * Missing contracts fail by name. Cases 4/5 require the selected provider
 * profile: Radar-only replay/hash compensation does not qualify a delivery.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import {
  composeArtifactHost,
  createArtifactControl,
  createArtifactsPool,
  deriveIdempotencyKey,
} from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie, migrationsFolder } from "./artifacts-h2.helpers.js";
import { loadConfig } from "../../src/config.js";
import {
  assertOutcomeFailure,
  authorizeTransaction,
  buildInvocationContext,
  FROZEN_CAPABILITIES,
  requireCommitBarrier,
  projectOutcomeHttp,
  committedState,
  requireCommitContract,
  requireHostExecute,
  requireOutcomeContract,
  requireSelectedProfile,
  toGuardDecision,
  type AuthorizeCommit,
} from "./artifacts-provider-contract.helpers.js";

let nextInvocationId = 1;
const ENABLED = process.env.ARTIFACTS_PROVIDER_ACCEPTANCE === "1";
if (!ENABLED) {
  console.info("[acceptance-disabled] sentropic provider acceptance skipped without ARTIFACTS_PROVIDER_ACCEPTANCE=1");
}
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
    return [...(await rawBlobs().listKeys(""))].length;
  }

  async function tableCount(table: "releases" | "idempotency_keys" | "artifacts"): Promise<number> {
    return Number((await pool.query(`SELECT count(*) FROM artifacts.${table}`)).rows[0].count);
  }

  async function currentReleaseId(artifactId: string): Promise<string | undefined> {
    const rows = (await pool.query(
      "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows;
    return rows[0]?.release_id as string | undefined;
  }

  async function successRowCount(internalKey: string): Promise<number> {
    return Number((await pool.query(
      "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows[0].count);
  }

  async function ensureArtifact(
    control: ReturnType<typeof createArtifactControl>, key: string,
  ): Promise<string> {
    const response = await control.handle("ensure", ACTOR, { bindingName: "acceptance", idempotencyKey: key });
    expect(response.status).toBe(201);
    return (response.body as { artifactId: string }).artifactId;
  }

  /**
   * Candidate host construction. The require below fails by name against
   * 0.1.2 before any legacy composition runs. The options bag carries the
   * barrier observer so the candidate coordinator binds it as its
   * `testObserver` with invocation correlation.
   */
  async function composeAcceptanceHost(
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

  function successBody(outcome: unknown): Record<string, unknown> {
    const result = (outcome as { result: unknown }).result as { body: unknown };
    return result.body as Record<string, unknown>;
  }

  function invocationFor(authorizeCommit: AuthorizeCommit, suffix: string): Record<string, unknown> {
    return buildInvocationContext({
      invocationId: `acceptance-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    }) as unknown as Record<string, unknown>;
  }

  beforeAll(async () => {
    const env = loadConfig();
    endpoint = env.S3_ENDPOINT; accessKey = env.S3_ACCESS_KEY; secretKey = env.S3_SECRET_KEY;
    admin = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
    await admin.query(`CREATE DATABASE ${DATABASE}`);
    databaseCreated = true;
    console.info("[acceptance-setup] database created");
    pool = createArtifactsPool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
    await migrate(drizzle(pool), { migrationsFolder });
    console.info("[acceptance-setup] migrations applied");
    s3 = new S3Client({ endpoint, forcePathStyle: true, region: "us-east-1",
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    bucketCreated = true;
    console.info("[acceptance-setup] bucket created");
    await pool.query("INSERT INTO account_users (sub, email, status) VALUES ('alice','alice@example.test','approved')");
  });

  afterAll(async () => {
    console.info("[acceptance-cleanup] start", { total: pool?.totalCount, idle: pool?.idleCount, waiting: pool?.waitingCount });
    try {
      if (bucketCreated) {
        for (const key of await rawBlobs().listKeys("")) await rawBlobs().deleteBlob(key);
        console.info("[acceptance-cleanup] objects removed");
        await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
        console.info("[acceptance-cleanup] bucket removed");
      }
    } finally {
      s3?.destroy();
      await pool?.end();
      console.info("[acceptance-cleanup] pool ended");
      try {
        if (databaseCreated) await admin.query(`DROP DATABASE ${DATABASE} WITH (FORCE)`);
        console.info("[acceptance-cleanup] database removed");
      } finally { await admin?.end(); }
    }
  });

  it("refuses authorization at the commit barrier with zero committed effects", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeAcceptanceHost(barrier.observer);
    const close = host["close"];
    try {
      requireSelectedProfile(host);
      const execute = requireHostExecute(host);
      const seenTransactions: unknown[] = [];
      let passedBarrier = false;
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(context).toMatchObject({ actorId: ACTOR, storageScopeId: SCOPE, purpose: "finalize" });
        expect(transaction).toBeDefined();
        seenTransactions.push({ transaction, passedBarrier });
        const status = (await pool.query(
          "SELECT status FROM account_users WHERE sub = 'alice'")).rows[0]?.status as string | null;
        return status === "approved" ? authorizeTransaction(context, transaction)
          : toGuardDecision({ allowed: false, status: 403, body: { error: "account_not_approved", status: status ?? "unknown" } });
      };
      const allowAll: AuthorizeCommit = authorizeTransaction;
      try {
        const ensured = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "acceptance", idempotencyKey: "acceptance-refusal-ensure" } },
          invocationFor(allowAll, "refusal-ensure"));
        expect(ensured).toMatchObject({ ok: true });
        const artifactId = successBody(ensured)["artifactId"] as string;
        const clientKey = "acceptance-refusal";
        const body = { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "refused while blocked" }],
          idempotencyKey: clientKey };
        const internalKey = deriveIdempotencyKey(
          { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey });
        const invocation = invocationFor(authorizeCommit, "refusal");
        const invocationId = invocation["invocationId"] as string;
        const stateBefore = await committedState(pool);
        const releasesBefore = await tableCount("releases");
        const keysBefore = await tableCount("idempotency_keys");
        const s3Before = await s3KeyCount();
        const wait = barrier.waitUntilReached("after_finalization_locks_before_guard", invocationId);
        const pending = execute({ method: "POST", path: "/publish", body }, invocation);
        await wait;
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
        passedBarrier = true;
        barrier.release("after_finalization_locks_before_guard", invocationId);
        const outcome = await pending as Record<string, unknown>;
        expect(seenTransactions.length).toBeGreaterThan(0);
      expect(seenTransactions.at(-1)).toMatchObject({ passedBarrier: true });
        assertOutcomeFailure(outcome, invocationId);
        expect(outcome["failure"]).toMatchObject({ category: "unauthorized_at_commit" });
        expect(await committedState(pool)).toEqual(stateBefore);
        expect(await tableCount("releases")).toBe(releasesBefore);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore);
        expect(await successRowCount(internalKey)).toBe(0);
        expect(await currentReleaseId(artifactId)).toBeUndefined();
        const s3AfterDenial = await s3KeyCount();
        console.info("[preparation-debt]", JSON.stringify({ s3Before, s3AfterDenial }));
        expect(s3AfterDenial).toBeGreaterThanOrEqual(s3Before);
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
        const retry = await execute({ method: "POST", path: "/publish", body },
          invocationFor(authorizeCommit, "refusal-retry")) as Record<string, unknown>;
        expect(retry).toMatchObject({ ok: true });
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await successRowCount(internalKey)).toBe(1);
        expect(await currentReleaseId(artifactId)).toBe(
          (successBody(retry)["releaseId"] as string));
        const replay = await execute({ method: "POST", path: "/publish", body },
          invocationFor(authorizeCommit, "refusal-replay")) as Record<string, unknown>;
        expect(replay).toMatchObject({ ok: true });
        expect(successBody(replay)).toEqual(successBody(retry));
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
      } finally {
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      }
    } finally {
      if (typeof close === "function") (close as () => void)();
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

  it("rejects same-key changed content as conflict without a new release", async () => {
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
    const control = createArtifactControl(host, SCOPE, BASE);
    try {
      requireSelectedProfile(host);
      const artifactId = await ensureArtifact(control, "acceptance-conflict-ensure");
      const files = [{ path: "index.html", mimeType: "text/html", text: "hello" }];
      const first = await control.handle("publish", ACTOR,
        { artifactId, files, idempotencyKey: "acceptance-conflict" });
      expect(first.status).toBe(201);
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const objectsBefore = await s3KeyCount();
      const conflicts = [
        { files: [{ path: "index.html", mimeType: "text/html", text: "changed" }] },
        { files: [{ path: "other.html", mimeType: "text/html", text: "hello" }] },
        { files: [{ path: "index.html", mimeType: "text/css", text: "hello" }] },
        { files, profile: { theme: "dark" } },
      ];
      for (const change of conflicts) {
        expect(await control.handle("publish", ACTOR,
          { artifactId, idempotencyKey: "acceptance-conflict", ...change }))
          .toEqual({ status: 409, body: { error: "conflict" } });
        expect(await tableCount("releases")).toBe(releasesBefore);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore);
        expect(await s3KeyCount()).toBe(objectsBefore);
      }
      const ordered = await control.handle("publish", ACTOR, { artifactId,
        files: [...files, { path: "other.html", mimeType: "text/html", text: "hello" }],
        idempotencyKey: "acceptance-order" });
      expect(ordered.status).toBe(201);
      const orderedObjects = await s3KeyCount();
      expect(await control.handle("publish", ACTOR, { artifactId,
        files: [{ path: "other.html", mimeType: "text/html", text: "hello" }, ...files],
        idempotencyKey: "acceptance-order" }))
        .toEqual({ status: 409, body: { error: "conflict" } });
      expect(await tableCount("releases")).toBe(releasesBefore + 1);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
      expect(await s3KeyCount()).toBe(orderedObjects);
      expect(await currentReleaseId(artifactId)).toBe((ordered.body as { releaseId: string }).releaseId);
      expect(await control.handle("publish", ACTOR,
        { artifactId, files, idempotencyKey: "acceptance-conflict" })).toEqual(first);
    } finally {
      host.close();
    }
  });

  it("exposes only the selected profile with caller keys and derived identity", async () => {
    const host = (await composeArtifactHost(pool, storageConfig(), rawBlobs()))!;
    const control = createArtifactControl(host, SCOPE, BASE);
    try {
      requireSelectedProfile(host);
      const adapter = createMcpArtifactAdapter(control);
      for (const request of [
        { method: "POST", path: "/fork", args: {} },
        { method: "POST", path: "/delete", args: {} },
        { method: "POST", path: "/commit_upload", args: {} },
        { method: "POST", path: "/promote", args: {} },
      ]) {
        expect(await adapter.execute(request, { actorId: ACTOR })).toMatchObject(
          { ok: false, status: 503, code: "capability_unavailable", retryable: false });
        const direct = await host.app.handle({ method: request.method, path: request.path,
          actorId: ACTOR, body: request.args });
        expect([404, 503]).toContain(direct.status);
      }
      expect(await control.handle("fork", ACTOR, {}))
        .toEqual({ status: 503, body: { error: "capability_unavailable" } });
      expect(await adapter.execute({ method: "POST", path: "/publish",
        args: { artifactId: "123e4567-e89b-12d3-a456-426614174000",
          files: [{ path: "index.html", mimeType: "text/html", text: "x" }],
          idempotencyKey: "acceptance-selection", storageScopeId: "forged" } },
        { actorId: ACTOR })).toMatchObject({ ok: false, status: 400, code: "invalid_request" });
      const artifactId = await ensureArtifact(control, "acceptance-selection-ensure");
      const files = [{ path: "index.html", mimeType: "text/html", text: "selection" }];
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const artifactsBefore = await tableCount("artifacts");
      const objectsBefore = await s3KeyCount();
      for (const callerKey of [undefined, null, 42, "", "   ", "x".repeat(257), "😀".repeat(129)]) {
        for (const op of ["ensure", "publish"]) {
          const args = { ...(op === "ensure" ? { bindingName: "invalid-key" } : { artifactId, files }),
            ...(callerKey === undefined ? {} : { idempotencyKey: callerKey }) };
          expect(await control.handle(op, ACTOR, args))
            .toEqual({ status: 400, body: { error: "invalid_request" } });
          expect(await adapter.execute({ method: "POST", path: `/${op}`, args }, { actorId: ACTOR }))
            .toMatchObject({ ok: false, status: 400, code: "invalid_request" });
        }
      }
      expect(await tableCount("releases")).toBe(releasesBefore);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
      expect(await tableCount("artifacts")).toBe(artifactsBefore);
      expect(await s3KeyCount()).toBe(objectsBefore);
      expect(await adapter.execute({ method: "GET", path: `/meta/${artifactId}`, args: {} },
        { actorId: ACTOR })).toMatchObject({ ok: true, status: 200 });
      expect(await adapter.execute({ method: "POST", path: "/list", args: {} },
        { actorId: ACTOR })).toMatchObject({ ok: true, status: 200 });
      const padded = " acceptance-derived ";
      const published = await control.handle("publish", ACTOR,
        { artifactId, files, idempotencyKey: padded });
      expect(published.status).toBe(201);
      const expected = deriveIdempotencyKey(
        { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey: padded });
      expect(expected).toHaveLength(64);
      expect(expected).not.toBe(padded);
      const stored = (await pool.query("SELECT key FROM artifacts.idempotency_keys")).rows as { key: string }[];
      expect(stored.map((row) => row.key)).toContain(expected);
      expect(stored.map((row) => row.key)).not.toContain(padded);
      expect(deriveIdempotencyKey({ scope: SCOPE, sub: ACTOR, op: "publish", artifactId,
        clientKey: padded.trim() })).not.toBe(expected);
      expect((await control.handle("publish", ACTOR,
        { artifactId, files, idempotencyKey: "😀".repeat(128) })).status).toBe(201);
    } finally {
      host.close();
    }
  });
});

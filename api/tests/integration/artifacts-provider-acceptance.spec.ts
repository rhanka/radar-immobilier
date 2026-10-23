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
  assertPublicBodyRedacted,
  authorizeTransaction,
  buildInvocationContext,
  composeR2AcceptanceHost,
  createPrivateMarker,
  requireCommitBarrier,
  projectOutcomeHttp,
  committedState,
  requireCommitContract,
  requireHostExecute,
  requireOutcomeContract,
  verifyPreparationCleanup,
  startBarrierOperation,
  requireSelectedProfile,
  readPolicyStatusViaTransaction,
  toGuardDecision,
  type AuthorizeCommit,
  type CommitBarrier,
  type CompiledArtifactsProfile,
  type InvocationContextShape,
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
    return [...(await rawBlobs().listKeys("artifacts/"))].length;
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
   * Candidate host construction through the single typed r2 joint.
   * `compileArtifactsProfile` returns the compiled profile, the real
   * coordinator carries the PostgreSQL participant and the barrier
   * `testObserver`, and the migrated composition uses the new r2 signature
   * `composeArtifactHost(pool, config, blobs, {profile, coordinator})`.
   * Each joint fails `[missing-contract]` by name; no partial composition
   * reaches the assertions.
   */
  async function composeAcceptanceHost(
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

  function successBody(outcome: unknown): Record<string, unknown> {
    const result = (outcome as { result: unknown }).result as { body: unknown };
    return result.body as Record<string, unknown>;
  }

  function invocationFor(authorizeCommit: AuthorizeCommit, suffix: string): InvocationContextShape {
    return buildInvocationContext({
      invocationId: `acceptance-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    });
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
        for (const key of await rawBlobs().listKeys("artifacts/")) await rawBlobs().deleteBlob(key);
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
    const composed = await composeAcceptanceHost(barrier);
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = requireHostExecute(host);
      const seenTransactions: unknown[] = [];
      const seenPurposes: string[] = [];
      let passedBarrier = false;
      const finalizeGuard: AuthorizeCommit = async (context, transaction) => {
        expect(context).toMatchObject({ actorId: ACTOR, storageScopeId: SCOPE, purpose: "finalize" });
        expect(transaction).toBeDefined();
        seenTransactions.push({ transaction, passedBarrier });
        seenPurposes.push(context.purpose);
        const status = await readPolicyStatusViaTransaction(transaction);
        return status === "approved" ? authorizeTransaction(context, transaction)
          : toGuardDecision({ allowed: false, status: 403, body: { error: "account_not_approved", status: status ?? "unknown" } });
      };
      const replayGuard: AuthorizeCommit = async (context, transaction) => {
        expect(context).toMatchObject({ actorId: ACTOR, storageScopeId: SCOPE, purpose: "replay" });
        expect(transaction).toBeDefined();
        seenPurposes.push(context.purpose);
        return authorizeTransaction(context, transaction);
      };
      const authorizeCommit: AuthorizeCommit = finalizeGuard;
      const allowAll: AuthorizeCommit = authorizeTransaction;
      try {
        const ensured = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "acceptance", idempotencyKey: "acceptance-refusal-ensure" } },
          invocationFor(allowAll, "refusal-ensure"));
        expect(ensured).toMatchObject({ ok: true });
        const artifactId = successBody(ensured)["artifactId"] as string;
        const seed = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "shared-seed", idempotencyKey: "shared-seed-ensure" } }, invocationFor(allowAll, "shared-seed"));
        expect(seed).toMatchObject({ ok: true });
        const seedId = successBody(seed)["artifactId"] as string;
        expect(await execute({ method: "POST", path: "/publish", body: { artifactId: seedId,
          files: [{ path: "index.html", mimeType: "text/html", text: "shared protected bytes" }],
          idempotencyKey: "shared-seed-publish" } }, invocationFor(allowAll, "shared-publish"))).toMatchObject({ ok: true });
        const clientKey = "acceptance-refusal";
        const body = { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "shared protected bytes" },
            { path: "private.html", mimeType: "text/html", text: "refused unique bytes" }],
          idempotencyKey: clientKey };
        const internalKey = deriveIdempotencyKey(
          { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey });
        const invocation = invocationFor(authorizeCommit, "refusal");
        const invocationId = invocation["invocationId"] as string;
        const stateBefore = await committedState(pool);
        const releasesBefore = await tableCount("releases");
        const keysBefore = await tableCount("idempotency_keys");
        const s3Before = await s3KeyCount();
        const run = startBarrierOperation(barrier, invocationId,
          () => execute({ method: "POST", path: "/publish", body }, invocation), "before_finalization_row_lock");
        await run.reached;
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
        passedBarrier = true;
        run.release();
        const outcome = await run.pending as Record<string, unknown>;
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
        await verifyPreparationCleanup(host, artifactId, rawBlobs(), true, true);
        await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
        const retry = await execute({ method: "POST", path: "/publish", body },
          invocationFor(finalizeGuard, "refusal-retry")) as Record<string, unknown>;
        expect(retry).toMatchObject({ ok: true });
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await successRowCount(internalKey)).toBe(1);
        expect(await currentReleaseId(artifactId)).toBe(
          (successBody(retry)["releaseId"] as string));
        const replay = await execute({ method: "POST", path: "/publish", body },
          invocationFor(replayGuard, "refusal-replay")) as Record<string, unknown>;
        expect(replay).toMatchObject({ ok: true });
        expect(seenPurposes).toContain("replay");
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
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const timeoutMarker = createPrivateMarker("s3_timeout");
    const stackMarker = createPrivateMarker("s3_stack");
    const faulty = { ...rawBlobs(),
      async putBlob() {
        const fault = Object.assign(new Error(`stream timeout ${timeoutMarker}`),
          { code: "artifact_s3_timeout", stack: `Error: injected ${stackMarker}` });
        throw fault;
      } };
    const composed = await composeAcceptanceHost(barrier, { blobs: faulty });
    const host = composed.host;
    const close = host["close"];
    try {
      const execute = requireHostExecute(host);
      const authorizeCommit: AuthorizeCommit = authorizeTransaction;
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: "acceptance-s3", idempotencyKey: "acceptance-s3-ensure" } },
        invocationFor(authorizeCommit, "s3-ensure"));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = successBody(ensured)["artifactId"] as string;
      const releasesBefore = await tableCount("releases");
      const invocation = invocationFor(authorizeCommit, "s3");
      const outcome = await execute({ method: "POST", path: "/publish",
        body: { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "s3 timeout" }],
          idempotencyKey: "acceptance-s3" } }, invocation) as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocation["invocationId"] as string);
      expect(outcome["failure"]).toMatchObject({ category: "provider_unavailable", retriable: true, commitState: "not_committed" });
      const failure = outcome["failure"] as Record<string, unknown>;
      expect(String((failure["cause"] as Record<string, unknown>)?.["code"] ?? (failure["cause"] as Error)?.message ?? "")).toContain("artifact_s3_timeout");
      const projected = await projectOutcomeHttp(outcome);
      assertPublicBodyRedacted(projected, { error: "capability_unavailable" },
        [timeoutMarker, stackMarker], [BUCKET, endpoint, accessKey]);
      expect(await tableCount("releases")).toBe(releasesBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("maps a lost Postgres connection to provider_unavailable, never conflict", async () => {
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const armed = { current: false, attempts: 0 };
    const lostMarker = createPrivateMarker("pg_lost");
    const flaky = new Proxy(pool, { get(target, property, receiver) {
      if ((property === "query" || property === "connect") && armed.current) {
        return async (): Promise<never> => {
          armed.attempts++;
          throw Object.assign(new Error(`terminating connection lost by peer ${lostMarker}`), { code: "57P06" });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as unknown as pg.Pool;
    const composed = await composeAcceptanceHost(barrier, { pool: flaky });
    const host = composed.host;
    const close = host["close"];
    try {
      const execute = requireHostExecute(host);
      const authorizeCommit: AuthorizeCommit = authorizeTransaction;
      const before = await tableCount("artifacts");
      const keysBefore = await tableCount("idempotency_keys");
      armed.current = true;
      try {
        const invocation = invocationFor(authorizeCommit, "lost");
        const outcome = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "acceptance-lost", idempotencyKey: "acceptance-lost" } },
          invocation) as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocation["invocationId"] as string);
        expect(outcome["failure"]).toMatchObject({ category: "provider_unavailable", retriable: true, commitState: "not_committed" });
        expect(outcome["failure"]).not.toMatchObject({ category: "conflict" });
        const failure = outcome["failure"] as Record<string, unknown>;
        expect((failure["cause"] as { code?: string })?.code).toBe("57P06");
        const projected = await projectOutcomeHttp(outcome);
        assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [lostMarker], []);
      } finally {
        armed.current = false;
      }
      expect(armed.attempts).toBeGreaterThan(0);
      expect(await tableCount("artifacts")).toBe(before);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("replays HTTP to MCP and MCP to HTTP as one durable authorized release per key", async () => {
    await requireCommitContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeAcceptanceHost(barrier);
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const seenPurposes: string[] = [];
      const finalizeGuard: AuthorizeCommit = async (context, transaction) => {
        expect(context.purpose).toBe("finalize");
        seenPurposes.push("finalize");
        return authorizeTransaction(context, transaction);
      };
      const replayGuard: AuthorizeCommit = async (context, transaction) => {
        expect(context.purpose).toBe("replay");
        seenPurposes.push("replay");
        return authorizeTransaction(context, transaction);
      };
      const direct = await composeAcceptanceHost(barrier);
      try {
        const execute = requireHostExecute(direct.host);
        const ensured = await execute({ method: "POST", path: "/ensure",
          body: { bindingName: "replay-direct", idempotencyKey: "replay-direct-ensure" } },
          invocationFor(finalizeGuard, "replay-direct-ensure"));
        expect(ensured).toMatchObject({ ok: true });
        const artifactId = successBody(ensured)["artifactId"] as string;
        for (const [label, clientKey] of [["http-first", "replay-direct-http"], ["mcp-first", "replay-direct-mcp"]] as const) {
          const body = { artifactId,
            files: [{ path: "index.html", mimeType: "text/html", text: `hello ${label}` }],
            idempotencyKey: clientKey };
          const releasesBefore = await tableCount("releases");
          const first = await execute({ method: "POST", path: "/publish", body },
            invocationFor(finalizeGuard, label)) as Record<string, unknown>;
          expect(first).toMatchObject({ ok: true });
          const second = await execute({ method: "POST", path: "/publish", body },
            invocationFor(replayGuard, `${label}-replay`)) as Record<string, unknown>;
          expect(second).toMatchObject({ ok: true, replayed: true });
          expect(successBody(second)).toEqual(successBody(first));
          expect(await tableCount("releases")).toBe(releasesBefore + 1);
          expect(seenPurposes).toContain("finalize");
          expect(seenPurposes).toContain("replay");
        }
      } finally {
        (direct.host["close"] as () => void)();
      }
      const firstComposed = await composeAcceptanceHost(barrier);
      const control = createArtifactControl(firstComposed.host as never, SCOPE, BASE);
      try {
        const route = controlRoute({ auth, accounts: pool, backend: control });
        const httpPublish = async (args: unknown) => {
          const response = await route.request("https://app.example.test/publish", {
            method: "POST", headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
              "content-type": "application/json" }, body: JSON.stringify(args),
          });
          return { status: response.status, body: await response.json() as Record<string, unknown> };
        };
        const ensured = await control.handle("ensure", ACTOR,
          { bindingName: "replay", idempotencyKey: "replay" });
        expect(ensured.status).toBe(201);
        const artifactId = (ensured.body as { artifactId: string }).artifactId;
        const secondComposed = await composeAcceptanceHost(barrier);
        try {
          const adapter = createMcpArtifactAdapter(createArtifactControl(secondComposed.host as never, SCOPE, BASE));
          const bodyOf = (value: unknown) => "body" in (value as Record<string, unknown>)
            ? (value as { body: unknown }).body
            : (value as { ok: boolean; data: unknown }).data;
          const releasesBefore = await tableCount("releases");
          const keysBefore = await tableCount("idempotency_keys");
          const httpArgs = { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "hello" }],
            idempotencyKey: " replay " };
          const mcpOf = () => adapter.execute({ method: "POST", path: "/publish", args: httpArgs }, { actorId: ACTOR });
          const first = await httpPublish(httpArgs);
          const replay = await mcpOf();
          expect(first.status).toBe(201);
          expect(replay.status).toBe(201);
          expect(await tableCount("releases")).toBe(releasesBefore + 1);
          expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
          expect(bodyOf(replay)).toEqual(bodyOf(first));
          expect(await currentReleaseId(artifactId)).toBe((bodyOf(first) as { releaseId: string }).releaseId);
          const mcpFirstArgs = { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "hello mcp-first" }],
            idempotencyKey: "replay-mcp-first" };
          const mcpFirst = await adapter.execute({ method: "POST", path: "/publish", args: mcpFirstArgs }, { actorId: ACTOR });
          expect(mcpFirst).toMatchObject({ ok: true, status: 201 });
          const httpReplay = await httpPublish(mcpFirstArgs);
          expect(httpReplay.status).toBe(201);
          expect(httpReplay.body).toEqual(bodyOf(mcpFirst));
          expect(await tableCount("releases")).toBe(releasesBefore + 2);
          expect(await tableCount("idempotency_keys")).toBe(keysBefore + 2);
        } finally { (secondComposed.host["close"] as () => void)(); }
      } finally {
        (firstComposed.host["close"] as () => void)();
      }
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("rejects same-key changed content as conflict without a new release", async () => {
    await requireCommitContract();
    const barrier = await requireCommitBarrier();
    const composedCheck = await composeAcceptanceHost(barrier);
    const host = composedCheck.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composedCheck.profile.digest);
      const direct = requireHostExecute(host);
      const guard = authorizeTransaction;
      const ensured = await direct({ method: "POST", path: "/ensure", body: {
        bindingName: "direct-conflict", idempotencyKey: "direct-conflict-ensure" } }, invocationFor(guard, "direct-conflict-ensure"));
      expect(ensured).toMatchObject({ ok: true });
      const directId = successBody(ensured).artifactId as string;
      const original = [{ path: "index.html", mimeType: "text/html", text: "first" },
        { path: "other.html", mimeType: "text/html", text: "second" }];
      const directBody = { artifactId: directId, files: original, idempotencyKey: "direct-conflict" };
      expect(await direct({ method: "POST", path: "/publish", body: directBody }, invocationFor(guard, "direct-first"))).toMatchObject({ ok: true });
      const directBefore = await committedState(pool);
      for (const change of [{ files: [...original].reverse() },
        { files: [{ ...original[0], text: "changed" }, original[1]] },
        { files: [{ ...original[0], path: "changed.html" }, original[1]] },
        { files: [{ ...original[0], mimeType: "text/css" }, original[1]] },
        { profile: { theme: "dark" } }]) {
        const invocation = invocationFor(guard, "direct-changed");
        const outcome = await direct({ method: "POST", path: "/publish", body: { ...directBody, ...change } }, invocation);
        assertOutcomeFailure(outcome, invocation.invocationId);
        expect((outcome as { failure: unknown }).failure).toMatchObject({ category: "conflict", status: 409 });
        expect(await committedState(pool)).toEqual(directBefore);
      }
      const composed = (await composeAcceptanceHost(barrier));
      const control = createArtifactControl(composed.host as never, SCOPE, BASE);
      try {
        const artifactId = await ensureArtifact(control, "acceptance-conflict-ensure");
        const files = [{ path: "index.html", mimeType: "text/html", text: "hello" }];
        const first = await control.handle("publish", ACTOR,
          { artifactId, files, idempotencyKey: "acceptance-conflict" });
        expect(first.status).toBe(201);
        const releasesBefore = await tableCount("releases");
        const keysBefore = await tableCount("idempotency_keys");
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
        }
        const ordered = await control.handle("publish", ACTOR, { artifactId,
          files: [...files, { path: "other.html", mimeType: "text/html", text: "hello" }],
          idempotencyKey: "acceptance-order" });
        expect(ordered.status).toBe(201);
        expect(await control.handle("publish", ACTOR, { artifactId,
          files: [{ path: "other.html", mimeType: "text/html", text: "hello" }, ...files],
          idempotencyKey: "acceptance-order" }))
          .toEqual({ status: 409, body: { error: "conflict" } });
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
        expect(await currentReleaseId(artifactId)).toBe((ordered.body as { releaseId: string }).releaseId);
        expect(await control.handle("publish", ACTOR,
          { artifactId, files, idempotencyKey: "acceptance-conflict" })).toEqual(first);
      } finally {
        (composed.host["close"] as () => void)();
      }
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("exposes only the selected profile with caller keys and derived identity", async () => {
    await requireCommitContract();
    const barrier = await requireCommitBarrier();
    const checked = await composeAcceptanceHost(barrier);
    const host = checked.host;
    const close = host["close"];
    try {
      const digest = requireSelectedProfile(host, checked.profile.digest);
      expect(digest).toBe(checked.profile.digest);
      const storageCalls = { blobs: 0, pool: 0 };
      const countingBlobs = new Proxy(rawBlobs(), { get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value === "function") {
          return (...args: unknown[]) => { storageCalls.blobs++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
        }
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const countingPool = new Proxy(pool, { get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (["query", "connect"].includes(String(property)) && typeof value === "function") {
          return (...args: unknown[]) => { storageCalls.pool++; return value.apply(target, args); };
        }
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const composed = await composeAcceptanceHost(barrier, { pool: countingPool, blobs: countingBlobs });
      const execute = requireHostExecute(composed.host);
      storageCalls.blobs = 0;
      storageCalls.pool = 0;
      const directGuard: AuthorizeCommit = authorizeTransaction;
      for (const path of ["/fork", "/delete", "/commit_upload", "/promote"]) {
        const outcome = await execute({ method: "POST", path, body: {} },
          invocationFor(directGuard, `selection-${path}`)) as Record<string, unknown>;
        assertOutcomeFailure(outcome);
        expect(outcome["failure"]).toMatchObject({
          category: "capability_unselected", code: "capability_unavailable", status: 503, retriable: false, commitState: "not_committed" });
        const projected = await projectOutcomeHttp(outcome);
        assertPublicBodyRedacted(projected, { error: "capability_unavailable" }, [], []);
      }
      expect(storageCalls.blobs).toBe(0);
      expect(storageCalls.pool).toBe(0);
      const control = createArtifactControl(composed.host as never, SCOPE, BASE);
      try {
        const adapter = createMcpArtifactAdapter(control);
        for (const request of [
          { method: "POST", path: "/fork", args: {} },
          { method: "POST", path: "/delete", args: {} },
          { method: "POST", path: "/commit_upload", args: {} },
          { method: "POST", path: "/promote", args: {} },
        ]) {
          expect(await adapter.execute(request, { actorId: ACTOR })).toMatchObject(
            { ok: false, status: 503, code: "capability_unavailable", retryable: false });
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
        (composed.host["close"] as () => void)();
      }
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });
});

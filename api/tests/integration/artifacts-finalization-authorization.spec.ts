/**
 * Q1 extension: finalization authorization (spec r2 sections 3.2 and 4, H4 P7).
 *
 * Extension of `artifacts-provider-acceptance.spec.ts`, which remains the
 * entrypoint. Same gate (`ARTIFACTS_PROVIDER_ACCEPTANCE=1`), same skip
 * behavior without it, same `[missing-contract]` failure naming the missing
 * upstream entry against 0.1.2.
 *
 * New publish exercises eight barrier points; new ensure uses five non-S3
 * points. Both guarded replay paths exercise the ninth point separately.
 * S3 points are inapplicable to ensure and no coverage is fabricated
 * for them. Every denial asserts zero committed effects (no new ready
 * release, no pointer move, no provenance/ACL/binding/lifecycle change, no
 * success idempotency row, no consumed quota) plus accounted nonvisible
 * preparations and eventual bounded cleanup with shared-blob retention.
 * Raw S3 object counts are never asserted equal at the denial instant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createTestS3BlobStore } from "../artifacts-blob-store.helpers.js";
import {
  createArtifactControl,
  createArtifactsPool,
  deriveIdempotencyKey,
} from "@radar/artifacts-host";
import { createMcpArtifactAdapter } from "../../../packages/artifacts-host/src/mcp-app-adapter.js";
import { controlRoute } from "../../src/artifacts/control-route.js";
import { auth, cookie, migrationsFolder } from "./artifacts-h2.helpers.js";
import { cleanupArtifactTestResources, listTestBucketKeys } from "./artifacts-s3.helpers.js";
import { loadConfig } from "../../src/config.js";
import {
  assertOutcomeFailure,
  authorizeTransaction,
  buildInvocationContext,
  composeR2AcceptanceHost,
  reportNotCovered,
  committedState,
  startArtifactWorker,
  arrived,
  startBarrierOperation,
  requireCommitBarrier,
  requireCommitContract,
  requireHostExecute,
  requireOutcomeContract,
  requirePreparationCleanupBinding,
  requirePurgeRaceBinding,
  verifyPreparationCleanup,
  requireSelectedProfile,
  readPolicyStatusViaTransaction,
  transactionQuery,
  toGuardDecision,
  type AuthorizeCommit,
  type CommitBarrier,
  type CommitBarrierPoint,
  type CompiledArtifactsProfile,
  type InvocationContextShape,
  type PreparationCleanupBinding,
} from "./artifacts-provider-contract.helpers.js";

let nextInvocationId = 1;
const ENABLED = process.env.ARTIFACTS_PROVIDER_ACCEPTANCE === "1";
if (!ENABLED) {
  console.info("[acceptance-disabled] finalization authorization skipped without ARTIFACTS_PROVIDER_ACCEPTANCE=1");
}
const DATABASE = "artifacts_h2_finalization_authorization";
const SCOPE = "finalization_authorization_scope";
const ORG = "finalization_authorization_org";
const BASE = "pages.example.test";
const BUCKET = "h2-artifacts-finalization-authorization";
const ACTOR = "alice";

const PUBLISH_POINTS: readonly CommitBarrierPoint[] = [
  "before_connection_acquire",
  "before_blob_put",
  "after_blob_put_before_verify",
  "before_blob_readback",
  "before_key_lock",
  "before_finalization_row_lock",
  "after_finalization_locks_before_guard",
  "before_commit",
];

/** Ensure has no blob stage: S3 points are inapplicable, never fabricated. */
const ENSURE_POINTS: readonly CommitBarrierPoint[] = [
  "before_connection_acquire",
  "before_key_lock",
  "before_finalization_row_lock",
  "after_finalization_locks_before_guard",
  "before_commit",
];

describe.skipIf(!ENABLED)("finalization authorization Q1 (set ARTIFACTS_PROVIDER_ACCEPTANCE=1)", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let s3: S3Client;
  let endpoint = "";
  let accessKey = "";
  let secretKey = "";
  let databaseCreated = false;
  let bucketCreated = false;

  const rawBlobs = () => createTestS3BlobStore({ client: s3, bucket: BUCKET });
  const storageConfig = () => ({ enabled: true as const, storageScope: SCOPE, orgId: ORG,
    s3Bucket: BUCKET, s3Endpoint: endpoint, s3Region: "us-east-1",
    s3AccessKey: accessKey, s3SecretKey: secretKey });

  async function tableCount(table: "releases" | "idempotency_keys" | "artifacts"): Promise<number> {
    return Number((await pool.query(`SELECT count(*) FROM artifacts.${table}`)).rows[0].count);
  }

  async function currentReleaseId(artifactId: string): Promise<string | undefined> {
    const rows = (await pool.query(
      "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows;
    return rows[0]?.release_id as string | undefined;
  }

  async function committedSnapshot(artifactId: string): Promise<unknown> {
    void artifactId;
    return committedState(pool);
  }

  async function composeQ1Host(
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
      invocationId: `q1-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    });
  }

  function allowAll(): AuthorizeCommit {
    return authorizeTransaction;
  }

  function statusDriven(): AuthorizeCommit {
    return async (context, transaction) => {
      const status = await readPolicyStatusViaTransaction(transaction);
      return status === "approved" ? authorizeTransaction(context, transaction)
        : toGuardDecision({ allowed: false, status: 403, body: { error: "account_not_approved", status: status ?? "unknown" } });
    };
  }

  async function withTimeout(work: Promise<unknown>, ms: number): Promise<boolean | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then(() => true),
        new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    await cleanupArtifactTestResources({ s3, bucket: bucketCreated ? BUCKET : undefined,
      pool, admin, database: databaseCreated ? DATABASE : undefined });
  });

  async function assertPreparationCleanup(host: unknown, artifactId: string,
    expectedInvocationIds?: readonly string[],
    s3KeysBefore?: ReadonlySet<string> | readonly string[],
    preparationsBeforeRefusal?: Awaited<ReturnType<PreparationCleanupBinding["inspectPreparations"]>>["attempts"]): Promise<void> {
    await verifyPreparationCleanup(host, artifactId, () => listTestBucketKeys(s3, BUCKET), false, false,
      { ...(expectedInvocationIds === undefined ? {} : { expectedInvocationIds }),
        ...(s3KeysBefore === undefined ? {} : { s3KeysBefore }),
        ...(preparationsBeforeRefusal === undefined ? {} : { preparationsBeforeRefusal }) });
  }

  async function assertSqlWriterBlocked(pid: number): Promise<void> {
    const deadline = performance.now() + 1000;
    while (performance.now() < deadline) {
      const row = (await pool.query("SELECT cardinality(pg_blocking_pids($1)) AS blockers", [pid])).rows[0];
      if (Number(row.blockers) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("[contract-violation] policy/lifecycle writer did not wait on the finalization lock");
  }

  for (const operation of ["publish", "ensure"] as const) {
    it.each(operation === "publish" ? PUBLISH_POINTS : ENSURE_POINTS)(operation + " serializes revocation at %s", async (point) => {
      await requireCommitContract();
      await requireOutcomeContract();
      const barrier = await requireCommitBarrier();
      const { host, profile } = await composeQ1Host(barrier);
      const writer = await pool.connect();
      let run: ReturnType<typeof startBarrierOperation> | undefined;
      let revocation: Promise<unknown> | undefined;
      try {
        requireSelectedProfile(host, profile.digest);
        const execute = requireHostExecute(host);
        const tag = operation + "-" + point;
        let artifactId: string | undefined;
        if (operation === "publish") {
          const ensured = await execute({ method: "POST", path: "/ensure",
            body: { bindingName: tag, idempotencyKey: tag + "-setup" } }, invocationFor(allowAll(), tag));
          expect(ensured).toMatchObject({ ok: true });
          artifactId = (ensured as { result: { body: { artifactId: string } } }).result.body.artifactId;
        }
        const body = operation === "publish" ? { artifactId, idempotencyKey: tag,
          files: [{ path: "index.html", mimeType: "text/html", text: tag }] }
          : { bindingName: tag, idempotencyKey: tag };
        const before = await committedState(pool);
        const s3Baseline = new Set(await listTestBucketKeys(s3, BUCKET));
        const invocation = invocationFor(statusDriven(), tag);
        run = startBarrierOperation(barrier, invocation.invocationId,
          () => execute({ method: "POST", path: "/" + operation, body }, invocation), point);
        await run.reached;
        const prepared = artifactId
          ? await (await requirePreparationCleanupBinding()).inspectPreparations(host, artifactId) : undefined;
        // All finalization locks include the registered authority rows (A4).
        const protectedByLock = ["after_finalization_locks_before_guard", "before_commit"].includes(point);
        const pid = Number((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        revocation = writer.query("UPDATE account_users SET status='suspended' WHERE sub='alice'");
        if (protectedByLock) await assertSqlWriterBlocked(pid);
        else await revocation;
        run.release();
        const outcome = await run.pending;
        await run.drained;
        await revocation;
        if (protectedByLock) {
          expect(outcome).toMatchObject({ ok: true, commitState: "committed" });
        } else {
          assertOutcomeFailure(outcome, invocation.invocationId);
          expect((outcome as { failure: unknown }).failure).toMatchObject({
            category: "unauthorized_at_commit", commitState: "not_committed" });
          expect(await committedState(pool)).toEqual(before);
          if (artifactId) {
            expect(await currentReleaseId(artifactId)).toBeUndefined();
            await assertPreparationCleanup(host, artifactId, [invocation.invocationId], s3Baseline, prepared?.attempts);
          }
        }
      } finally {
        run?.release();
        await run?.pending.catch(() => {});
        await revocation?.catch(() => {});
        writer.release();
        await pool.query("UPDATE account_users SET status='approved' WHERE sub='alice'");
        (host["close"] as () => void)();
      }
    });
  }

  it("revocation then release holds no committed success on inspection from another connection", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = requireHostExecute(host);
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: "q1-inspect", idempotencyKey: "q1-inspect-ensure" } },
        invocationFor(allowAll(), "inspect-ensure"));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const clientKey = "q1-inspect";
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "inspected refusal" }],
        idempotencyKey: clientKey };
      const internalKey = deriveIdempotencyKey(
        { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey });
      const orderRevocationFirst = async (): Promise<void> => {
        const invocation = invocationFor(statusDriven(), "inspect-first");
        const invocationId = invocation["invocationId"] as string;
        const before = await committedSnapshot(artifactId);
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
        let settled = false;
        const pending = execute({ method: "POST", path: "/publish", body }, invocation)
          .finally(() => { settled = true; });
        const pump = (async () => {
          const deadline = performance.now() + 1500;
          while (!settled) {
            if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier did not progress");
            for (const candidate of PUBLISH_POINTS) {
              if (settled) break;
              const arrived = await withTimeout(barrier.waitUntilReached(candidate, invocationId), 50);
              if (arrived) barrier.release(candidate, invocationId);
            }
          }
        })();
        await pump;
        const outcome = await pending as unknown as Record<string, unknown>;
        assertOutcomeFailure(outcome, invocationId);
        expect(outcome["failure"]).toMatchObject({
          category: "unauthorized_at_commit", retriable: false, commitState: "not_committed" });
        const env = loadConfig();
        const peer = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
          user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
        try {
          const peerReleases = Number((await peer.query(
            "SELECT count(*) FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].count);
          expect(peerReleases).toBe(0);
          const peerCurrent = (await peer.query(
            "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows;
          expect(peerCurrent).toEqual([]);
          const peerKeys = Number((await peer.query(
            "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows[0].count);
          expect(peerKeys).toBe(0);
          const peerSnapshot = await committedState(peer);
          expect(peerSnapshot).toEqual(before);
        } finally {
          await peer.end();
          await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
        }
      };
      const orderPublicationHoldsGuard = async (): Promise<void> => {
        const invocation = invocationFor(statusDriven(), "inspect-held");
        const run = startBarrierOperation(barrier, invocation.invocationId, () => execute({
          method: "POST", path: "/publish", body: { ...body, idempotencyKey: "q1-inspect-held" } }, invocation), "before_commit");
        const client = await pool.connect();
        let revocation: Promise<unknown> | undefined;
        try {
          await run.reached;
          const pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
          revocation = client.query("UPDATE account_users SET status='suspended' WHERE sub='alice'");
          await assertSqlWriterBlocked(pid);
          run.release();
          expect(await run.pending).toMatchObject({ ok: true });
          await revocation;
        } finally { run.release(); await run.pending.catch(() => {}); await revocation?.catch(() => {}); client.release(); }
        await pool.query("UPDATE account_users SET status='approved' WHERE sub='alice'");
      };
      await orderRevocationFirst();
      await orderPublicationHoldsGuard();
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each(["ensure", "publish"] as const)("%s replay rechecks authority after lookup waits", async (operation) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    try {
      const execute = requireHostExecute(host);
      const ensureBody = { bindingName: `replay-${operation}`, idempotencyKey: `replay-ensure-${operation}` };
      const ensured = await execute({ method: "POST", path: "/ensure", body: ensureBody },
        invocationFor(allowAll(), `replay-setup-${operation}`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: { body: { artifactId: string } } }).result).body.artifactId;
      const body = operation === "ensure" ? ensureBody : { artifactId, idempotencyKey: "replay-publish",
        files: [{ path: "index.html", mimeType: "text/html", text: "replay" }] };
      if (operation === "publish") expect(await execute({ method: "POST", path: "/publish", body },
        invocationFor(allowAll(), "replay-first"))).toMatchObject({ ok: true });
      const before = await committedState(pool);
      let revoked = false;
      const guard: AuthorizeCommit = async (context, transaction) => {
        expect(context.purpose).toBe("replay");
        return revoked ? { allowed: false, reason: "unauthorized_at_commit",
          publicCode: "account_not_approved", status: 403, retriable: false }
          : authorizeTransaction(context, transaction);
      };
      const invocation = invocationFor(guard, `replay-denial-${operation}`);
      const id = invocation.invocationId as string;
      const reached = arrived(barrier, "after_replay_lookup_before_guard", id);
      const pending = execute({ method: "POST", path: `/${operation}`, body }, invocation);
      try { await reached; revoked = true; }
      finally { barrier.release("after_replay_lookup_before_guard", id); }
      const outcome = await pending as Record<string, unknown>;
      assertOutcomeFailure(outcome, id);
      expect(outcome.failure).toMatchObject({ category: "unauthorized_at_commit", commitState: "not_committed" });
      expect(await committedState(pool)).toEqual(before);
    } finally { if (typeof host["close"] === "function") (host["close"] as () => void)(); }
  });

  it.each(["withdrawn", "deleted", "purged"] as const)("refuses publication after lifecycle becomes %s", async (state) => {
    await requireCommitContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    try {
      const execute = requireHostExecute(host);
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: `lifecycle-${state}`, idempotencyKey: `lifecycle-${state}` } },
        invocationFor(allowAll(), `lifecycle-${state}`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = (ensured as { result: { body: { artifactId: string } } }).result.body.artifactId;
      const orderTerminalFirst = async (variant: string): Promise<void> => {
        const writer = await pool.connect();
        let run: ReturnType<typeof startBarrierOperation> | undefined;
        try {
          await writer.query("BEGIN");
          await writer.query("UPDATE artifacts.artifacts SET lifecycle_state=$1 WHERE id=$2", [state, artifactId]);
          const invocation = invocationFor(allowAll(), "terminal-" + state + variant);
          const before = await committedState(pool);
          run = startBarrierOperation(barrier, invocation.invocationId, () => execute({ method: "POST", path: "/publish",
            body: { artifactId, idempotencyKey: "terminal-" + state + variant,
              files: [{ path: variant + ".html", mimeType: "text/html", text: state + variant }] } }, invocation), "before_finalization_row_lock");
          await run.reached;
          run.release();
          expect(await withTimeout(run.pending, 100)).toBeUndefined();
          await writer.query("COMMIT");
          expect(await run.pending).toMatchObject({ ok: false });
          const after = await committedState(pool);
          // The only committed change is the terminal writer's lifecycle.
          await pool.query("UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id=$1", [artifactId]);
          expect(await committedState(pool)).toEqual(before);
          expect(after).not.toEqual(before);
        } finally { run?.release(); await writer.query("ROLLBACK"); await run?.pending.catch(() => {}); writer.release(); }
      };
      const orderPublishHoldsLifecycleLock = async (): Promise<void> => {
        const invocation = invocationFor(allowAll(), "lifecycle-held-" + state);
        const run = startBarrierOperation(barrier, invocation.invocationId, () => execute({ method: "POST", path: "/publish",
          body: { artifactId, idempotencyKey: "lifecycle-held-" + state,
            files: [{ path: "index.html", mimeType: "text/html", text: "held " + state }] } }, invocation), "before_commit");
        const client = await pool.connect();
        let writer: Promise<unknown> | undefined;
        try {
          await run.reached;
          const pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
          writer = client.query("UPDATE artifacts.artifacts SET lifecycle_state=$1 WHERE id=$2", [state, artifactId]);
          await assertSqlWriterBlocked(pid);
          run.release();
          expect(await run.pending).toMatchObject({ ok: true });
          await writer;
        } finally { run.release(); await run.pending.catch(() => {}); await writer?.catch(() => {}); client.release(); }
        await pool.query("UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id=$1", [artifactId]);
      };
      await orderTerminalFirst("a");
      await orderTerminalFirst("b");
      await orderPublishHoldsLifecycleLock();
      const cleanup = await requirePreparationCleanupBinding();
      expect(cleanup).toBeDefined();

    } finally { if (typeof host["close"] === "function") (host["close"] as () => void)(); }
  });

  it("reauthorization of the same key mints a fresh release, then replays on the other transport", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = requireHostExecute(host);
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: "q1-reauth", idempotencyKey: "q1-reauth-ensure" } },
        invocationFor(allowAll(), "reauth-ensure"));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const clientKey = "q1-reauth";
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: "reauthorized" }],
        idempotencyKey: clientKey };
      const invocation = invocationFor(statusDriven(), "reauth-denied");
      const invocationId = invocation["invocationId"] as string;
      const driven1 = startBarrierOperation(barrier, invocationId,
        () => execute({ method: "POST", path: "/publish", body }, invocation), "before_finalization_row_lock");
      const pending = driven1.pending;
      await driven1.reached;
      await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      barrier.release("before_finalization_row_lock", invocationId);
      const denied = await pending as unknown as Record<string, unknown>;
      assertOutcomeFailure(denied, invocationId);
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const fresh = await execute({ method: "POST", path: "/publish", body },
        invocationFor(allowAll(), "reauth-fresh")) as unknown as Record<string, unknown>;
      expect(fresh).toMatchObject({ ok: true });
      expect(await tableCount("releases")).toBe(releasesBefore + 1);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
      const releaseId = await currentReleaseId(artifactId);
      expect(typeof releaseId).toBe("string");
      const second = (await composeQ1Host(barrier));
      try {
        const peerControl = createArtifactControl(second.host as never, SCOPE, BASE);
        const route = controlRoute({ auth, accounts: pool, backend: peerControl });
        const httpReplay = await route.request("https://app.example.test/publish", {
          method: "POST", headers: { cookie: await cookie(ACTOR), origin: auth.appBaseUrl,
            "content-type": "application/json" }, body: JSON.stringify(body),
        });
        expect(httpReplay.status).toBe(201);
        const httpBody = await httpReplay.json() as Record<string, unknown>;
        expect(httpBody["releaseId"]).toBe(releaseId);
        const adapter = createMcpArtifactAdapter(peerControl);
        const mcpReplay = await adapter.execute(
          { method: "POST", path: "/publish", args: body }, { actorId: ACTOR });
        expect(mcpReplay).toMatchObject({ ok: true, status: 201 });
        expect((mcpReplay as { ok: true; data: unknown }).data).toEqual(httpBody);
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
        expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
      } finally {
        (second.host["close"] as () => void)();
      }
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each([
    "suspension",
    "cohort-removal",
    "activation-expiry",
    "authority-outage",
  ] as const)("publish denied for %s prevents success with a fresh check", async (mode) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    const close = host["close"];
    const env = loadConfig();
    let policyPool: pg.Pool | undefined;
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = requireHostExecute(host);
      const fixtures = { subjects: [ACTOR], expiresAtMs: 3_600_000 };
      policyPool = new pg.Pool({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
        user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE });
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(transaction).toBeDefined();
        if (mode === "authority-outage") {
          try {
            await policyPool?.query("SELECT status FROM account_users WHERE sub = 'alice' FOR SHARE");
          } catch {
            return { allowed: false, reason: "unauthorized_at_commit",
              publicCode: "capability_unavailable", status: 503, retriable: true };
          }
        }
        const status = await readPolicyStatusViaTransaction(transaction);
        if (status !== "approved") {
          return toGuardDecision(
            { allowed: false, status: 403, body: { error: "account_not_approved", status: status ?? "unknown" } });
        }
        if (!fixtures.subjects.includes(ACTOR)) {
          return toGuardDecision(
            { allowed: false, status: 403, body: { error: "not_in_cohort" } });
        }
        if (fixtures.expiresAtMs <= 1_000) {
          return toGuardDecision(
            { allowed: false, status: 403, body: { error: "activation_closed" } });
        }
        return authorizeTransaction(context, transaction);
      };
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: `q1-${mode}`, idempotencyKey: `q1-${mode}-ensure` } },
        invocationFor(allowAll(), `${mode}-ensure`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: `denied for ${mode}` }],
        idempotencyKey: `q1-${mode}` };
      const invocation = invocationFor(authorizeCommit, mode);
      const invocationId = invocation["invocationId"] as string;
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const driven2 = startBarrierOperation(barrier, invocationId,
        () => execute({ method: "POST", path: "/publish", body }, invocation), "before_finalization_row_lock");
      const pending = driven2.pending;
      await driven2.reached;
      if (mode === "suspension") {
        await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      } else if (mode === "cohort-removal") {
        fixtures.subjects = ["bob"];
      } else if (mode === "activation-expiry") {
        fixtures.expiresAtMs = 999;
      } else {
        await policyPool?.end();
      }
      barrier.release("before_finalization_row_lock", invocationId);
      const outcome = await pending as unknown as Record<string, unknown>;
      assertOutcomeFailure(outcome, invocationId);
      if (mode === "authority-outage") {
        expect(outcome["failure"]).toMatchObject({
          category: "unauthorized_at_commit", retriable: true, commitState: "not_committed" });
      } else {
        expect(outcome["failure"]).toMatchObject({
          category: "unauthorized_at_commit", retriable: false, commitState: "not_committed" });
      }
      expect(await tableCount("releases")).toBe(releasesBefore);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
      expect(await currentReleaseId(artifactId)).toBeUndefined();
      fixtures.subjects = [ACTOR];
      fixtures.expiresAtMs = 3_600_000;
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      const retry = await execute({ method: "POST", path: "/publish", body },
        invocationFor(mode === "authority-outage" ? allowAll() : authorizeCommit, `${mode}-retry`));
      if (mode === "authority-outage") {
        expect(retry).toMatchObject({ ok: true });
        expect(await tableCount("releases")).toBe(releasesBefore + 1);
      }
    } finally {
      await policyPool?.end().catch(() => {});
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("policy revision race denies the stale writer linearized after the revocation", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const composed = await composeQ1Host(barrier);
    const host = composed.host;
    const close = host["close"];
    try {
      requireSelectedProfile(host, composed.profile.digest);
      const execute = requireHostExecute(host);
      await pool.query("CREATE TABLE IF NOT EXISTS test_policy_revision (id int PRIMARY KEY, rev text NOT NULL)");
      await pool.query("INSERT INTO test_policy_revision (id, rev) VALUES (1, 'q1-rev-1') ON CONFLICT (id) DO UPDATE SET rev = 'q1-rev-1'");
      const readRevisionViaTransaction = async (transaction: unknown): Promise<string> => {
        const rows = await transactionQuery<{ rev: string }>(transaction,
          "SELECT rev FROM test_policy_revision WHERE id = $1 FOR SHARE", [1]);
        return rows.rows[0]?.rev ?? "";
      };
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(transaction).toBeDefined();
        const current = await readRevisionViaTransaction(transaction);
        if (current !== "q1-rev-1") {
          return { allowed: false, reason: "unauthorized_at_commit",
            publicCode: "capability_unavailable", status: 403, retriable: false };
        }
        return authorizeTransaction(context, transaction);
      };
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: "q1-rev", idempotencyKey: "q1-rev-ensure" } },
        invocationFor(allowAll(), "rev-ensure"));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const orderRevocationFirst = async (): Promise<void> => {
        const writer = await pool.connect();
        let run: ReturnType<typeof startBarrierOperation> | undefined;
        try {
          await writer.query("BEGIN");
          await writer.query("SELECT rev FROM test_policy_revision WHERE id=1 FOR UPDATE");
          await writer.query("UPDATE test_policy_revision SET rev='q1-rev-2' WHERE id=1");
          const before = await committedSnapshot(artifactId);
          const invocation = invocationFor(authorizeCommit, "rev-first");
          run = startBarrierOperation(barrier, invocation.invocationId, () => execute({
            method: "POST", path: "/publish", body: { artifactId, idempotencyKey: "q1-rev-first",
              files: [{ path: "index.html", mimeType: "text/html", text: "stale revision" }] } }, invocation), "before_finalization_row_lock");
          await run.reached;
          run.release();
          expect(await withTimeout(run.pending, 100)).toBeUndefined();
          await writer.query("COMMIT");
          const outcome = await run.pending;
          assertOutcomeFailure(outcome, invocation.invocationId);
          expect((outcome as { failure: unknown }).failure).toMatchObject({ category: "unauthorized_at_commit" });
          expect(await committedSnapshot(artifactId)).toEqual(before);
          expect(await currentReleaseId(artifactId)).toBeUndefined();
        } finally { run?.release(); await writer.query("ROLLBACK"); await run?.pending.catch(() => {}); writer.release(); }
        await pool.query("UPDATE test_policy_revision SET rev='q1-rev-1' WHERE id=1");
      };
      const orderPublicationHoldsShareLock = async (): Promise<void> => {
        const invocation = invocationFor(authorizeCommit, "rev-held");
        const run = startBarrierOperation(barrier, invocation.invocationId, () => execute({
          method: "POST", path: "/publish", body: { artifactId, idempotencyKey: "q1-rev-held",
            files: [{ path: "index.html", mimeType: "text/html", text: "held revision" }] } }, invocation), "before_commit");
        const client = await pool.connect();
        let writer: Promise<unknown> | undefined;
        try {
          await run.reached;
          const pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
          writer = client.query("UPDATE test_policy_revision SET rev='q1-rev-2' WHERE id=1");
          await assertSqlWriterBlocked(pid);
          run.release();
          expect(await run.pending).toMatchObject({ ok: true });
          await writer;
        } finally { run.release(); await run.pending.catch(() => {}); await writer?.catch(() => {}); client.release(); }
        await pool.query("UPDATE test_policy_revision SET rev='q1-rev-1' WHERE id=1");
      };
      await orderRevocationFirst();
      await orderPublicationHoldsShareLock();
    } finally {
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each([false, true])("same-key S3 race across processes, changed command %s", async (changedCommand) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const env = loadConfig();
    const composedA = await composeQ1Host(barrier);
    const hostA = composedA.host;
    const closeA = hostA["close"];
    const worker = await startArtifactWorker({ host: env.POSTGRES_HOST, port: env.POSTGRES_PORT,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: DATABASE }, storageConfig());
    expect(worker.pid).not.toBe(process.pid);
    const barrierB = worker.barrier;
    try {
      requireSelectedProfile(hostA, composedA.profile.digest);
      const executeA = requireHostExecute(hostA);
      const executeB = worker.execute;
      const purposes: Array<{ invocationId: string; purpose: string }> = [];
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(transaction).toBeDefined();
        purposes.push({ invocationId: context.invocationId, purpose: context.purpose });
        return authorizeTransaction(context, transaction);
      };
      // Isolate durable identities per variant: without this, the second
      // variant replays the first variant's durable success and never reaches
      // the key barrier. The shared key below stays common only to the two
      // competitors (A/B) of THIS variant.
      const variant = changedCommand ? "changed" : "same";
      const ensured = await executeA({ method: "POST", path: "/ensure",
        body: { bindingName: `q1-race-${variant}`, idempotencyKey: `q1-race-ensure-${variant}` } },
        invocationFor(authorizeCommit, `race-ensure-${variant}`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: `same-key race ${variant}` }],
        idempotencyKey: `q1-race-${variant}` };
      const internalKey = deriveIdempotencyKey(
        { scope: SCOPE, sub: ACTOR, op: "publish", artifactId, clientKey: `q1-race-${variant}` });
      const invA = invocationFor(authorizeCommit, `race-a-${variant}`);
      const invB = invocationFor(authorizeCommit, `race-b-${variant}`);
      const invAId = invA["invocationId"] as string;
      const invBId = invB["invocationId"] as string;
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const drainPoints: readonly CommitBarrierPoint[] = [
        ...PUBLISH_POINTS, "after_replay_lookup_before_guard",
      ];
      let settledB = false;
      const pendingB = executeB({ method: "POST", path: "/publish", body: changedCommand
        ? { ...body, files: [{ path: "different.html", mimeType: "text/html", text: "different command" }] } : body }, invB)
        .finally(() => { settledB = true; });
      const pumpB = (async () => {
        const deadline = performance.now() + 1500;
        while (!settledB) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier B did not progress");
          for (const candidate of drainPoints) {
            if (settledB || candidate === "before_key_lock") continue;
            const arrived = await withTimeout(barrierB.waitUntilReached(candidate, invBId), 50);
            if (arrived) barrierB.release(candidate, invBId);
          }
          await withTimeout(new Promise<void>((resolve) => setTimeout(resolve, 50)), 50);
        }
      })();
      await barrierB.waitUntilReached("before_key_lock", invBId);
      let settledA = false;
      const pendingA = executeA({ method: "POST", path: "/publish", body }, invA)
        .finally(() => { settledA = true; });
      const pumpA = (async () => {
        const deadline = performance.now() + 1500;
        while (!settledA) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier A did not progress");
          for (const candidate of drainPoints) {
            if (settledA) break;
            const arrived = await withTimeout(barrier.waitUntilReached(candidate, invAId), 50);
            if (arrived) barrier.release(candidate, invAId);
          }
        }
      })();
      const winner = await pendingA as unknown as Record<string, unknown>;
      await pumpA;
      expect(winner).toMatchObject({ ok: true });
      const cleanup = await requirePreparationCleanupBinding();
      const preparing = await cleanup.inspectPreparations(hostA, artifactId);
      const preparedLoser = preparing.attempts.find((attempt) => attempt.invocationId === invBId);
      expect(preparedLoser?.blobKeys.length).toBeGreaterThan(0);
      const preparedKeys = new Set(await rawBlobs().listKeys(`artifacts/${SCOPE}/`));
      for (const key of preparedLoser!.blobKeys) expect(preparedKeys.has(key)).toBe(true);
      barrierB.release("before_key_lock", invBId);
      const loser = await pendingB as unknown as Record<string, unknown>;
      await pumpB;
      expect(loser).toMatchObject({ ok: !changedCommand });
      const winnerBody = ((winner as { result: unknown }).result as { body: unknown }).body;
      if (changedCommand) expect(loser.failure).toMatchObject({ category: "conflict" });
      else {
        expect((loser.result as { body: unknown }).body).toEqual(winnerBody);
        expect(worker.authorizations).toContainEqual({ invocationId: invBId, purpose: "replay" });
      }
      expect(await tableCount("releases")).toBe(releasesBefore + 1);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore + 1);
      const successRows = Number((await pool.query(
        "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1", [internalKey])).rows[0].count);
      expect(successRows).toBe(1);
      expect(cleanup).toBeDefined();
      const observed = await cleanup.inspectPreparations(hostA, artifactId);
      // Both preparations of THIS variant must be attributed; a replayed
      // durable success from the other variant cannot satisfy this.
      expect(observed.attempts.length).toBeGreaterThanOrEqual(2);
      expect(observed.attempts.map((attempt) => attempt.invocationId)).toEqual(expect.arrayContaining([invAId, invBId]));
      expect(new Set(observed.attempts.map((attempt) => attempt.attemptId)).size).toBeGreaterThanOrEqual(2);
      // A6 allows the loser to finish cleanup before this observation: accept
      // an already-settled state, but keep the historical attribution and the
      // shared-blob retention proof.
      const loserAttempt = observed.attempts.find((attempt) => attempt.invocationId === invBId);
      expect(["abandoned", "failed-cleaned", "cleaned"]).toContain(loserAttempt?.state);
      expect(loserAttempt).toMatchObject({ attemptId: preparedLoser!.attemptId,
        invocationId: preparedLoser!.invocationId, blobKeys: preparedLoser!.blobKeys });
      for (const attempt of observed.attempts.filter((candidate) =>
        [invAId, invBId].includes(candidate.invocationId))) {
        expect(attempt.blobKeys.length).toBeGreaterThan(0);
      }
      const keys = await listTestBucketKeys(s3, BUCKET);
      expect([...keys].length).toBeGreaterThan(0);
      const s3Keys = new Set([...keys]);
      const winnerKeys = new Set(observed.attempts.find(
        (attempt) => attempt.invocationId === invAId)?.blobKeys ?? []);
      const sharedSet = new Set(observed.protectedKeys);
      for (const attempt of observed.attempts.filter((candidate) =>
        [invAId, invBId].includes(candidate.invocationId))) {
        const settled = attempt.state === "cleaned" || attempt.state === "failed-cleaned";
        for (const blobKey of attempt.blobKeys) {
          // Cleanup may remove exclusive loser bytes before its state settles.
          // The preparation was observed before releasing B; the winner's
          // bytes and every protected shared blob must still survive.
          if (winnerKeys.has(blobKey) || sharedSet.has(blobKey)) {
            expect(s3Keys.has(blobKey)).toBe(true);
          } else if (settled) {
            expect(s3Keys.has(blobKey)).toBe(false);
          }
        }
      }
    } finally {
      if (typeof closeA === "function") (closeA as () => void)();
      await worker.close();
    }
  });

  it.each(["purge-first", "publication-first"] as const)("purge claim blocks a new reference from another artifact in %s order", async (order) => {
    await requireCommitContract();
    const binding = await requirePurgeRaceBinding();
    const barrier = await requireCommitBarrier();
    const { host } = await composeQ1Host(barrier);
    let paused: Awaited<ReturnType<typeof binding.pausePurgeBeforeDelete>> | undefined;
    let run: ReturnType<typeof startBarrierOperation> | undefined;
    try {
      const execute = requireHostExecute(host);
      // Collectable bytes live only on the purge target; the other artifact is
      // active but does NOT reference them yet. Referencing them from the other
      // artifact while the deletion claim is held is the discriminating act: a
      // provider ignoring claims during reference creation passes the old
      // same-artifact lifecycle check and fails here.
      const collectableText = `purge-collectable-${order}`;
      const seedTarget = async (name: string): Promise<string> => {
        const ensured = await execute({ method: "POST", path: "/ensure", body: { bindingName: name,
          idempotencyKey: name } }, invocationFor(allowAll(), name)) as { result: { body: { artifactId: string } } };
        const id = ensured.result.body.artifactId;
        expect(await execute({ method: "POST", path: "/publish", body: { artifactId: id,
          files: [{ path: "index.html", mimeType: "text/html", text: collectableText },
            { path: "exclusive.html", mimeType: "text/html", text: `exclusive-${order}` }],
          idempotencyKey: name + "-publish" } }, invocationFor(allowAll(), name + "-publish"))).toMatchObject({ ok: true });
        return id;
      };
      const seedActive = async (name: string): Promise<string> => {
        const ensured = await execute({ method: "POST", path: "/ensure", body: { bindingName: name,
          idempotencyKey: name } }, invocationFor(allowAll(), name)) as { result: { body: { artifactId: string } } };
        return ensured.result.body.artifactId;
      };
      const targetId = await seedTarget(`purge-target-${order}`);
      const otherId = await seedActive(`purge-other-${order}`);
      const sharedKeys: string[] = [];
      for (const key of await rawBlobs().listKeys(`artifacts/${SCOPE}/`)) {
        if (new TextDecoder().decode(await rawBlobs().getBlob(key)) === collectableText) sharedKeys.push(key);
      }
      expect(sharedKeys.length).toBeGreaterThan(0);
      const referenceBody = { artifactId: otherId,
        files: [{ path: "index.html", mimeType: "text/html", text: collectableText }] };
      if (order === "purge-first") {
        // Suspend the deletion of the collectable blob, then try to reference
        // the same bytes from the other active artifact while the claim holds.
        paused = await binding.pausePurgeBeforeDelete(host, targetId);
        expect(paused.claimId.length).toBeGreaterThan(0);
        expect(paused.blobKeys.length).toBeGreaterThan(0);
        for (const key of sharedKeys) expect(paused.blobKeys).toContain(key);
        expect(await binding.inspectDeletionClaims(host)).toContainEqual(
          expect.objectContaining({ claimId: paused.claimId }));
        const reference = invocationFor(allowAll(), `purge-reference-${order}`);
        const referenceKey = `purge-reference-${order}`;
        const referenceInternalKey = deriveIdempotencyKey(
          { scope: SCOPE, sub: ACTOR, op: "publish", artifactId: otherId, clientKey: referenceKey });
        const referenceReleaseCount = async (): Promise<number> => Number((await pool.query(
          "SELECT count(*) FROM artifacts.releases WHERE artifact_id = $1", [otherId])).rows[0].count);
        const releasesBeforeReference = await referenceReleaseCount();
        const pointerBeforeReference = await currentReleaseId(otherId);
        const pending = execute({ method: "POST", path: "/publish",
          body: { ...referenceBody, idempotencyKey: referenceKey } },
          reference);
        void pending.catch(() => {});
        let early: unknown;
        await withTimeout(pending.then((value) => { early = value; }), 100);
        const refusedBeforeResolution = early !== undefined;
        if (refusedBeforeResolution) assertOutcomeFailure(early, reference.invocationId);
        paused.release();
        await paused.finished;
        paused = undefined;
        const outcome = await pending;
        // A refusal may arrive after waiting for claim resolution too (A4).
        // The first result is verified HERE, before any reparative retry: a
        // retry with a fresh key would recreate the bytes and mask a success
        // that attached the deleted blob without repreparing it.
        const referenceSuccessRows = async (): Promise<number> => Number((await pool.query(
          "SELECT count(*) FROM artifacts.idempotency_keys WHERE key = $1",
          [referenceInternalKey])).rows[0].count);
        if (!refusedBeforeResolution && (outcome as { ok?: unknown }).ok === false) {
          assertOutcomeFailure(outcome, reference.invocationId);
          // A refused attempt must commit no success for its durable key.
          expect(await referenceSuccessRows()).toBe(0);
          expect(await referenceReleaseCount()).toBe(releasesBeforeReference);
          expect(await currentReleaseId(otherId)).toBe(pointerBeforeReference);
        } else if (!refusedBeforeResolution) {
          expect(outcome).toMatchObject({ ok: true });
          // A success that waited for claim resolution must have reprepared
          // the bytes: the durable receipt exists and the collectable bytes
          // still read back BEFORE the retry below recreates anything.
          expect(await referenceSuccessRows()).toBe(1);
          expect(await referenceReleaseCount()).toBe(releasesBeforeReference + 1);
          const receipt = (outcome as { result: { body: { artifactId: string; releaseId: string } } }).result.body;
          expect(receipt.artifactId).toBe(otherId);
          expect(receipt.releaseId).toEqual(expect.any(String));
          expect(await currentReleaseId(otherId)).toBe(receipt.releaseId);
          const durableReceipt = (await pool.query(
            "SELECT result FROM artifacts.idempotency_keys WHERE key = $1", [referenceInternalKey])).rows;
          expect(durableReceipt).toEqual([{ result: receipt }]);
          const release = (await pool.query(
            "SELECT artifact_id, manifest, state FROM artifacts.releases WHERE id = $1", [receipt.releaseId])).rows[0];
          expect(release).toMatchObject({ artifact_id: otherId, state: "ready" });
          const files = JSON.parse(release.manifest).files as Array<{ path: string; digest: string }>;
          expect(files).toHaveLength(1);
          expect(files[0]?.path).toBe("index.html");
          expect(sharedKeys).toContain(`artifacts/${SCOPE}/blobs/sha256/${files[0]!.digest.slice(7)}`);
          expect(Number((await pool.query(
            "SELECT count(*) FROM artifacts.blob_ref_holders WHERE digest = $1", [files[0]!.digest])).rows[0].count))
            .toBeGreaterThan(0);
          for (const key of sharedKeys) {
            expect(new TextDecoder().decode(await rawBlobs().getBlob(key))).toBe(collectableText);
          }
        } else {
          // An early refusal must also leave no committed success behind.
          expect(await referenceSuccessRows()).toBe(0);
          expect(await referenceReleaseCount()).toBe(releasesBeforeReference);
          expect(await currentReleaseId(otherId)).toBe(pointerBeforeReference);
        }
        // After claim resolution, a fresh authorized attempt must reprepare
        // rather than attach the deleted blob.
        const retry = invocationFor(allowAll(), `purge-retry-${order}`);
        const retried = await execute({ method: "POST", path: "/publish",
          body: { ...referenceBody, idempotencyKey: `purge-retry-${order}` } },
          retry);
        expect(retried).toMatchObject({ ok: true });
      } else {
        // Hold the cross-artifact reference preparation at the final barrier,
        // then prove the purge waits; release the publication first (success),
        // then resolve the purge and prove the shared bytes survive.
        const reference = invocationFor(allowAll(), `purge-held-${order}`);
        run = startBarrierOperation(barrier, reference.invocationId, () => execute({
          method: "POST", path: "/publish",
          body: { ...referenceBody, idempotencyKey: `purge-held-${order}` } }, reference), "before_commit");
        await run.reached;
        const purge = binding.pausePurgeBeforeDelete(host, targetId);
        let earlyPause: typeof paused;
        await withTimeout(purge.then((value) => { earlyPause = value; }), 100);
        if (earlyPause) for (const key of sharedKeys) expect(earlyPause.blobKeys).not.toContain(key);
        run.release();
        expect(await run.pending).toMatchObject({ ok: true });
        paused = earlyPause ?? await purge;
        expect(paused.claimId.length).toBeGreaterThan(0);
        expect(await binding.inspectDeletionClaims(host)).toContainEqual(
          expect.objectContaining({ claimId: paused.claimId }));
        // The target has exclusive bytes too, so purge can reach DELETE even
        // though the new committed reference protects the shared bytes.
        for (const key of sharedKeys) expect(paused.blobKeys).not.toContain(key);
        paused.release();
        await paused.finished;
        paused = undefined;
        const after = new Set(await rawBlobs().listKeys(`artifacts/${SCOPE}/`));
        for (const key of sharedKeys) expect(after.has(key)).toBe(true);
      }
      for (const key of sharedKeys) {
        expect(new TextDecoder().decode(await rawBlobs().getBlob(key))).toBe(collectableText);
      }
    } finally {
      run?.release(); paused?.release();
      await run?.pending.catch(() => {}); await paused?.finished.catch(() => {});
      (host["close"] as () => void)();
    }
  });

  it("last quota unit across processes is not covered without the H3 quota interface", () => {
    reportNotCovered(
      "q1-last-quota-unit",
      "transaction-bound quota reservation/commit participant",
      "H3 units 5-6",
      "71f41b72",
    );
  });

  it("transaction-bound admission accounting is not covered without the H3 quota interface", () => {
    reportNotCovered(
      "q1-admission-quota-accounting",
      "quota-aware admission binding with policy-revision fence",
      "H3 units 5-6",
      "71f41b72",
    );
  });
});

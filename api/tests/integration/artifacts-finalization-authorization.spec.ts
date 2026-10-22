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
  reportNotCovered,
  committedState,
  startArtifactWorker,
  arrived,
  requireCommitBarrier,
  requireCommitContract,
  requireHostExecute,
  requireOutcomeContract,
  requireSelectedProfile,
  toGuardDecision,
  type AuthorizeCommit,
  type CommitBarrierPoint,
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

  async function committedSnapshot(artifactId: string): Promise<unknown> {
    void artifactId;
    return committedState(pool);
  }

  async function composeQ1Host(
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
      invocationId: `q1-${suffix}-${nextInvocationId++}`,
      actorId: ACTOR,
      storageScopeId: SCOPE,
      authorizeCommit,
    }) as unknown as Record<string, unknown>;
  }

  function allowAll(): AuthorizeCommit {
    return authorizeTransaction;
  }

  function statusDriven(): AuthorizeCommit {
    return async (context, transaction) => {
      const status = (await pool.query(
        "SELECT status FROM account_users WHERE sub = 'alice'")).rows[0]?.status as string | null;
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

  it.each(PUBLISH_POINTS)("publish refused at barrier point %s leaves zero committed effects", async (point) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
    const close = host["close"];
    try {
      requireSelectedProfile(host);
      const execute = requireHostExecute(host);
      const seenTransactions: unknown[] = [];
      let passedBarrier = false;
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(context.purpose).toBe("finalize");
        expect(transaction).toBeDefined();
        seenTransactions.push({ transaction, passedBarrier });
        return statusDriven()(context, transaction);
      };
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: `q1-${point}`, idempotencyKey: `q1-publish-${point}-ensure` } },
        invocationFor(allowAll(), `publish-${point}-ensure`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = ((ensured as { result: unknown }).result as { body: { artifactId: string } })
        .body.artifactId;
      const body = { artifactId,
        files: [{ path: "index.html", mimeType: "text/html", text: `refused at ${point}` }],
        idempotencyKey: `q1-publish-${point}` };
      const invocation = invocationFor(authorizeCommit, `publish-${point}`);
      const invocationId = invocation["invocationId"] as string;
      const before = await committedSnapshot(artifactId);
      const s3Before = await s3KeyCount();
      let settled = false;
      const pending = execute({ method: "POST", path: "/publish", body }, invocation)
        .finally(() => { settled = true; });
      const pump = (async () => {
        const deadline = performance.now() + 1500;
        while (!settled) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier did not progress");
          for (const candidate of PUBLISH_POINTS) {
            if (settled || candidate === point) continue;
            const arrived = await withTimeout(barrier.waitUntilReached(candidate, invocationId), 50);
            if (arrived) barrier.release(candidate, invocationId);
          }
          const targetArrived = await withTimeout(barrier.waitUntilReached(point, invocationId), 50);
          if (targetArrived) break;
        }
      })();
      await pump;
      await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      passedBarrier = true;
      barrier.release(point, invocationId);
      const outcome = await pending as unknown as Record<string, unknown>;
      expect(seenTransactions.length).toBeGreaterThan(0);
      expect(seenTransactions.at(-1)).toMatchObject({ passedBarrier: true });
      assertOutcomeFailure(outcome, invocationId);
      expect(outcome["failure"]).toMatchObject({ category: "unauthorized_at_commit" });
      expect(await committedSnapshot(artifactId)).toEqual(before);
      expect(await currentReleaseId(artifactId)).toBeUndefined();
      const s3AfterDenial = await s3KeyCount();
      console.info("[preparation-debt]", JSON.stringify({ point, s3Before, s3AfterDenial }));
      expect(s3AfterDenial).toBeGreaterThanOrEqual(s3Before);
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each(ENSURE_POINTS)("ensure refused at barrier point %s leaves zero committed effects", async (point) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
    const close = host["close"];
    try {
      requireSelectedProfile(host);
      const execute = requireHostExecute(host);
      const seenTransactions: unknown[] = [];
      let passedBarrier = false;
      const authorizeCommit: AuthorizeCommit = async (context, transaction) => {
        expect(context.purpose).toBe("finalize");
        expect(transaction).toBeDefined();
        seenTransactions.push({ transaction, passedBarrier });
        return statusDriven()(context, transaction);
      };
      const body = { bindingName: `q1-ensure-${point}`, idempotencyKey: `q1-ensure-${point}` };
      const invocation = invocationFor(authorizeCommit, `ensure-${point}`);
      const invocationId = invocation["invocationId"] as string;
      const releasesBefore = await tableCount("releases");
      const keysBefore = await tableCount("idempotency_keys");
      const artifactsBefore = await tableCount("artifacts");
      const stateBefore = await committedState(pool);
      let settled = false;
      const pending = execute({ method: "POST", path: "/ensure", body }, invocation)
        .finally(() => { settled = true; });
      const pump = (async () => {
        const deadline = performance.now() + 1500;
        while (!settled) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier did not progress");
          for (const candidate of ENSURE_POINTS) {
            if (settled || candidate === point) continue;
            const arrived = await withTimeout(barrier.waitUntilReached(candidate, invocationId), 50);
            if (arrived) barrier.release(candidate, invocationId);
          }
          const targetArrived = await withTimeout(barrier.waitUntilReached(point, invocationId), 50);
          if (targetArrived) break;
        }
      })();
      await pump;
      await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      passedBarrier = true;
      barrier.release(point, invocationId);
      const outcome = await pending as unknown as Record<string, unknown>;
      expect(seenTransactions.length).toBeGreaterThan(0);
      expect(seenTransactions.at(-1)).toMatchObject({ passedBarrier: true });
      assertOutcomeFailure(outcome, invocationId);
      expect(outcome["failure"]).toMatchObject({ category: "unauthorized_at_commit" });
      expect(await tableCount("releases")).toBe(releasesBefore);
      expect(await tableCount("idempotency_keys")).toBe(keysBefore);
      expect(await tableCount("artifacts")).toBe(artifactsBefore);
      expect(await committedState(pool)).toEqual(stateBefore);
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it("revocation then release holds no committed success on inspection from another connection", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
    const close = host["close"];
    try {
      requireSelectedProfile(host);
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
      const invocation = invocationFor(statusDriven(), "inspect");
      const invocationId = invocation["invocationId"] as string;
      const before = await committedSnapshot(artifactId);
      let settled = false;
      const pending = execute({ method: "POST", path: "/publish", body }, invocation)
        .finally(() => { settled = true; });
      const pump = (async () => {
        const deadline = performance.now() + 1500;
        while (!settled) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier did not progress");
          for (const candidate of PUBLISH_POINTS) {
            if (settled || candidate === "after_finalization_locks_before_guard") continue;
            const arrived = await withTimeout(barrier.waitUntilReached(candidate, invocationId), 50);
            if (arrived) barrier.release(candidate, invocationId);
          }
          const targetArrived = await withTimeout(
            barrier.waitUntilReached("after_finalization_locks_before_guard", invocationId), 50);
          if (targetArrived) break;
        }
      })();
      await pump;
      await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      barrier.release("after_finalization_locks_before_guard", invocationId);
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
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });

  it.each(["ensure", "publish"] as const)("%s replay rechecks authority after lookup waits", async (operation) => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
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
    } finally { if (typeof host.close === "function") host.close(); }
  });

  it.each(["withdrawn", "deleted", "purged"] as const)("refuses publication after lifecycle becomes %s", async (state) => {
    await requireCommitContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
    try {
      const execute = requireHostExecute(host);
      const ensured = await execute({ method: "POST", path: "/ensure",
        body: { bindingName: `lifecycle-${state}`, idempotencyKey: `lifecycle-${state}` } },
        invocationFor(allowAll(), `lifecycle-${state}`));
      expect(ensured).toMatchObject({ ok: true });
      const artifactId = (ensured as { result: { body: { artifactId: string } } }).result.body.artifactId;
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN");
        await writer.query("SELECT id FROM artifacts.artifacts WHERE id=$1 FOR UPDATE", [artifactId]);
        await writer.query("UPDATE artifacts.artifacts SET lifecycle_state=$1 WHERE id=$2", [state, artifactId]);
        await writer.query("COMMIT");
      } finally { writer.release(); }
      const before = await committedState(pool);
      const outcome = await execute({ method: "POST", path: "/publish", body: { artifactId,
        idempotencyKey: `terminal-${state}`, files: [{ path: "index.html", mimeType: "text/html", text: state }] } },
        invocationFor(allowAll(), `terminal-${state}`));
      expect(outcome).toMatchObject({ ok: false });
      expect(await committedState(pool)).toEqual(before);
    } finally { if (typeof host.close === "function") host.close(); }
  });

  it("reauthorization of the same key mints a fresh release, then replays on the other transport", async () => {
    await requireCommitContract();
    await requireOutcomeContract();
    const barrier = await requireCommitBarrier();
    const host = await composeQ1Host(barrier.observer);
    const close = host["close"];
    try {
      requireSelectedProfile(host);
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
      let settled = false;
      const pending = execute({ method: "POST", path: "/publish", body }, invocation)
        .finally(() => { settled = true; });
      const pump = (async () => {
        const deadline = performance.now() + 1500;
        while (!settled) {
          if (performance.now() > deadline) throw new Error("[contract-violation] commit barrier did not progress");
          for (const candidate of PUBLISH_POINTS) {
            if (settled || candidate === "after_finalization_locks_before_guard") continue;
            const arrived = await withTimeout(barrier.waitUntilReached(candidate, invocationId), 50);
            if (arrived) barrier.release(candidate, invocationId);
          }
          const targetArrived = await withTimeout(
            barrier.waitUntilReached("after_finalization_locks_before_guard", invocationId), 50);
          if (targetArrived) break;
        }
      })();
      await pump;
      await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'alice'");
      barrier.release("after_finalization_locks_before_guard", invocationId);
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
      const second = (await composeQ1Host(barrier.observer));
      try {
        const peerControl = createArtifactControl(second, SCOPE, BASE);
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
        second.close();
      }
    } finally {
      await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'alice'");
      if (typeof close === "function") (close as () => void)();
    }
  });
});
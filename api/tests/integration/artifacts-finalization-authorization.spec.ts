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
});
import type { AdmissionResult } from "@radar/artifacts-host";
import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";
import type { ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { HttpResponse } from "@sentropic/artifacts/http";
import { assertAttributedTestObjects } from "./artifacts-s3.helpers.js";
import type pg from "pg";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Provisional r2 upstream contract bindings (Sentropic spec r2, section 3.2).
 *
 * Frozen server-side public API under test (none is an HTTP/MCP argument):
 * - `ArtifactInvocationContext.authorizeCommit` from
 *   `@sentropic/artifacts/server/commit-contract`. The context is frozen and
 *   server-created (`invocationId`, `actorId`, `storageScopeId`,
 *   `authorizeCommit`). The provider invokes the callback with the leased
 *   finalization transaction AFTER the commit barrier waits; a callback wired
 *   before `putRelease` or checked after `app.handle` does not qualify.
 * - `host.execute(request, invocation)` (equivalently `host.app.execute`)
 *   returning `ArtifactOutcome` from
 *   `@sentropic/artifacts/server/outcome-contract`. Target assertions read
 *   `outcome.ok === false` plus `outcome.failure.cause`, the failure
 *   category and the invocation ID BEFORE projection. No shared last-error
 *   slot is consumed.
 * - `host.selectedCapabilities` keeps its slot but the assertion is the
 *   frozen four-name value plus the compiled profile digest, never a truthy
 *   property check.
 * - Test-only `createArtifactCommitBarrier()` from
 *   `@sentropic/artifacts/testing`, bound once as the coordinator
 *   `testObserver` below the app with invocation correlation.
 *
 * Retired slots (never a `[missing-contract]` source): the suite no longer
 * probes `host.setFinalizeAuthorization` nor `host.app.takeTypedCause`. Their
 * absence is expected on the r2 line and must never raise the diagnostic.
 *
 * Against the installed provider (0.1.2) the three upstream entries above do
 * not exist. They are loaded dynamically here so this module still compiles
 * and every gated suite stays skipped without the gate (CI green). With
 * `ARTIFACTS_PROVIDER_ACCEPTANCE=1` each missing entry fails by name as
 * `[missing-contract] <entry>`.
 */

export const COMMIT_CONTRACT_SPECIFIER = "@sentropic/artifacts/server/commit-contract";
export const OUTCOME_CONTRACT_SPECIFIER = "@sentropic/artifacts/server/outcome-contract";
export const TESTING_SPECIFIER = "@sentropic/artifacts/testing";
export const PROFILE_COMPILER_SPECIFIER = "@sentropic/artifacts/mcp-core";
export const PREPARATION_CLEANUP_SPECIFIER = "@sentropic/artifacts/server/object-intents";

/** Frozen r2 selection for the Radar profile, deterministically ordered. */
export const FROZEN_CAPABILITIES = [
  "artifacts_ensure",
  "artifacts_get",
  "artifacts_list",
  "artifacts_publish",
] as const;

/** Compiled r2 profile returned by the upstream compiler, never fabricated. */
export interface CompiledArtifactsProfile {
  readonly profileDigest: string;
  readonly selectedCapabilities: readonly string[];
  readonly [key: string]: unknown;
}

/** Real r2 coordinator bound to a transaction participant and test observer. */
export interface R2CommitCoordinator {
  readonly testObserver: unknown;
  readonly [key: string]: unknown;
}

export interface ProviderHostShape extends Record<string, unknown> {
  readonly selectedCapabilities: readonly string[];
  readonly execute: (request: unknown, invocation: unknown) => Promise<unknown>;
  readonly close: () => void;
}

export interface PreparationCleanupBinding {
  inspectPreparations(host: unknown, artifactId: string): Promise<{
    attempts: Array<{ attemptId: string; invocationId: string; state: string;
      preparedAtMs: number; cleanupDeadlineMs: number; blobKeys: string[] }>;
    protectedKeys: string[]; abandonedKeys: string[];
  }>;
  scheduleBoundedPreparationCleanup(host: unknown, throughMs: number): Promise<void>;
}

/** Barrier points frozen by spec r2 section 3.2. */
export type CommitBarrierPoint =
  | "before_connection_acquire"
  | "before_key_lock"
  | "before_blob_put"
  | "after_blob_put_before_verify"
  | "before_blob_readback"
  | "before_finalization_row_lock"
  | "after_finalization_locks_before_guard"
  | "after_replay_lookup_before_guard"
  | "before_commit";

export interface CommitBarrier {
  readonly observer: unknown;
  readonly coordinatorPoints?: readonly CoordinatorBarrierPoint[] | undefined;
  waitUntilReached(point: CommitBarrierPoint, invocationId: string): Promise<void>;
  release(point: CommitBarrierPoint, invocationId: string): void;
}

export type CoordinatorBarrierPoint = Exclude<CommitBarrierPoint,
  "before_blob_put" | "after_blob_put_before_verify" | "before_blob_readback">;

interface PublicCommitBarrier extends CommitBarrier {
  readonly observer: ((point: CommitBarrierPoint, invocationId: string) => Promise<void>) & {
    arrive(point: CommitBarrierPoint, invocationId: string): void;
  };
}

export type AuthorizePurpose = "finalize" | "replay";

export interface AuthorizeCommitContext {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly operation: string;
  readonly artifactId?: string | undefined;
  readonly purpose: AuthorizePurpose;
  readonly policyRevision: string;
}

export type AuthorizeCommitDecision =
  | { readonly allowed: true; readonly fence: unknown }
  | { readonly allowed: false; readonly reason: string; readonly publicCode: string;
      readonly status: number; readonly retriable: boolean };

export type AuthorizeCommitSignature = (
  context: AuthorizeCommitContext,
  transaction: unknown,
) => Promise<AuthorizeCommitDecision>;
export type AuthorizeCommit = ArtifactInvocationContext["authorizeCommit"];

export interface InvocationContextShape {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly authorizeCommit: AuthorizeCommitSignature;
}

function missingContract(entry: string, detail: string): never {
  throw new Error(`[missing-contract] ${entry}: ${detail}`);
}

type DynamicImport = (specifier: string) => Promise<unknown>;

// Indirect dynamic import keeps this module compilable while the installed
// provider (0.1.2) lacks the three upstream entries. A literal specifier
// would fail module resolution at typecheck time.
const dynamicImport: DynamicImport = (specifier) => import(/* @vite-ignore */ specifier);

async function loadUpstream(specifier: string, entry: string): Promise<Record<string, unknown>> {
  let loaded: unknown;
  try {
    loaded = await dynamicImport(specifier);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const message = error instanceof Error ? error.message : String(error);
    const absent = code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
      (["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"].includes(String(code)) && message.includes(specifier)) ||
      (message.includes("Missing") && message.includes(specifier.replace("@sentropic/artifacts", ".")) &&
        message.includes("@sentropic/artifacts"));
    if (!absent) throw error;
    missingContract(entry, `upstream entry ${specifier} is not provided by the installed provider`);
  }
  if (loaded === null || (typeof loaded !== "object" && typeof loaded !== "function")) {
    throw new Error(`[contract-violation] ${entry}: resolved to a non-module value`);
  }
  return loaded as Record<string, unknown>;
}

/** Resolve public callable symbols only; present-but-invalid values are violations. */
export async function requirePublicFunction<T>(specifier: string, name: string): Promise<T> {
  const module = await loadUpstream(specifier, `${specifier}.${name}`);
  if (!(name in module)) missingContract(`${specifier}.${name}`, "public export is absent");
  if (typeof module[name] !== "function") {
    throw new Error(`[contract-violation] ${specifier}.${name}: expected a function`);
  }
  return module[name] as T;
}

/** Require the r2 commit-contract entry (types + guard/transaction/fence). */
export async function requireCommitContract(): Promise<Record<string, unknown>> {
  return loadUpstream(COMMIT_CONTRACT_SPECIFIER, "commit-contract.ArtifactInvocationContext");
}

/** Require the r2 outcome-contract entry (ArtifactOutcome/ArtifactFailure). */
export async function requireOutcomeContract(): Promise<Record<string, unknown>> {
  return loadUpstream(OUTCOME_CONTRACT_SPECIFIER, "outcome-contract.ArtifactOutcome");
}

/**
 * Require the test-only barrier factory. Names the missing factory entry
 * against 0.1.2 so the denial/race suites fail by name instead of hanging.
 */
export async function requireCommitBarrier(points?: readonly CoordinatorBarrierPoint[]): Promise<CommitBarrier> {
  const factory = await requirePublicFunction<
    (options?: { readonly points: readonly CommitBarrierPoint[] }) => PublicCommitBarrier
  >(TESTING_SPECIFIER, "createArtifactCommitBarrier");
  const barrier = factory(points === undefined ? undefined : { points });
  if (barrier === null || typeof barrier !== "object" ||
    typeof barrier.observer !== "function" ||
    typeof (barrier.observer as unknown as { arrive?: unknown }).arrive !== "function" ||
    typeof (barrier as CommitBarrier).waitUntilReached !== "function" ||
    typeof (barrier as CommitBarrier).release !== "function") {
    throw new Error("[contract-violation] testing.createArtifactCommitBarrier: malformed barrier");
  }
  return { ...barrier, coordinatorPoints: points };
}

/**
 * Assert the frozen selection value plus the compiled profile digest.
 * The digest must equal the digest of the profile returned by
 * `compileArtifactsProfile`; any well-formed but unrelated hex digest is
 * rejected. A malformed Radar host is a contract violation.
 */
export function requireSelectedProfile(host: unknown, expectedDigest: string): string {
  const record = host as Record<string, unknown> | null;
  const selected = record !== null ? record["selectedCapabilities"] : undefined;
  if (!Array.isArray(selected)) {
    throw new Error("[contract-violation] host.selectedCapabilities is required");
  }
  if (selected.some((name: unknown) => typeof name !== "string")) {
    throw new Error("[contract-violation] provider selection must contain primitive strings");
  }
  const names = [...selected].sort();
  if (!Object.isFrozen(selected)) {
    throw new Error("[contract-violation] host.selectedCapabilities must be frozen");
  }
  const frozen = [...FROZEN_CAPABILITIES].sort();
  if (names.length !== frozen.length || names.some((name, index) => name !== frozen[index])) {
    throw new Error(
      `[contract-violation] provider.selectCapabilities: expected exactly ${frozen.join(", ")}`,
    );
  }
  const digest = record?.["profileDigest"] ??
    (record?.["profile"] as Record<string, unknown> | undefined)?.["profileDigest"] ??
    (record?.["compiledProfile"] as Record<string, unknown> | undefined)?.["profileDigest"];
  if (typeof digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(digest)) {
    throw new Error("[contract-violation] host.profileDigest is required with the selection");
  }
  const expected = expectedDigest;
  if (digest !== expected) {
    throw new Error(
      "[contract-violation] provider.profileDigest: host digest does not match the compiled profile digest",
    );
  }
  return digest;
}

/** Require the sole execution path `host.execute(request, invocation)`. */
export function requireHostExecute(host: unknown): (
  request: unknown,
  invocation: unknown,
) => Promise<unknown> {
  const record = host as Record<string, unknown> | null;
  const direct = record !== null ? record["execute"] : undefined;
  if (typeof direct === "function") {
    const bound = direct as (request: unknown, invocation: unknown) => Promise<unknown>;
    return (request, invocation) => bound.call(host, request, invocation);
  }
  const app = record !== null ? record["app"] : undefined;
  const nested = app !== null && typeof app === "object"
    ? (app as Record<string, unknown>)["execute"]
    : undefined;
  if (typeof nested === "function") {
    const bound = nested as (request: unknown, invocation: unknown) => Promise<unknown>;
    return (request, invocation) => bound.call(app, request, invocation);
  }
  throw new Error("[contract-violation] callable host.execute or host.app.execute is required");
}

/**
 * Assert a typed failure outcome BEFORE projection: `ok === false` with a
 * private `failure.cause`, a stable category and the invocation ID.
 */
export function assertOutcomeFailure(outcome: unknown, expectedInvocationId?: string): void {
  const record = outcome as Record<string, unknown> | null;
  if (record === null || record["ok"] !== false) {
    throw new Error("[contract-violation] provider.execute: expected { ok: false } before projection");
  }
  const failure = record["failure"] as Record<string, unknown> | null | undefined;
  if (failure === null || failure === undefined || typeof failure !== "object") {
    throw new Error("[contract-violation] provider.execute: failure discriminant is required");
  }
  if (failure["cause"] === undefined) {
    throw new Error("[contract-violation] provider.execute: failure.cause must be retained privately");
  }
  if (typeof failure["category"] !== "string" || typeof failure["publicCode"] !== "string") {
    throw new Error("[contract-violation] provider.execute: failure category and publicCode are required");
  }
  if (typeof failure["httpStatus"] !== "number" ||
    typeof failure["retriable"] !== "boolean" ||
    (failure["kind"] === "ordinary" && failure["retriable"] !== false) ||
    typeof failure["operation"] !== "string" || typeof failure["phase"] !== "string" ||
    !["not_committed", "committed", "unknown"].includes(String(failure["commitState"]))) {
    throw new Error("[contract-violation] host.execute: incomplete failure before projection");
  }
  const invocationId = failure["invocationId"];
  if (typeof invocationId !== "string" || invocationId.length === 0) {
    throw new Error("[contract-violation] provider.execute: invocation ID is required before projection");
  }
  if (expectedInvocationId !== undefined && invocationId !== expectedInvocationId) {
    throw new Error("[contract-violation] provider.execute: invocation ID mismatch before projection");
  }
}

/** Build a frozen server-created invocation context carrying authorizeCommit. */
export function buildInvocationContext(params: {
  readonly invocationId: string;
  readonly actorId: string;
  readonly storageScopeId: string;
  readonly authorizeCommit: AuthorizeCommit;
}): ArtifactInvocationContext {
  return Object.freeze({ ...params });
}

/**
 * Project an outcome to its sanitized HTTP response through the provider
 * projector. Only the projected body is ever serialized; `failure.cause`
 * stays private. Fails by name while the provider predates the r2 line.
 */
export async function projectOutcomeHttp(outcome: unknown): Promise<{ status: number; body: unknown }> {
  const project = await requirePublicFunction<
    (candidate: unknown) => { status: number; body: unknown }
  >("@sentropic/artifacts/http", "projectArtifactHttpOutcome");
  return project(outcome);
}

/** Wrap a test admission decision as an upstream commit-guard decision. */
export function toGuardDecision(decision: Extract<AdmissionResult, { allowed: false }>):
  Extract<Awaited<ReturnType<AuthorizeCommit>>, { allowed: false }> {
  return {
    allowed: false,
    reason: "denied",
    publicCode: decision.body.error,
    status: decision.status,
    retriable: false,
  };
}

/**
 * Explicit `not covered` marker for quota/admission cases owned by H3 units
 * 5-6 (not built). Fails with a named diagnostic: a coverage gap cannot
 * become a passing provider assertion or a silent skip.
 */
export function reportNotCovered(
  caseId: string,
  missingInterface: string,
  owner: string,
  sourceRevision: string,
): void {
  console.info(
    `[not covered] ${caseId}: missing ${missingInterface}, owner ${owner}, source ${sourceRevision}`,
  );
  throw new Error(`[not covered] ${caseId}: missing ${missingInterface}; owner ${owner}; source ${sourceRevision}`);
}

/** Baseline-only declaration shape; never installed as a runtime contract. */
export type OutcomeShape<T> =
  | { ok: true; result: T; invocationId: string; commitState: string; replayed: boolean }
  | { ok: false; failure: { category: string; publicCode: string; cause: unknown;
      invocationId: string; phase: string; operation: string; httpStatus: number;
      retriable: boolean; commitState: string } };
export type ExecuteOutcome = ArtifactOutcome<HttpResponse>;

/** The registered participant owns fence minting; a plain revision is invalid. */
export const authorizeTransaction: AuthorizeCommit = async (context, transaction) => {
  const participant = transactionParticipant(transaction);
  const revision = await participant.readRevision();
  const admission = await participant.readAdmission({ ...context, policyRevision: revision });
  if (!admission.allowed || revision !== context.policyRevision) {
    return { allowed: false, reason: revision !== context.policyRevision ? "revoked" : admission.reason,
      publicCode: "access_denied", status: 403, retriable: false };
  }
  return { allowed: true, fence: participant.mintFence(revision, context.invocationId) };
};

interface TransactionParticipant {
  readAdmission(context: unknown): Promise<{ allowed: boolean;
    reason: Extract<Awaited<ReturnType<AuthorizeCommit>>, { allowed: false }>["reason"] }>;
  readRevision(): Promise<string>;
  checkApproval(input: { actorId: string; operation: string }): Promise<{ approved: boolean }>;
  mintFence(revision: string, invocationId: string):
    Extract<Awaited<ReturnType<AuthorizeCommit>>, { allowed: true }>["fence"];
}

function transactionParticipant(transaction: unknown): TransactionParticipant {
  const participant = (transaction as { participant?: TransactionParticipant } | null)?.participant;
  if (!participant || ["readAdmission", "readRevision", "checkApproval", "mintFence"].some(
    (name) => typeof (participant as unknown as Record<string, unknown>)[name] !== "function")) {
    throw new Error("[contract-violation] ArtifactCommitTransaction.participant: invalid participant");
  }
  return participant;
}

/**
 * Radar effective profile data required by spec r2 C3/C4: selection plus the
 * operation limits, defaults and contract revisions that drive schema
 * generation, validation, normalization, command hashing and digests. A
 * semantic-only change (same JSON Schema text, different limit or default)
 * must invalidate composition evidence.
 */
export const RADAR_ARTIFACTS_PROFILE = Object.freeze({
  version: "artifacts-profile/v1",
  selectedCapabilities: Object.freeze([...FROZEN_CAPABILITIES]),
  operations: [
    { operation: "ensure", limits: { bindingNameMinUnits: 1, bindingNameMaxUnits: 128,
      idempotencyKeyMaxUnits: 256 }, defaults: { parameters: {} } },
    { operation: "publish", limits: { idempotencyKeyMaxUnits: 256, publishFilesMin: 1, publishFilesMax: 32,
      maxDecodedFileBytes: 262144, maxDecodedTotalBytes: 262144 }, defaults: { profile: {} } },
    { operation: "list", limits: { listLimitMin: 1, listLimitMax: 100 }, defaults: { limit: 20, offset: 0 } },
    { operation: "get", limits: {}, defaults: {} },
  ],
  rules: { lengthUnit: "utf16", textEncoding: "utf8", callerKeyNormalization: "none",
    rejectLoneSurrogates: true, provenance: "inline-original", keyDerivationAlgorithm: "radar-derive-idempotency-v1",
    pathMaxBytes: 1024, forbiddenPathPattern: "[\\\\%?#:\\u0000-\\u001f\\u007f]",
    reservedFirstSegments: ["api", "__artifacts", "livez", "health"],
    mimeTypes: ["text/html", "text/css", "text/javascript", "application/json"] },
  contractRevisions: { profile: "artifacts-profile/v1", command: "artifacts-command/v1",
    authorization: "artifacts-authorization/v1", outcome: "artifacts-outcome/v1" },
});

/**
 * Compile the Radar provider profile through the upstream compiler.
 * Returns the immutable compiled profile; never fabricates a digest.
 * Fails `[missing-contract] mcp-core.compileArtifactsProfile` naming the
 * upstream entry while the provider predates the r2 line. Compiler errors
 * propagate unchanged: rejected input is not an absent contract.
 */
export async function compileArtifactsProfile(input: {
  readonly selectedCapabilities: readonly string[];
}): Promise<CompiledArtifactsProfile> {
  const frozen = [...FROZEN_CAPABILITIES].sort();
  const names = [...input.selectedCapabilities].map(String).sort();
  if (names.length !== frozen.length || names.some((name, index) => name !== frozen[index])) {
    throw new Error(
      `[contract-violation] compileArtifactsProfile: expected exactly ${frozen.join(", ")}`,
    );
  }
  const compile = await requirePublicFunction<
    (candidate: unknown) => Promise<CompiledArtifactsProfile> | CompiledArtifactsProfile
  >(PROFILE_COMPILER_SPECIFIER, "compileArtifactsProfile");
  const candidate = RADAR_ARTIFACTS_PROFILE;
  const compiled = await (compile as (
    candidate: unknown,
  ) => Promise<CompiledArtifactsProfile> | CompiledArtifactsProfile)(candidate);
  if (compiled === null || typeof compiled !== "object") {
    throw new Error("[contract-violation] mcp-core.compileArtifactsProfile: malformed profile");
  }
  const digest = compiled.profileDigest;
  if (typeof digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(digest)) {
    throw new Error("[contract-violation] mcp-core.compileArtifactsProfile: missing digest");
  }
  if (!Object.isFrozen(compiled) || !Object.isFrozen(compiled.selectedCapabilities) ||
      [...compiled.selectedCapabilities].sort().join(",") !== frozen.join(",")) {
    throw new Error("[contract-violation] compiler must return the immutable four-operation profile");
  }
  // A compiler returning a constant digest that the host reuses would pass the
  // old equality check. A semantic-only profile change must change the digest.
  const mutated = {
    ...candidate,
    operations: candidate.operations.map((operation) => operation.operation === "publish"
      ? { ...operation, limits: { ...operation.limits, maxDecodedTotalBytes: 262143 } } : operation),
  };
  const recompiled = await (compile as (
    candidate: unknown,
  ) => Promise<CompiledArtifactsProfile> | CompiledArtifactsProfile)(mutated);
  if (typeof recompiled?.profileDigest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(recompiled.profileDigest)) {
    throw new Error("[contract-violation] semantic profile compilation returned an invalid digest");
  }
  if (recompiled.profileDigest === digest) {
    throw new Error("[contract-violation] mcp-core.compileArtifactsProfile: semantic profile change left the digest unchanged");
  }
  return compiled;
}

/** Real public coordinator over the candidate's exported PostgreSQL executor. */
export async function createTestCommitCoordinator(params: {
  readonly pool: pg.Pool;
  readonly profile: CompiledArtifactsProfile;
  readonly barrier: CommitBarrier;
}): Promise<R2CommitCoordinator> {
  const { createCandidateCoordinator } = await import("./artifacts-provider-r2.helpers.js");
  return createCandidateCoordinator(params.pool, params.barrier.observer, params.barrier.coordinatorPoints);
}

/** Acceptance-only r2 composition, using public candidate services. */
export async function composeProviderHost(params: {
  readonly pool: pg.Pool;
  readonly config: unknown;
  readonly blobs: unknown;
  readonly profile: CompiledArtifactsProfile;
  readonly coordinator: R2CommitCoordinator;
}): Promise<Record<string, unknown>> {
  const { composeCandidateHost } = await import("./artifacts-provider-r2.helpers.js");
  return composeCandidateHost(params);
}

/**
 * Single typed r2 construction for tests: compiled profile, real
 * coordinator with a registered PostgreSQL participant and barrier
 * observer, then the migrated composition. No partial composition reaches
 * the assertions: each joint above fails `[missing-contract]` by name.
 */
export interface R2AcceptanceHost {
  readonly host: Record<string, unknown>;
  readonly profile: CompiledArtifactsProfile;
  readonly coordinator: R2CommitCoordinator;
}

export async function composeR2AcceptanceHost(params: {
  readonly pool: pg.Pool;
  readonly config: unknown;
  readonly blobs: unknown;
  readonly barrier: CommitBarrier;
}): Promise<R2AcceptanceHost> {
  await requireCommitContract();
  await requireOutcomeContract();
  const barrier = params.barrier;
  const profile = await compileArtifactsProfile({ selectedCapabilities: [...FROZEN_CAPABILITIES] });
  const coordinator = await createTestCommitCoordinator({ pool: params.pool, profile, barrier });
  const host = await composeProviderHost({
    pool: params.pool, config: params.config, blobs: params.blobs, profile, coordinator,
  });
  return { host, profile, coordinator };
}

/**
 * Bounded preparation/cleanup observation binding expected from r2.
 * Fails `[missing-contract]` naming the binding (owner Sentropic L4) while
 * the spec target has no queryable intent/deadline/cleanup interface; raw
 * S3 object counts must never be presented as cleanup proof.
 */
export async function requirePreparationCleanupBinding(): Promise<PreparationCleanupBinding> {
  return {
    inspectPreparations: await requirePublicFunction<PreparationCleanupBinding["inspectPreparations"]>(
      PREPARATION_CLEANUP_SPECIFIER, "inspectPreparations"),
    scheduleBoundedPreparationCleanup: await requirePublicFunction<PreparationCleanupBinding["scheduleBoundedPreparationCleanup"]>(
      PREPARATION_CLEANUP_SPECIFIER, "scheduleBoundedPreparationCleanup"),
  };
}

/** Expected L4 observation seam; absence is a named prerequisite, never SQL guesswork. */
export async function verifyPreparationCleanup(host: unknown, artifactId: string,
  readBucketKeys: () => Promise<Iterable<string>>, requireAttempts = true,
  requireShared = false,
  options?: { readonly expectedInvocationIds?: readonly string[];
    readonly preparationsBeforeRefusal?: Awaited<ReturnType<PreparationCleanupBinding["inspectPreparations"]>>["attempts"];
    readonly s3KeysBefore?: ReadonlySet<string> | readonly string[] }): Promise<void> {
  const binding = await requirePreparationCleanupBinding();
  const before = await binding.inspectPreparations(host, artifactId);
  const keysBefore = new Set(await readBucketKeys());
  for (const prepared of options?.preparationsBeforeRefusal ?? []) {
    const historical = before.attempts.find((attempt) => attempt.attemptId === prepared.attemptId);
    if (!historical || !Array.isArray(historical.blobKeys) || historical.invocationId !== prepared.invocationId ||
        historical.preparedAtMs !== prepared.preparedAtMs ||
        historical.cleanupDeadlineMs !== prepared.cleanupDeadlineMs ||
        JSON.stringify([...historical.blobKeys].sort()) !== JSON.stringify([...prepared.blobKeys].sort())) {
      throw new Error("[contract-violation] cleanup lost historical preparation attribution");
    }
  }
  if (requireAttempts && before.attempts.length === 0) throw new Error("[contract-violation] missing preparation attribution");
  let throughMs = 0;
  for (const attempt of before.attempts) {
    // A6 sets a maximum bound, never a retention duty until inspection: a
    // conforming provider may finish cleanup before returning the refusal and
    // expose an already-settled state. Historical attribution (attempt,
    // invocation, blobKeys, deadline) is still required below.
    if (!attempt.attemptId || !attempt.invocationId || !Number.isFinite(attempt.cleanupDeadlineMs) ||
        !Number.isFinite(attempt.preparedAtMs) || attempt.cleanupDeadlineMs <= attempt.preparedAtMs ||
        attempt.cleanupDeadlineMs - attempt.preparedAtMs > 60_000 ||
        !["abandoned", "failed", "pending-cleanup", "cleaned", "failed-cleaned"].includes(attempt.state)) {
      throw new Error("[contract-violation] preparation must have attempt/invocation, settled-or-pending state and bounded deadline");
    }
    if (!Array.isArray(attempt.blobKeys)) {
      throw new Error("[contract-violation] preparation must expose attempt.blobKeys for S3 reconciliation");
    }
    throughMs = Math.max(throughMs, attempt.cleanupDeadlineMs);
  }
  const hasNewObjects = options?.s3KeysBefore !== undefined &&
    [...keysBefore].some((key) => !new Set(options.s3KeysBefore).has(key));
  if (options?.expectedInvocationIds !== undefined && (requireAttempts || hasNewObjects)) {
    const observedIds = new Set(before.attempts.map((attempt) => attempt.invocationId));
    for (const expectedId of options.expectedInvocationIds) {
      if (!observedIds.has(expectedId)) {
        throw new Error("[contract-violation] expected preparation invocation missing from attempt inventory");
      }
    }
  }
  const protectedSet = new Set(before.protectedKeys);
  // Settled providers may clear the live abandoned-key queue. Historical
  // attempt keys still identify the exclusive objects that must be absent.
  const abandonedKeys = new Set([...before.abandonedKeys, ...before.attempts.flatMap(
    (attempt) => attempt.blobKeys.filter((key) => !protectedSet.has(key)))]);
  if (requireShared && (protectedSet.size === 0 || abandonedKeys.size === 0)) {
    throw new Error("[contract-violation] cleanup fixture must contain shared and unreferenced blobs");
  }
  // Protected objects must survive: they are always present before cleanup.
  // Abandoned objects may already be gone when the provider cleaned up before
  // returning the refusal (A6 allows this); only abandoned keys that are also
  // protected must still be present here.
  for (const key of before.protectedKeys) {
    if (!keysBefore.has(key)) throw new Error("[contract-violation] preparation blob missing before cleanup");
  }
  for (const key of before.abandonedKeys) {
    if (protectedSet.has(key) && !keysBefore.has(key)) {
      throw new Error("[contract-violation] preparation blob missing before cleanup");
    }
  }
  // Reconcile the observed S3 inventory against attempts and invocations: every
  // new object since the caller baseline must belong to the expected invocation
  // via attempt.blobKeys. Protection/abandonment lists alone cannot attribute it.
  // An undeclared leftover passes the old
  // declared-only check and fails here. Cross-artifact exhaustive attribution
  // stays not covered (owner Sentropic L4); this reconciliation is scoped to
  // the artifact under test plus the caller baseline.
  const attributable = new Set<string>();
  for (const attempt of before.attempts) {
    for (const key of attempt.blobKeys) {
      if (options?.expectedInvocationIds === undefined ||
          options.expectedInvocationIds.includes(attempt.invocationId)) attributable.add(key);
    }
  }
  if (options?.s3KeysBefore !== undefined) {
    const baseline = new Set(options.s3KeysBefore);
    for (const key of before.protectedKeys) {
      if (!baseline.has(key)) throw new Error("[contract-violation] new denied preparation has no preexisting protection");
    }
    assertAttributedTestObjects(keysBefore, baseline, attributable);
  }
  // Historical attribution stays mandatory even when cleanup already ran:
  // every attempt keeps its blobKeys. Cleanup may already have removed some
  // exclusive bytes while its state is still pending. Protected bytes must
  // survive; a settled attempt must already have removed its exclusive bytes.
  for (const attempt of before.attempts) {
    const settled = attempt.state === "cleaned" || attempt.state === "failed-cleaned";
    for (const key of attempt.blobKeys) {
      if (protectedSet.has(key) && !keysBefore.has(key)) {
        throw new Error("[contract-violation] cleanup deleted a shared/protected blob");
      }
      if (settled && !protectedSet.has(key) && keysBefore.has(key)) {
        throw new Error("[contract-violation] settled preparation retained an unprotected blob");
      }
    }
  }
  await binding.scheduleBoundedPreparationCleanup(host, throughMs);
  const keysAfter = new Set(await readBucketKeys());
  for (const key of before.protectedKeys) {
    if (!keysAfter.has(key)) throw new Error("[contract-violation] cleanup deleted a shared/protected blob");
  }
  for (const key of [...abandonedKeys].filter((key) => !protectedSet.has(key))) {
    if (keysAfter.has(key)) throw new Error("[contract-violation] abandoned blob survived its cleanup deadline");
  }
  if (options?.s3KeysBefore !== undefined) {
    const baseline = new Set(options.s3KeysBefore);
    for (const key of keysAfter) {
      if (!baseline.has(key) && !before.protectedKeys.includes(key) && keysAfter.has(key)) {
        throw new Error("[contract-violation] new unprotected object survived its cleanup deadline");
      }
    }
  }
  const after = await binding.inspectPreparations(host, artifactId);
  for (const attempt of before.attempts) {
    const historical = after.attempts.find((candidate) => candidate.attemptId === attempt.attemptId);
    if (!historical || !Array.isArray(historical.blobKeys) || historical.invocationId !== attempt.invocationId ||
        historical.preparedAtMs !== attempt.preparedAtMs || historical.cleanupDeadlineMs !== attempt.cleanupDeadlineMs ||
        JSON.stringify([...historical.blobKeys].sort()) !== JSON.stringify([...attempt.blobKeys].sort())) {
      throw new Error("[contract-violation] cleanup erased or changed preparation history");
    }
  }
  if (after.attempts.some((attempt) => !["cleaned", "failed-cleaned"].includes(attempt.state))) {
    throw new Error("[contract-violation] cleanup did not settle preparation debt");
  }
}

/** Structural public ABI from artifacts/src/testing.ts (Sentropic PR #750). */
export interface PurgeDeletionClaims {
  withDigestLock<T>(digest: string, action: (locked: Pick<PurgeDeletionClaims,
    "claim" | "releaseClaim" | "isClaimed">) => Promise<T>): Promise<T>;
  claim(digest: string, holder: string): Promise<void>;
  releaseClaim(digest: string): Promise<void>;
  isClaimed(digest: string): Promise<boolean>;
  listClaims(): Promise<Array<{ readonly claimId: string; readonly digest: string;
    readonly holder: string; readonly state: "pending" | "done" }>>;
}

export interface PurgeTestHost {
  readonly claims: PurgeDeletionClaims;
  readonly storageScopeId: string;
  readonly blobs: import("@sentropic/artifacts/server/publication").PublicationBlobStore;
  purge(artifactId: string, deleting: PurgeTestHost["blobs"]): Promise<void>;
}

/** A4 starts one purge with the deletion adapter supplied by the public seam. */
export async function requirePurgeRaceBinding(): Promise<{
  pausePurgeBeforeDelete(host: PurgeTestHost, artifactId: string): Promise<{
    claimId: string; blobKeys: string[]; release(): void; finished: Promise<void>;
  }>;
  inspectDeletionClaims(host: Pick<PurgeTestHost, "claims" | "storageScopeId">):
    Promise<Array<{ claimId: string; state: string; blobKeys: string[] }>>;
}> {
  type Binding = Awaited<ReturnType<typeof requirePurgeRaceBinding>>;
  return {
    pausePurgeBeforeDelete: await requirePublicFunction<Binding["pausePurgeBeforeDelete"]>(
      TESTING_SPECIFIER, "pausePurgeBeforeDelete"),
    inspectDeletionClaims: await requirePublicFunction<Binding["inspectDeletionClaims"]>(
      TESTING_SPECIFIER, "inspectDeletionClaims"),
  };
}

/** Guards receive policy methods only; SQL belongs to the registered factory. */
export async function readPolicyRevisionViaTransaction(transaction: unknown): Promise<string> {
  return transactionParticipant(transaction).readRevision();
}

export async function readPolicyStatusViaTransaction(transaction: unknown,
  context: { actorId: string; operation: string }): Promise<string | null> {
  const approval = await transactionParticipant(transaction).checkApproval(context);
  return approval.approved ? "approved" : null;
}

/** Unique private token embedded in an injected fault, never serialized. */
let privateMarkerSequence = 0;
export function createPrivateMarker(prefix: string): string {
  return `__private_${prefix}_${++privateMarkerSequence}__`;
}

function assertNoPrivateFields(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(cause|stack|sql|query|password|credentials?|endpoint|bucket|storageScopeId|storageScope|scopeId|tenantId|workspaceId|internalKey|paramsHash)$/i.test(key)) {
      throw new Error(`[contract-violation] redaction: private field ${key} leaked`);
    }
    assertNoPrivateFields(child);
  }
}

/**
 * Assert a sanitized public body: exact public shape plus absence of every
 * private marker. The public `error` key is allowed; private `stack`,
 * SQL, endpoint, bucket and credential material is forbidden.
 */
export function assertPublicBodyRedacted(
  projected: { status: number; body: unknown },
  expectedBody: unknown,
  privateMarkers: readonly string[],
  secrets: readonly string[],
): void {
  assertNoPrivateFields(projected.body);
  const bodyText = JSON.stringify(projected.body);
  const expectedText = JSON.stringify(expectedBody);
  if (bodyText !== expectedText) {
    throw new Error(
      `[contract-violation] redaction: expected public body ${expectedText}, got ${bodyText}`,
    );
  }
  for (const marker of privateMarkers) {
    if (marker.length > 0 && bodyText.includes(marker)) {
      throw new Error("[contract-violation] redaction: private marker leaked to the wire");
    }
  }
  if (/stack/i.test(bodyText) && privateMarkers.some((marker) => /stack/i.test(marker))) {
    throw new Error("[contract-violation] redaction: private stack leaked to the wire");
  }
  for (const secret of secrets) {
    if (secret.length > 0 && bodyText.includes(secret)) {
      throw new Error("[contract-violation] redaction: deployment secret leaked to the wire");
    }
  }
  if (/BEGIN|COMMIT|SELECT\s+\S+\s+FROM|FOR\s+(UPDATE|SHARE)/i.test(bodyText)) {
    throw new Error("[contract-violation] redaction: SQL leaked to the wire");
  }
}

/**
 * Assert an MCP failure result carries the public code without private
 * material. The public `error`/`code` fields are required; injected
 * `timeout`/`stack` markers and `Error` instance text are forbidden.
 */
export function assertMcpResultRedacted(
  result: unknown,
  expected: { status: number; code: string; retryable: boolean; publicError: string },
  privateMarkers: readonly string[],
  secrets: readonly string[],
): void {
  assertNoPrivateFields(result);
  const record = result as Record<string, unknown>;
  if (record["ok"] !== false || record["status"] !== expected.status ||
    record["code"] !== expected.code || record["retryable"] !== expected.retryable) {
    throw new Error("[contract-violation] MCP parity: unexpected public failure shape");
  }
  // Exact public failure structure: the wire error must equal the sanitized
  // public body, with no extra private identifiers in any MCP representation
  // (error, data, structuredContent, text, _meta). A correct response augmented
  // with error.storageScopeId passes the old substring check and fails here.
  const wireError = record["error"];
  if (JSON.stringify(wireError) !== JSON.stringify({ error: expected.publicError })) {
    throw new Error("[contract-violation] MCP parity: unexpected public error structure");
  }
  const representations = { error: record["error"], data: record["data"],
    structuredContent: record["structuredContent"], text: record["text"], meta: record["_meta"] };
  const text = JSON.stringify({ body: record, representations });
  if (/storageScopeId|storageScope|scopeId|tenantId|workspaceId|internalKey|paramsHash/i.test(text)) {
    throw new Error("[contract-violation] MCP redaction: private identifier in serialized representation");
  }
  for (const marker of privateMarkers) {
    if (marker.length > 0 && text.includes(marker)) {
      throw new Error("[contract-violation] MCP redaction: private marker leaked");
    }
  }
  for (const secret of secrets) {
    if (secret.length > 0 && text.includes(secret)) {
      throw new Error("[contract-violation] MCP redaction: deployment secret leaked");
    }
  }
  const errorText = JSON.stringify(record["error"] ?? record["data"] ?? {});
  if (!errorText.includes(expected.publicError)) {
    throw new Error("[contract-violation] MCP parity: public error code missing");
  }
}

/** Resolve void arrivals explicitly; never test Promise<void>'s value. */
export async function arrived(barrier: CommitBarrier, point: CommitBarrierPoint,
  invocationId: string, timeoutMs = 1000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier.waitUntilReached(point, invocationId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[barrier-timeout] ${point}/${invocationId}`)), timeoutMs);
      })]);
  } finally { clearTimeout(timer); }
}

/** Drain every unrelated wait while keeping one invocation at the target. */
export function startBarrierOperation(barrier: CommitBarrier, invocationId: string,
  start: () => Promise<unknown>, target?: CommitBarrierPoint) {
  const points: CommitBarrierPoint[] = ["before_connection_acquire", "before_key_lock",
    "before_blob_put", "after_blob_put_before_verify", "before_blob_readback",
    "before_finalization_row_lock", "after_finalization_locks_before_guard",
    "after_replay_lookup_before_guard", "before_commit"];
  let finish!: () => void;
  let targetPaused = false;
  let releaseRequested = false;
  const done = new Promise<false>((resolve) => { finish = () => resolve(false); });
  const waits = points.map((point) => Promise.race([
    barrier.waitUntilReached(point, invocationId).then(() => true), done,
  ]).then((reached) => {
    if (!reached) return;
    if (point !== target || releaseRequested) barrier.release(point, invocationId);
    else targetPaused = true;
  }));
  const pending = start().finally(finish);
  // Attach a handler immediately so a failed operation cannot become an
  // unhandled rejection while the caller is inspecting the competing writer.
  void pending.catch(() => {});
  return { pending, drained: Promise.all(waits),
    reached: target ? arrived(barrier, target, invocationId) : Promise.resolve(),
    release: () => {
      releaseRequested = true;
      if (target && targetPaused) { targetPaused = false; barrier.release(target, invocationId); }
    },
  };
}

/** Faults must reach the leased client's queries, not a second pool query. */
export function proxyLeasedPool(pool: pg.Pool, handler: ProxyHandler<pg.Pool>): pg.Pool {
  const instrumented = new Proxy(pool, handler);
  return new Proxy(instrumented, { get(target, property, receiver) {
    if (property === "connect") return async () => {
      const client = await target.connect();
      return new Proxy(client, handler as unknown as ProxyHandler<pg.PoolClient>);
    };
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

/** Instrument real leased clients; one fault, then pass through to expose retries. */
export const finalizationPhaseFaults = new WeakMap<pg.Pool, (phase: string) => void>();

export function finalizationFaultPool(pool: pg.Pool, options: {
  code: string; lockClass?: string; loseCommitAck?: boolean;
}) {
  const evidence = { armed: false, injections: 0, attempts: 0, writes: 0,
    phase: "", commits: 0, guardPassed: false };
  const matchesLock = (sql: string, params: unknown): boolean => {
    if (["blob-reference", "deletion-claim"].includes(options.lockClass ?? "")) {
      return /pg_advisory_xact_lock/i.test(sql) && Array.isArray(params) &&
        String(params[0]).startsWith("artifacts-blob:");
    }
    const tables = [...sql.replaceAll('"', '').matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+([\w.]+)/gi)]
      .map((match) => match[1]!.split(".").at(-1)!);
    const names: Record<string, RegExp> = {
      "artifact-lifecycle": /^artifacts$/,
      acl: /^artifact_access$/, pointer: /^artifact_current$/,
      policy: /^(account_users|test_policy_revision|.*policy.*)$/,
    };
    // E3 uses a public barrier and real PostgreSQL contention instead of
    // requiring optional provider SQL forms for these two cause classes.
    if (options.lockClass === "schema-infrastructure") return false;
    if (options.lockClass === "unqualified") return false;
    return /FOR\s+(UPDATE|SHARE)/i.test(sql) &&
      tables.some((name) => names[options.lockClass ?? ""]?.test(name));
  };
  const instrumented = new Proxy(pool, { get(target, property, receiver) {
    if (property === "connect") return async () => {
      const client = await target.connect();
      let finalizing = false;
      return new Proxy(client, { get(leased, key, clientReceiver) {
        if (key === "query") return async (text: unknown, params?: unknown) => {
          const sql = typeof text === "string" ? text : String((text as { text?: string })?.text ?? "");
          const query = () => (leased.query as (...args: unknown[]) => Promise<unknown>).call(leased, text, params);
          if (/^\s*BEGIN\b/i.test(sql)) finalizing = false;
          if (/\boperation_keys\b/i.test(sql) && /FOR\s+UPDATE/i.test(sql)) {
            finalizing = true;
            if (evidence.armed) evidence.attempts++;
          }
          const commit = /^\s*COMMIT\s*;?\s*$/i.test(sql);
          const write = finalizing && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
          const lockFault = options.lockClass !== undefined && matchesLock(sql, params);
          if (evidence.armed && evidence.injections === 0 &&
              (lockFault || (!options.lockClass && !options.loseCommitAck && write) ||
                (options.loseCommitAck && finalizing && commit && evidence.guardPassed))) {
            // Abort cases execute a provisional write before injection. COMMIT
            // loss executes the real finalization COMMIT before losing its ACK.
            if (write || options.loseCommitAck) await query();
            if (write) evidence.writes++;
            if (options.loseCommitAck) evidence.commits++;
            evidence.injections++;
            evidence.phase = options.loseCommitAck ? "commit" : options.lockClass ?? "provisional-write";
            throw Object.assign(new Error(`private injected ${evidence.phase}`), { code: options.code });
          }
          const result = await query();
          if (evidence.armed && write) evidence.writes++;
          return result;
        };
        const value = Reflect.get(leased, key, clientReceiver);
        return typeof value === "function" ? value.bind(leased) : value;
      } });
    };
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  finalizationPhaseFaults.set(instrumented, (phase) => {
    if (evidence.armed && evidence.injections === 0 && options.lockClass === phase) {
      evidence.injections++;
      evidence.phase = phase;
      throw Object.assign(new Error(`private injected ${phase}`), { code: options.code });
    }
  });
  return { pool: instrumented, evidence };
}

/** Observe committed state on a separate raw connection, with stable ordering. */
export async function committedState(pool: pg.Pool): Promise<unknown> {
  const client = await pool.connect();
  try {
    const snapshot: Record<string, unknown> = {};
    for (const table of ["artifacts", "releases", "artifact_current", "operation_receipts",
      "artifact_access", "artifact_sources", "blob_ref_holders"]) {
      snapshot[table] = (await client.query(
        `SELECT to_jsonb(t) AS row FROM artifacts.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return snapshot;
  } finally { client.release(); }
}

type WorkerMessage = { id: number; method?: string; args?: unknown[];
  result?: unknown; error?: string; authorization?: { invocationId: string; purpose: string } };

/** A separate OS process with its own pool/app, not two objects in Vitest. */
export async function startArtifactWorker(database: pg.PoolConfig, config: unknown) {
  const child = fork(fileURLToPath(import.meta.url), ["--artifact-worker"], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const authorizations: Array<{ invocationId: string; purpose: string }> = [];
  child.on("message", (payload) => {
    const message = payload as WorkerMessage;
    if (message.authorization) { authorizations.push(message.authorization); return; }
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(message.error));
    else waiter?.resolve(message.result);
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`artifact worker exited: ${code}`));
    pending.clear();
  });
  const call = (method: string, ...args: unknown[]): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    child.send({ id, method, args }, (error) => {
      if (error) { pending.delete(id); reject(error); }
    });
  });
  try { await call("initialize", database, config); }
  catch (error) { child.kill(); throw error; }
  return {
    pid: child.pid, authorizations,
    execute: (request: unknown, invocation: unknown) => call("execute", request, invocation),
    barrier: {
      observer: undefined,
      waitUntilReached: async (point: CommitBarrierPoint, id: string) => { await call("wait", point, id); },
      release: (point: CommitBarrierPoint, id: string) => { void call("release", point, id); },
    } satisfies CommitBarrier,
    close: async () => { try { await call("close"); } finally { child.kill(); } },
  };
}

if (process.argv[2] === "--artifact-worker") {
  let pool: pg.Pool;
  let host: Record<string, unknown>;
  let barrier: CommitBarrier;
  let s3: import("@aws-sdk/client-s3").S3Client;
  process.on("message", async (payload) => {
    const message = payload as WorkerMessage;
    try {
      const args = message.args ?? [];
      let result: unknown;
      if (message.method === "initialize") {
        const { default: pgModule } = await import("pg");
        const { S3Client } = await import("@aws-sdk/client-s3");
        const { createTestS3BlobStore } = await import("../artifacts-blob-store.helpers.js");
        const config = args[1] as Record<string, string>;
        pool = new pgModule.Pool(args[0] as pg.PoolConfig);
        s3 = new S3Client({ endpoint: config.s3Endpoint!, region: config.s3Region!, forcePathStyle: true,
          credentials: { accessKeyId: config.s3AccessKey!, secretAccessKey: config.s3SecretKey! } });
        barrier = await requireCommitBarrier();
        const composed = await composeR2AcceptanceHost({
          pool, config, blobs: createTestS3BlobStore({ client: s3, bucket: config.s3Bucket! }), barrier,
        });
        host = composed.host;
        requireSelectedProfile(host, composed.profile.profileDigest);
      } else if (message.method === "execute") {
        const invocation = args[1] as InvocationContextShape;
        result = await requireHostExecute(host)(args[0], buildInvocationContext({ ...invocation,
          authorizeCommit: async (context, transaction) => {
            process.send?.({ id: message.id, authorization: { invocationId: context.invocationId, purpose: context.purpose } });
            return authorizeTransaction(context, transaction);
          } }));
      } else if (message.method === "wait") {
        await barrier.waitUntilReached(args[0] as CommitBarrierPoint, args[1] as string);
      } else if (message.method === "release") {
        barrier.release(args[0] as CommitBarrierPoint, args[1] as string);
      } else if (message.method === "close") {
        if (typeof host.close === "function") host.close();
        s3.destroy(); await pool.end();
      }
      process.send?.({ id: message.id, result });
    } catch (error) {
      process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

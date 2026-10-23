import type { AdmissionResult } from "@radar/artifacts-host";
import type { ArtifactInvocationContext } from "@sentropic/artifacts/server/commit-contract";
import type { ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { HttpResponse } from "@sentropic/artifacts/http";
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
export const COORDINATOR_FACTORY_SPECIFIER = "@sentropic/artifacts/server/commit";
export const PREPARATION_CLEANUP_SPECIFIER = "@sentropic/artifacts/server/object-intents";
export const EXPECTED_COORDINATOR_CTOR = "createArtifactCommitCoordinator";
export const EXPECTED_CLEANUP_BINDING =
  "scheduleBoundedPreparationCleanup with attempt intent, cleanup-deadline and shared-blob observation";

/** Frozen r2 selection for the Radar profile, deterministically ordered. */
export const FROZEN_CAPABILITIES = [
  "artifacts_ensure",
  "artifacts_get",
  "artifacts_list",
  "artifacts_publish",
] as const;

/** Compiled r2 profile returned by the upstream compiler, never fabricated. */
export interface CompiledArtifactsProfile {
  readonly digest: string;
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
  waitUntilReached(point: CommitBarrierPoint, invocationId?: string): Promise<void>;
  release(point: CommitBarrierPoint, invocationId?: string): void;
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
    missingContract(entry, `upstream entry ${specifier} resolved to a non-module value`);
  }
  return loaded as Record<string, unknown>;
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
export async function requireCommitBarrier(): Promise<CommitBarrier> {
  const testing = await loadUpstream(TESTING_SPECIFIER, "testing.createArtifactCommitBarrier");
  const factory = testing["createArtifactCommitBarrier"];
  if (typeof factory !== "function") {
    missingContract(
      "testing.createArtifactCommitBarrier",
      "factory createArtifactCommitBarrier is not exported by the installed provider",
    );
  }
  const barrier = (factory as () => CommitBarrier)();
  if (barrier === null || typeof barrier !== "object" ||
    typeof (barrier as CommitBarrier).waitUntilReached !== "function" ||
    typeof (barrier as CommitBarrier).release !== "function") {
    throw new Error("[contract-violation] testing.createArtifactCommitBarrier: malformed barrier");
  }
  return barrier;
}

/**
 * Assert the frozen selection value plus the compiled profile digest.
 * The digest must equal the digest of the profile returned by
 * `compileArtifactsProfile`; any well-formed but unrelated hex digest is
 * rejected. Throws `[missing-contract] provider.selectCapabilities` (or
 * `provider.profileDigest`) while the provider predates the r2 line.
 */
export function requireSelectedProfile(host: unknown, expectedDigest: string): string {
  const record = host as Record<string, unknown> | null;
  const selected = record !== null ? record["selectedCapabilities"] : undefined;
  if (!Array.isArray(selected)) {
    missingContract(
      "provider.selectCapabilities",
      "explicit selectedCapabilities is required before compilation",
    );
  }
  const names = [...(selected as unknown[])].map(String).sort();
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
    (record?.["profile"] as Record<string, unknown> | undefined)?.["digest"] ??
    (record?.["compiledProfile"] as Record<string, unknown> | undefined)?.["digest"];
  if (typeof digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(digest)) {
    missingContract("provider.profileDigest", "compiled profile digest is required with the selection");
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
  missingContract(
    "provider.execute",
    "callable host.execute(request, invocation) (or host.app.execute) is required",
  );
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
  if (typeof failure["category"] !== "string" || typeof failure["code"] !== "string") {
    throw new Error("[contract-violation] provider.execute: failure category and code are required");
  }
  if (typeof failure["status"] !== "number" || typeof failure["retriable"] !== "boolean" ||
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
  const http = await loadUpstream(
    "@sentropic/artifacts/http", "http.projectArtifactHttpOutcome");
  const project = http["projectArtifactHttpOutcome"];
  if (typeof project !== "function") {
    missingContract(
      "http.projectArtifactHttpOutcome",
      "projectArtifactHttpOutcome is not exported by the installed provider",
    );
  }
  return (project as (candidate: unknown) => { status: number; body: unknown })(outcome);
}

/** Wrap a test admission decision as an upstream commit-guard decision. */
export function toGuardDecision(decision: AdmissionResult): AuthorizeCommitDecision {
  if (decision.allowed) {
    missingContract("ArtifactCommitTransaction.policyParticipant", "an allowed decision requires a transaction-minted fence; use authorizeTransaction");
  }
  return {
    allowed: false,
    reason: "unauthorized_at_commit",
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
  | { ok: false; failure: { category: string; code: string; cause: unknown;
      invocationId: string; phase: string; operation: string; status: number;
      retriable: boolean; commitState: string } };
export type ExecuteOutcome = ArtifactOutcome<HttpResponse>;

/** The registered participant owns fence minting; a plain revision is invalid. */
export const authorizeTransaction: AuthorizeCommit = async (context, transaction) => {
  const participant = (transaction as { policyParticipant?: unknown }).policyParticipant;
  if (!participant || typeof participant !== "object" ||
      !("authorize" in participant) || typeof participant.authorize !== "function") {
    missingContract("ArtifactCommitTransaction.policyParticipant", "transaction-bound test participant binding is required (r2 does not freeze its construction API)");
  }
  return participant.authorize(context, transaction);
};

/**
 * Compile the Radar provider profile through the upstream compiler.
 * Returns the immutable compiled profile; never fabricates a digest.
 * Fails `[missing-contract] mcp-core.compileArtifactsProfile` naming the
 * upstream entry while the provider predates the r2 line.
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
  const module = await loadUpstream(
    PROFILE_COMPILER_SPECIFIER, "mcp-core.compileArtifactsProfile");
  const compile = module["compileArtifactsProfile"];
  if (typeof compile !== "function") {
    missingContract(
      "mcp-core.compileArtifactsProfile",
      `upstream entry ${PROFILE_COMPILER_SPECIFIER} must export compileArtifactsProfile(input: ArtifactProviderProfile): CompiledArtifactsProfile (Sentropic spec r2 section 3.2)`,
    );
  }
  const compiled = await (compile as (
    candidate: unknown,
  ) => Promise<CompiledArtifactsProfile> | CompiledArtifactsProfile)({
    selectedCapabilities: [...FROZEN_CAPABILITIES],
  });
  if (compiled === null || typeof compiled !== "object") {
    throw new Error("[contract-violation] mcp-core.compileArtifactsProfile: malformed profile");
  }
  const digest = (compiled as CompiledArtifactsProfile).digest;
  if (typeof digest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(digest)) {
    throw new Error("[contract-violation] mcp-core.compileArtifactsProfile: missing digest");
  }
  if (!Object.isFrozen(compiled) || !Object.isFrozen(compiled.selectedCapabilities) ||
      [...compiled.selectedCapabilities].sort().join(",") !== frozen.join(",")) {
    throw new Error("[contract-violation] compiler must return the immutable four-operation profile");
  }
  return compiled;
}

/**
 * Named joint (a): expected public coordinator constructor from Sentropic.
 * Builds the real transaction-bound coordinator carrying the PostgreSQL
 * participant and the barrier `testObserver`. Fails `[missing-contract]`
 * naming `createArtifactCommitCoordinator` while Sentropic has not shipped
 * the public constructor; the spec r2 freezes the coordinator obligations
 * but not this factory name, so the name below is the expected joint.
 */
export async function createTestCommitCoordinator(params: {
  readonly pool: pg.Pool;
  readonly profile: CompiledArtifactsProfile;
  readonly barrier: CommitBarrier;
}): Promise<R2CommitCoordinator> {
  void params;
  // r2 freezes the protocol, but not the public participant registration API.
  // Do not guess a factory signature or accept a coordinator with no participant.
  missingContract(
    "coordinator.createArtifactCommitCoordinator",
    "Sentropic L0/L3 must supply the public coordinator constructor and registered PostgreSQL policy participant API; spec r2 does not freeze this construction binding",
  );
}

/**
 * Named joint (b): Radar H3/H4 migration of `composeArtifactHost`.
 * Calls the new r2 signature `composeArtifactHost(pool, config, blobs,
 * {profile, coordinator})` and refuses any partial composition. Fails
 * `[missing-contract]` naming this migration (owner Radar) while the
 * installed composition still interprets the fourth argument as the legacy
 * `onProviderFailure` callback.
 */
export async function composeProviderHost(params: {
  readonly pool: pg.Pool;
  readonly config: unknown;
  readonly blobs: unknown;
  readonly profile: CompiledArtifactsProfile;
  readonly coordinator: R2CommitCoordinator;
}): Promise<Record<string, unknown>> {
  void params;
  // The current Radar signature takes onProviderFailure in argument four.
  // Calling it with an options bag would create a partially wired legacy host.
  missingContract(
    "Radar.composeArtifactHost.r2",
    "Radar H3/H4 must migrate composeArtifactHost(pool, config, blobs, {profile, coordinator}) and export ArtifactHost/ArtifactHostOptions before candidate qualification",
  );
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
  const module = await loadUpstream(
    PREPARATION_CLEANUP_SPECIFIER, "preparation-cleanup.scheduleBoundedPreparationCleanup");
  if (typeof module["scheduleBoundedPreparationCleanup"] !== "function" ||
      typeof module["inspectPreparations"] !== "function") {
    missingContract(
      "preparation-cleanup.scheduleBoundedPreparationCleanup",
      `expected binding ${EXPECTED_CLEANUP_BINDING} from ${PREPARATION_CLEANUP_SPECIFIER} (owner Sentropic L4; spec r2 A6); raw S3 counts are not cleanup evidence`,
    );
  }
  return {
    inspectPreparations: module["inspectPreparations"] as PreparationCleanupBinding["inspectPreparations"],
    scheduleBoundedPreparationCleanup: module["scheduleBoundedPreparationCleanup"] as PreparationCleanupBinding["scheduleBoundedPreparationCleanup"],
  };
}

/** Expected L4 observation seam; absence is a named prerequisite, never SQL guesswork. */
export async function verifyPreparationCleanup(host: unknown, artifactId: string,
  blobs: { listKeys(prefix: string): Promise<Iterable<string>> }, requireAttempts = true,
  requireShared = false): Promise<void> {
  const binding = await requirePreparationCleanupBinding();
  const before = await binding.inspectPreparations(host, artifactId);
  if (requireAttempts && before.attempts.length === 0) throw new Error("[contract-violation] missing preparation attribution");
  let throughMs = 0;
  for (const attempt of before.attempts) {
    if (!attempt.attemptId || !attempt.invocationId || !Number.isFinite(attempt.cleanupDeadlineMs) ||
        !Number.isFinite(attempt.preparedAtMs) || attempt.cleanupDeadlineMs <= attempt.preparedAtMs ||
        attempt.cleanupDeadlineMs - attempt.preparedAtMs > 60_000 ||
        !["abandoned", "failed", "pending-cleanup"].includes(attempt.state)) {
      throw new Error("[contract-violation] preparation must have attempt/invocation, failure state and bounded deadline");
    }
    throughMs = Math.max(throughMs, attempt.cleanupDeadlineMs);
  }
  if (requireShared && (before.protectedKeys.length === 0 || before.abandonedKeys.length === 0)) {
    throw new Error("[contract-violation] cleanup fixture must contain shared and unreferenced blobs");
  }
  const keysBefore = new Set(await blobs.listKeys(""));
  for (const key of [...before.protectedKeys, ...before.abandonedKeys]) {
    if (!keysBefore.has(key)) throw new Error("[contract-violation] preparation blob missing before cleanup");
  }
  await binding.scheduleBoundedPreparationCleanup(host, throughMs);
  const keysAfter = new Set(await blobs.listKeys(""));
  for (const key of before.protectedKeys) {
    if (!keysAfter.has(key)) throw new Error("[contract-violation] cleanup deleted a shared/protected blob");
  }
  for (const key of before.abandonedKeys.filter((key) => !before.protectedKeys.includes(key))) {
    if (keysAfter.has(key)) throw new Error("[contract-violation] abandoned blob survived its cleanup deadline");
  }
  const after = await binding.inspectPreparations(host, artifactId);
  if (after.attempts.some((attempt) => !["cleaned", "failed-cleaned"].includes(attempt.state))) {
    throw new Error("[contract-violation] cleanup did not settle preparation debt");
  }
}

/** Provisional test seam for the A4 purge claim held across external DELETE. */
export async function requirePurgeRaceBinding(): Promise<{
  pausePurgeBeforeDelete(host: unknown, artifactId: string): Promise<{
    claimId: string; blobKeys: string[]; release(): void; finished: Promise<void>;
  }>;
  inspectDeletionClaims(host: unknown): Promise<Array<{ claimId: string; state: string; blobKeys: string[] }>>;
}> {
  const module = await loadUpstream(TESTING_SPECIFIER, "testing.pausePurgeBeforeDelete");
  if (typeof module["pausePurgeBeforeDelete"] !== "function" || typeof module["inspectDeletionClaims"] !== "function") {
    missingContract("testing.pausePurgeBeforeDelete",
      "Sentropic L4 must expose a correlated purge pause and durable deletion-claim inspection before external DELETE (spec r2 A4/A6)");
  }
  return {
    pausePurgeBeforeDelete: module["pausePurgeBeforeDelete"] as Awaited<ReturnType<typeof requirePurgeRaceBinding>>["pausePurgeBeforeDelete"],
    inspectDeletionClaims: module["inspectDeletionClaims"] as Awaited<ReturnType<typeof requirePurgeRaceBinding>>["inspectDeletionClaims"],
  };
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

/** Observe committed state on a separate raw connection, with stable ordering. */
export async function committedState(pool: pg.Pool): Promise<unknown> {
  const client = await pool.connect();
  try {
    const snapshot: Record<string, unknown> = {};
    for (const table of ["artifacts", "releases", "artifact_current", "idempotency_keys",
      "artifact_access", "artifact_sources", "blobs", "blob_ref_holders", "blob_pins"]) {
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
      waitUntilReached: async (point: CommitBarrierPoint, id?: string) => { await call("wait", point, id); },
      release: (point: CommitBarrierPoint, id?: string) => { void call("release", point, id); },
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
        await requireCommitContract();
        const { default: pgModule } = await import("pg");
        const { S3Client } = await import("@aws-sdk/client-s3");
        const { createS3BlobStore } = await import("@sentropic/artifacts/adapters/s3");
        const { composeArtifactHost } = await import("@radar/artifacts-host");
        const config = args[1] as Record<string, string>;
        pool = new pgModule.Pool(args[0] as pg.PoolConfig);
        s3 = new S3Client({ endpoint: config.s3Endpoint!, region: config.s3Region!, forcePathStyle: true,
          credentials: { accessKeyId: config.s3AccessKey!, secretAccessKey: config.s3SecretKey! } });
        barrier = await requireCommitBarrier();
        const compose = composeArtifactHost as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>;
        host = await compose(pool, config, createS3BlobStore({ client: s3, bucket: config.s3Bucket! }),
          { profile: { selectedCapabilities: [...FROZEN_CAPABILITIES] }, coordinator: { testObserver: barrier.observer } });
        requireSelectedProfile(host);
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

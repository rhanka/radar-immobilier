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

/** Frozen r2 selection for the Radar profile, deterministically ordered. */
export const FROZEN_CAPABILITIES = [
  "artifacts_ensure",
  "artifacts_get",
  "artifacts_list",
  "artifacts_publish",
] as const;

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
 * Throws `[missing-contract] provider.selectCapabilities` (or
 * `provider.profileDigest`) while the provider predates the r2 line.
 */
export function requireSelectedProfile(host: unknown): string {
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
  return digest;
}

/** Require the sole execution path `host.execute(request, invocation)`. */
export function requireHostExecute(host: unknown): (
  request: unknown,
  invocation: unknown,
) => Promise<unknown> {
  const record = host as Record<string, unknown> | null;
  const direct = record !== null ? record["execute"] : undefined;
  const requestWithActor = (request: unknown, invocation: unknown) => ({
    ...(request as object), actorId: (invocation as InvocationContextShape).actorId,
  });
  if (typeof direct === "function") return (request, invocation) => direct.call(host, requestWithActor(request, invocation), invocation);
  const app = record !== null ? record["app"] : undefined;
  const nested = app !== null && typeof app === "object"
    ? (app as Record<string, unknown>)["execute"]
    : undefined;
  if (typeof nested === "function") {
    const bound = nested as (request: unknown, invocation: unknown) => Promise<unknown>;
    return (request, invocation) => bound.call(app, requestWithActor(request, invocation), invocation);
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

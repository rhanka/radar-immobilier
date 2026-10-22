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

export function requireSelectedProfile(host: unknown): void {
  const selected = member(host, "selectedCapabilities");
  if (selected === undefined || selected === null) {
    throw new Error("[missing-contract] provider.selectCapabilities: explicit selectedCapabilities required before compilation");
  }
  if (!Array.isArray(selected) || selected.length !== 4 ||
    ["ensure", "publish", "meta", "list"].some((op) => !selected.includes(op))) {
    throw new Error("[contract-violation] provider.selectCapabilities: expected exactly ensure, publish, meta, list");
  }
}

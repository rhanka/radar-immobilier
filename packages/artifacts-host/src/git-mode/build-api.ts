import { randomUUID } from "node:crypto";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { resolveBuilderBinding, type BuilderBindingSource } from "./builder-binding.js";
import type { HostServiceIdentity } from "./lease-broker.js";
import type { GitBuildExecutor, GitBuildJobRequest, GitBuildJobState, GitBuildPort } from "./provider-adapter.js";

/**
 * Host build API client (M3-I, W7 contract with the Sentropic builder).
 *
 * - no live reconcile before a build: the builder admits a static binding
 *   from the admitted host job itself (`admittedBinding`, sentropic #995). A
 *   pre-build `POST v1/live/reconcile` used to wake a REVIVING live session,
 *   and the build then refused itself with `pending_publication` (cause A7).
 *   While a live session is LIVE or REVIVING the builder refuses the build
 *   with `409 live_session_active`: the host logs `artifacts.build_refused`,
 *   closes the job (`build_failed`, host-only code `host_refused_live_session`)
 *   and always answers the package live conflict
 *   (`git_live_conflict`, reason `active_session`: stop the session first);
 *   the live re-drive (live-redrive.ts) is the only reconcile caller;
 * - immo persists the job first (G0 v3 §2.6: the job identity, never a
 *   caller SHA later) and gets its jobId from the host job store;
 * - then `POST <base>/v1/builds` with exactly `{ artifactId, jobId, binding }`
 *   (≤ 2 KiB), where `binding = { repoId, branch, subPath }` is read from the package
 *   git binding of that artifact AND that job generation (builder-binding.ts, never
 *   caller input; no such binding: git_not_attached before any call), answered 202 (accepted) or 200 (release already published)
 *   with `{ jobId, state, code?, reason?, releaseId? }`;
 * - progress: `GET <base>/v1/builds/<artifactId>/<jobId>`;
 * - the builder then pulls the job from immo (`POST <host base>/live-host/v1/job`)
 *   and hands the candidate over (`POST <host base>/live-host/v1/handoff`, live-host-endpoints.ts).
 *
 * Base (preprod): https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder.
 * Authentication: OAuth client_credentials service token, scope `artifacts:builder`.
 * Only `sandbox` is admitted, and only when the builder base is configured.
 */
export interface HostBuildJobStore {
  /**
   * Persists the job (idempotent on requestedBy + idempotencyKey) and returns its id. A job the builder refused
   * at request time (code `HOST_LIVE_SESSION_REFUSAL.code`) never reached a build: a retry with the same key re-arms it.
   */
  persist(job: GitBuildJobRequest): Promise<string>;
  /** Marks a job the builder refused at request time terminal (`build_failed`, code and reason), never left pending. */
  refuse(jobId: string, refusal: { readonly code: string; readonly reason: string }): Promise<void>;
}

/** Builder refusal code of a build while a live session of the artifact is LIVE or REVIVING (no build started). */
export const BUILDER_LIVE_SESSION_ACTIVE = "live_session_active";
/**
 * Host-only job code of that refusal: never emitted by the builder (whose failure codes `markFailed` may also write),
 * so only a job the host closed itself at request time is re-armed on retry.
 */
export const HOST_LIVE_SESSION_REFUSAL = Object.freeze({ code: "host_refused_live_session", reason: "active_session" });

/** TODO(M3-I durable ledger): Postgres job table shared with the SG4b ledger. Until then git_publish refuses. */
export const FAIL_CLOSED_JOB_STORE: HostBuildJobStore = Object.freeze({
  async persist(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
  async refuse(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
});

export function createMemoryJobStore(): HostBuildJobStore & { jobs: Map<string, GitBuildJobRequest>;
  states: Map<string, { state: GitBuildJobState; code?: string; reason?: string }> } {
  const jobs = new Map<string, GitBuildJobRequest>();
  const states = new Map<string, { state: GitBuildJobState; code?: string; reason?: string }>();
  const keys = new Map<string, string>();
  return { jobs, states, async persist(job) {
    const key = JSON.stringify([job.storageScopeId, job.requestedBy, job.idempotencyKey]);
    const existing = keys.get(key);
    if (existing) {
      if (states.get(existing)?.code === HOST_LIVE_SESSION_REFUSAL.code) states.set(existing, { state: "build_pending" });
      return existing;
    }
    const jobId = randomUUID();
    keys.set(key, jobId);
    jobs.set(jobId, structuredClone(job));
    states.set(jobId, { state: "build_pending" });
    return jobId;
  }, async refuse(jobId, refusal) {
    if (states.get(jobId)?.state === "build_pending") states.set(jobId, { state: "build_failed", ...refusal });
  } };
}

/** `409 { error: "live_session_active" }`, or the builder LiveError form `{ error: "git_live_conflict", reason: "active_session" }`. */
function isLiveSessionActive(status: number, body: unknown): boolean {
  const record = body as Record<string, unknown> | null;
  return status === 409 && !!record && typeof record === "object" && (record.error === BUILDER_LIVE_SESSION_ACTIVE ||
    (record.error === "git_live_conflict" && record.reason === HOST_LIVE_SESSION_REFUSAL.reason));
}

export interface HostBuildApiOptions {
  /** Builder base URL, https, e.g. https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder. */
  readonly baseUrl?: string | undefined;
  readonly identity?: HostServiceIdentity | undefined;
  readonly jobs?: HostBuildJobStore;
  /** Package git binding store: source of the `binding` coordinates sent to the builder. */
  readonly bindings?: BuilderBindingSource | undefined;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Structured log line sink (default stderr). */
  readonly log?: (line: string) => void;
}

/**
 * The package live conflict (`git_live_conflict`, reason `active_session`, 409, not retriable) with the next step
 * for the caller: retrying the publish cannot succeed while the session runs.
 */
function liveSessionActive(): ArtifactOperationError {
  return new ArtifactOperationError("git_live_conflict", { publicDetails: { reason: HOST_LIVE_SESSION_REFUSAL.reason,
    message: "A live session of this artifact is active: stop it (artifacts_live_control action stop) before publishing." } });
}

export interface HostBuildStatus {
  readonly jobId: string; readonly state: GitBuildJobState; readonly code?: string; readonly reason?: string;
  readonly releaseId?: string;
}

const STATES: readonly GitBuildJobState[] = ["build_pending", "building", "published", "build_failed", "cancelled"];

function parseStatus(body: unknown, jobId: string): HostBuildStatus {
  const record = body as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || record.jobId !== jobId || !STATES.includes(record.state as GitBuildJobState) ||
    (record.code !== undefined && typeof record.code !== "string") || (record.reason !== undefined && typeof record.reason !== "string") ||
    (record.releaseId !== undefined && typeof record.releaseId !== "string")) {
    throw new ArtifactOperationError("provider_unavailable");
  }
  return { jobId, state: record.state as GitBuildJobState,
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(typeof record.releaseId === "string" ? { releaseId: record.releaseId } : {}) };
}

export function builderBaseUrl(raw: string): URL {
  const base = new URL(raw);
  if (base.protocol !== "https:" || base.search || base.hash) throw new Error("artifact_git_builder_url_invalid");
  return new URL(base.pathname.endsWith("/") ? base.href : `${base.href}/`);
}

export function createHostBuildApiClient(options: HostBuildApiOptions): GitBuildPort & {
  /** Builder status; undefined when the builder does not know the job (404). Transport failures throw. */
  status(artifactId: string, jobId: string): Promise<HostBuildStatus | undefined>;
} {
  const base = options.baseUrl !== undefined && options.identity !== undefined ? builderBaseUrl(options.baseUrl) : undefined;
  const jobs = options.jobs ?? FAIL_CLOSED_JOB_STORE;
  const fetcher = options.fetch ?? fetch;
  const call = async (url: URL, init: RequestInit, accepted: readonly number[], jobId: string,
    notFound = false): Promise<HostBuildStatus | undefined> => {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: { ...init.headers as Record<string, string>, authorization: await options.identity!.authorization() } });
    } catch (error) {
      if (error instanceof ArtifactOperationError) throw error;
      throw new ArtifactOperationError("provider_unavailable");
    }
    if (notFound && response.status === 404) return undefined;
    let body: unknown;
    try { body = await response.json(); } catch { throw new ArtifactOperationError("provider_unavailable"); }
    if (isLiveSessionActive(response.status, body)) throw liveSessionActive();
    if (!accepted.includes(response.status)) throw new ArtifactOperationError("provider_unavailable");
    return parseStatus(body, jobId);
  };
  const log = options.log ?? ((line: string) => console.error(line));
  return {
    async admits(executor: GitBuildExecutor) { return base !== undefined && executor === "sandbox"; },
    async request(job: GitBuildJobRequest) {
      if (!base || job.executor !== "sandbox") throw new ArtifactOperationError("provider_unavailable");
      const binding = await resolveBuilderBinding(options.bindings, { storageScopeId: job.storageScopeId, artifactId: job.artifactId,
        bindingGeneration: job.bindingGeneration });
      // Persisted first: the builder pulls the job by id once it accepted it (live-host /v1/job).
      const jobId = await jobs.persist(job);
      let status: HostBuildStatus | undefined;
      try {
        status = await call(new URL("v1/builds", base), { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ artifactId: job.artifactId, jobId, binding }) }, [200, 202], jobId);
      } catch (error) {
        if (error instanceof ArtifactOperationError && error.kind === "git_live_conflict") {
          // No build started: log the refusal, close the job (never left build_pending), and always answer the
          // conflict, even when closing the job fails (that failure is logged, never thrown in its place).
          const ids = { storageScopeId: job.storageScopeId, artifactId: job.artifactId, jobId, bindingGeneration: job.bindingGeneration };
          log(JSON.stringify({ kind: "artifacts.build_refused", code: BUILDER_LIVE_SESSION_ACTIVE,
            reason: HOST_LIVE_SESSION_REFUSAL.reason, ...ids }));
          try { await jobs.refuse(jobId, HOST_LIVE_SESSION_REFUSAL); } catch {
            log(JSON.stringify({ kind: "artifacts.build_refuse_unavailable", ...ids }));
          }
        }
        throw error;
      }
      if (!status) throw new ArtifactOperationError("provider_unavailable");
      return { jobId: status.jobId, state: status.state };
    },
    async status(artifactId: string, jobId: string) {
      if (!base) throw new ArtifactOperationError("provider_unavailable");
      return call(new URL(`v1/builds/${encodeURIComponent(artifactId)}/${encodeURIComponent(jobId)}`, base), { method: "GET" },
        [200], jobId, true);
    },
  };
}

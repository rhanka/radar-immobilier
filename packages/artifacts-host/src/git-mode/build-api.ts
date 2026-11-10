import { randomUUID } from "node:crypto";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { resolveBuilderBinding, type BuilderBindingSource } from "./builder-binding.js";
import type { HostServiceIdentity } from "./lease-broker.js";
import type { GitBuildExecutor, GitBuildJobRequest, GitBuildJobState, GitBuildPort } from "./provider-adapter.js";

/**
 * Host build API client (M3-I, W7 contract with the Sentropic builder).
 *
 * - first `POST <base>/v1/live/reconcile` with `{ artifactId, binding, generation }`
 *   (the live-open endpoint, reused): a binding the builder has never
 *   reconciled is refused at build admission (`git_live_conflict:stale_session`),
 *   and P1 only built because it had been opened live first;
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
  /** Persists the job (idempotent on requestedBy + idempotencyKey) and returns its id. */
  persist(job: GitBuildJobRequest): Promise<string>;
}

/** TODO(M3-I durable ledger): Postgres job table shared with the SG4b ledger. Until then git_publish refuses. */
export const FAIL_CLOSED_JOB_STORE: HostBuildJobStore = Object.freeze({
  async persist(): Promise<never> { throw new ArtifactOperationError("provider_unavailable"); },
});

export function createMemoryJobStore(): HostBuildJobStore & { jobs: Map<string, GitBuildJobRequest> } {
  const jobs = new Map<string, GitBuildJobRequest>();
  const keys = new Map<string, string>();
  return { jobs, async persist(job) {
    const key = JSON.stringify([job.storageScopeId, job.requestedBy, job.idempotencyKey]);
    const existing = keys.get(key);
    if (existing) return existing;
    const jobId = randomUUID();
    keys.set(key, jobId);
    jobs.set(jobId, structuredClone(job));
    return jobId;
  } };
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
  /**
   * Live reconcile of one binding generation (`POST v1/live/reconcile`, the
   * same endpoint the live-open worker calls): records the binding on the
   * builder, which otherwise refuses every build of a never-reconciled
   * binding with `git_live_conflict:stale_session`. Idempotent on the
   * builder side (same binding + generation, same ack), so it is sent
   * before every build request instead of tracking a host-side flag that
   * a restart or a builder reset would silently lose; a retry after a
   * `build_failed` therefore re-reconciles and is never blocked by the
   * previous failure. Fail-closed: a refused reconcile throws
   * `provider_unavailable` and no build is requested.
   */
  reconcileLiveBinding(input: { readonly storageScopeId: string; readonly artifactId: string;
    readonly bindingGeneration: number }): Promise<void>;
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
    if (!accepted.includes(response.status)) throw new ArtifactOperationError("provider_unavailable");
    return parseStatus(body, jobId);
  };
  const reconcile = async (artifactId: string, binding: Awaited<ReturnType<typeof resolveBuilderBinding>>, generation: number) => {
    let response: Response;
    try {
      response = await fetcher(new URL("v1/live/reconcile", base!), { method: "POST", redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: { "content-type": "application/json", authorization: await options.identity!.authorization() },
        body: JSON.stringify({ artifactId, binding, generation }) });
    } catch (error) {
      if (error instanceof ArtifactOperationError) throw error;
      throw new ArtifactOperationError("provider_unavailable");
    }
    // BridgeAck: any 2xx records the binding; the ack body carries no host state.
    if (response.status < 200 || response.status >= 300) throw new ArtifactOperationError("provider_unavailable");
    await response.text().catch(() => undefined);
  };
  return {
    async admits(executor: GitBuildExecutor) { return base !== undefined && executor === "sandbox"; },
    async reconcileLiveBinding(input) {
      if (!base) throw new ArtifactOperationError("provider_unavailable");
      const binding = await resolveBuilderBinding(options.bindings, input);
      await reconcile(input.artifactId, binding, input.bindingGeneration);
    },
    async request(job: GitBuildJobRequest) {
      if (!base || job.executor !== "sandbox") throw new ArtifactOperationError("provider_unavailable");
      const binding = await resolveBuilderBinding(options.bindings, { storageScopeId: job.storageScopeId, artifactId: job.artifactId,
        bindingGeneration: job.bindingGeneration });
      await reconcile(job.artifactId, binding, job.bindingGeneration);
      const jobId = await jobs.persist(job);
      const status = await call(new URL("v1/builds", base), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId: job.artifactId, jobId, binding }) }, [200, 202], jobId);
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

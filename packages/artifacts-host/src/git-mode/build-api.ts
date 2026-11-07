import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { IMMO_HOST_BUILD_QUALIFICATION } from "./gb1-host-build.js";
import type { HostServiceIdentity } from "./lease-broker.js";
import type { GitBuildExecutor, GitBuildJobRequest, GitBuildJobState, GitBuildPort } from "./provider-adapter.js";

/**
 * Host build API client (M3-I, contract-first with M3-B). `git_publish` with
 * the `sandbox` executor hands the job to the Sentropic builder service; the
 * builder resolves the job by `jobId`, fetches the pinned commit with its own
 * read lease, builds it on the pod and comes back through the SG4b handoff
 * (handoff.ts). immo never sends repository credentials or a caller SHA
 * outside the persisted job identity.
 *
 * Wire draft, to align with M3-B: `POST <origin>/artifacts/builder/v1/jobs`,
 * body = GitBuildJobRequest plus `buildQualification` (GB1: empty
 * postinstallAllowlist and the DISABLED install-script rows generated from
 * the lock), answer `{ jobId, state }`. The same
 * `(requestedBy, idempotencyKey)` must return the same job (builder side).
 *
 * Only `sandbox` is admitted, and only when the builder is configured:
 * otherwise `admits` is false and the provider answers `builder_unavailable`.
 */
export interface HostBuildApiOptions {
  readonly origin?: string | undefined;
  readonly identity?: HostServiceIdentity | undefined;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** GB1 qualification sent with every job; defaults to the rows generated from the lock. */
  readonly qualification?: typeof IMMO_HOST_BUILD_QUALIFICATION;
}

const STATES: readonly GitBuildJobState[] = ["build_pending", "building", "published", "build_failed", "cancelled"];

export function createHostBuildApiClient(options: HostBuildApiOptions): GitBuildPort {
  const configured = options.origin !== undefined && options.identity !== undefined;
  let endpoint: URL | undefined;
  if (configured) {
    const origin = new URL(options.origin!);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("artifact_git_builder_origin_invalid");
    }
    endpoint = new URL("/artifacts/builder/v1/jobs", origin);
  }
  const fetcher = options.fetch ?? fetch;
  return {
    async admits(executor: GitBuildExecutor) { return configured && executor === "sandbox"; },
    async request(job: GitBuildJobRequest) {
      if (!endpoint || job.executor !== "sandbox") throw new ArtifactOperationError("provider_unavailable");
      let response: Response;
      try {
        response = await fetcher(endpoint, { method: "POST", redirect: "error",
          headers: { "content-type": "application/json", authorization: await options.identity!.authorization() },
          body: JSON.stringify({ ...job, buildQualification: options.qualification ?? IMMO_HOST_BUILD_QUALIFICATION }), signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
      } catch { throw new ArtifactOperationError("provider_unavailable"); }
      if (response.status !== 200 && response.status !== 201) throw new ArtifactOperationError("provider_unavailable");
      let body: unknown;
      try { body = await response.json(); } catch { throw new ArtifactOperationError("provider_unavailable"); }
      const record = body as { jobId?: unknown; state?: unknown } | null;
      if (!record || typeof record.jobId !== "string" || !record.jobId || !STATES.includes(record.state as GitBuildJobState)) {
        throw new ArtifactOperationError("provider_unavailable");
      }
      return { jobId: record.jobId, state: record.state as GitBuildJobState };
    },
  };
}

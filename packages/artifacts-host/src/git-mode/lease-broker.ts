import type { GitInstallationLeasePort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * SG0-app lease broker client (D0: Sentropic provides the broker, immo
 * consumes it). Wire contract: cluster-mesh `createGitHubAppRouter`,
 * `POST /github-app/broker/lease` with exactly
 * `{ installationRef, repoId, storageScopeId }`; the broker authenticates the
 * host service identity and binds it server-side to `{ storageScopeId,
 * repoId }`. The answer is a single-repository lease
 * (`contents: write`, `metadata: read`), never an App key or a PAT.
 *
 * `/github-app/broker/verify` verifies inbound webhook signatures; immo does
 * not consume webhooks, so this client does not call it.
 *
 * Every failure is `provider_unavailable` (fail-closed). The lease token is
 * never logged, persisted or projected: it lives only in the GitPort session.
 */
export interface HostServiceIdentity {
  /** Authorization header value for the broker (service token or mTLS-bound assertion). */
  authorization(): Promise<string>;
}

export interface LeaseBrokerOptions {
  /** Public HTTPS origin of the Sentropic cluster-mesh router, e.g. https://sentropic.example. */
  readonly origin: string;
  readonly identity: HostServiceIdentity;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

const unavailable = () => new ArtifactOperationError("provider_unavailable");

/** Strict lease shape: one repository, exactly contents:write + metadata:read, not yet expired. */
export function parseBrokerLease(value: unknown, now: number): Awaited<ReturnType<GitInstallationLeasePort["acquire"]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const lease = value as Record<string, unknown>;
  const permissions = lease.permissions as Record<string, unknown> | undefined;
  if (typeof lease.token !== "string" || !lease.token || typeof lease.repositoryId !== "string" || !lease.repositoryId ||
    typeof lease.credentialVersion !== "string" || !lease.credentialVersion || typeof lease.expiresAt !== "string" ||
    !permissions || typeof permissions !== "object" || Array.isArray(permissions) ||
    Object.keys(permissions).sort().join(",") !== "contents,metadata" ||
    permissions.contents !== "write" || permissions.metadata !== "read") throw unavailable();
  const expires = Date.parse(lease.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw unavailable();
  return { token: lease.token, expiresAt: lease.expiresAt, repositoryId: lease.repositoryId,
    permissions: { contents: "write", metadata: "read" }, credentialVersion: lease.credentialVersion };
}

export function createLeaseBrokerClient(options: LeaseBrokerOptions): GitInstallationLeasePort {
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("artifact_git_broker_origin_invalid");
  }
  const endpoint = new URL("/github-app/broker/lease", origin);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    async acquire(input) {
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST", redirect: "error",
          headers: { "content-type": "application/json", authorization: await options.identity.authorization() },
          body: JSON.stringify({ installationRef: input.installationRef, repoId: input.repoId,
            storageScopeId: input.storageScopeId }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch { throw unavailable(); }
      if (response.status !== 200) throw unavailable();
      let body: unknown;
      try { body = await response.json(); } catch { throw unavailable(); }
      return parseBrokerLease(body, now());
    },
  };
}

/** Default when no broker is configured: every lease request refuses (`provider_unavailable`). */
export const FAIL_CLOSED_LEASES: GitInstallationLeasePort = Object.freeze({
  async acquire(): Promise<never> { throw unavailable(); },
});

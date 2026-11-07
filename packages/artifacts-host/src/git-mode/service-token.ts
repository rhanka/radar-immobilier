import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";

/**
 * OAuth client_credentials service token of the immo host (one client, two
 * scopes: `github-app:broker` for the SG0-app lease broker, `artifacts:builder`
 * for the builder service). One fetcher per scope; the token is cached until
 * shortly before expiry and never logged. Every failure is
 * `provider_unavailable` (fail-closed); a failed fetch is not cached.
 *
 * Token endpoint: `<IMMO_ARTIFACTS_SERVICE_OAUTH_ISSUER>/api/v1/auth/oauth/token`
 * (same IdP layout as IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT), overridable with
 * IMMO_ARTIFACTS_SERVICE_OAUTH_TOKEN_ENDPOINT.
 */
export const SERVICE_SCOPE_BROKER = "github-app:broker" as const;
export const SERVICE_SCOPE_BUILDER = "artifacts:builder" as const;
const REFRESH_MARGIN_MS = 30_000;

export interface ServiceTokenOptions {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope: string;
  /** Optional RFC 8707 resource (the audience the service expects). */
  readonly resource?: string | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

export interface ServiceTokenSource { authorization(): Promise<string> }

const unavailable = () => new ArtifactOperationError("provider_unavailable");

export function createServiceTokenSource(options: ServiceTokenOptions): ServiceTokenSource {
  const endpoint = new URL(options.tokenEndpoint);
  if (endpoint.protocol !== "https:" || !options.clientId || !options.clientSecret || !options.scope) {
    throw new Error("artifact_service_token_config_invalid");
  }
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  const fetchToken = async (): Promise<string> => {
    const body = new URLSearchParams({ grant_type: "client_credentials", scope: options.scope,
      ...(options.resource ? { resource: options.resource } : {}) });
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: "POST", redirect: "error", body,
        headers: { "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`).toString("base64")}` },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
    } catch { throw unavailable(); }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw unavailable(); }
    const record = payload as { access_token?: unknown; token_type?: unknown; expires_in?: unknown; scope?: unknown } | null;
    if (response.status !== 200 || !record || typeof record.access_token !== "string" || !record.access_token ||
      String(record.token_type).toLowerCase() !== "bearer" || !Number.isSafeInteger(record.expires_in) ||
      (record.expires_in as number) <= 0 ||
      (typeof record.scope === "string" && !record.scope.split(" ").includes(options.scope))) throw unavailable();
    cached = { token: record.access_token, expiresAt: now() + (record.expires_in as number) * 1000 };
    return record.access_token;
  };
  return {
    async authorization() {
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return `Bearer ${cached.token}`;
      cached = undefined;
      pending ??= fetchToken().finally(() => { pending = undefined; });
      return `Bearer ${await pending}`;
    },
  };
}

/** Fail-closed source used while the OAuth client is not configured. */
export const FAIL_CLOSED_SERVICE_TOKEN: ServiceTokenSource = Object.freeze({
  async authorization(): Promise<never> { throw unavailable(); },
});

export interface ServiceTokenConfig {
  readonly tokenEndpoint?: string | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly resource?: string | undefined;
}

export function serviceTokenSource(config: ServiceTokenConfig, scope: string, fetcher?: typeof fetch): ServiceTokenSource {
  if (!config.tokenEndpoint || !config.clientId || !config.clientSecret) return FAIL_CLOSED_SERVICE_TOKEN;
  return createServiceTokenSource({ tokenEndpoint: config.tokenEndpoint, clientId: config.clientId,
    clientSecret: config.clientSecret, scope, resource: config.resource, ...(fetcher ? { fetch: fetcher } : {}) });
}

/**
 * Exchange configuration for the H4 P4 request-bound RFC 8693 delegation.
 *
 * The MCP ingress audience (`mcpResource`, ending in `/mcp`) and the radar
 * API audience (`apiAudience`, exact origin without `/mcp`) are distinct
 * values. Both come from the environment so each deployment pins its exact
 * pair. The workload identity (`workloadSub` / `workloadClientId`) is the
 * confidential `immo-mcp-workload`; its references are applied by the
 * operator and never carry a secret inside this repository.
 */
export const EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
export const EXCHANGE_SUBJECT_TOKEN_TYPE =
  "urn:ietf:params:oauth:token-type:access_token";
export const EXCHANGE_REQUESTED_TOKEN_TYPE =
  "urn:ietf:params:oauth:token-type:access_token";

/** Maximum issued lifetime of a delegated token, in seconds (H4 contract). */
export const EXCHANGE_MAX_LIFETIME_S = 300;
/** Cache time-to-live after insertion, in seconds (H4 contract). */
export const EXCHANGE_CACHE_TTL_S = 60;
/** Early-use margin subtracted from the cache deadline, in seconds. */
export const EXCHANGE_EARLY_MARGIN_S = 5;
/** Default bound on cached delegated tokens. */
export const EXCHANGE_MAX_ENTRIES = 200;
/** Default bound on concurrent in-flight exchanges. */
export const EXCHANGE_MAX_INFLIGHT = 32;
/** Maximum accepted token-endpoint response body, in bytes. */
export const EXCHANGE_MAX_RESPONSE_BYTES = 16 * 1024;
/** Delegated scope for the protected egress (only `search_signals`). */
export const EXCHANGE_REQUIRED_SCOPE = "immo:search";
/** Default policy revision recorded in the cache key. */
export const EXCHANGE_DEFAULT_POLICY_REVISION = "a2base-search-v1";

export interface ExchangeConfig {
  /** Token issuer expected on the delegated JWT (`iss`). */
  readonly issuer: string;
  /** Exact radar API audience (`aud` on the delegated JWT). */
  readonly apiAudience: string;
  /** Canonical MCP resource (incoming audience, ending in `/mcp`). */
  readonly mcpResource: string;
  /** RFC 8693 token endpoint URL. */
  readonly tokenEndpoint: string;
  /** Workload identity asserted as `act.sub`. */
  readonly workloadSub: string;
  /** Workload identity asserted as `client_id`. */
  readonly workloadClientId: string;
  /** Deployment environment recorded in the cache key. */
  readonly environment: string;
  /** Authority policy revision recorded in the cache key. */
  readonly policyRevision: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultTokenEndpoint(issuer: string): string {
  return issuer.replace(/\/$/, "") + "/token";
}

/**
 * Load the exchange configuration from the environment. Returns `null` when
 * the workload binding is absent: callers must fail closed
 * (`exchange_not_configured`) and never fall back to the subject bearer.
 */
export function loadExchangeConfig(env: NodeJS.ProcessEnv): ExchangeConfig | null {
  const issuer = nonEmpty(env.IMMO_MCP_EXCHANGE_ISSUER) ?? nonEmpty(env.IMMO_MCP_OAUTH_ISSUER);
  const apiAudience = nonEmpty(env.IMMO_MCP_API_AUDIENCE);
  const mcpResource = nonEmpty(env.IMMO_MCP_OAUTH_RESOURCE);
  const workloadSub = nonEmpty(env.IMMO_MCP_WORKLOAD_SUB);
  const workloadClientId = nonEmpty(env.IMMO_MCP_WORKLOAD_CLIENT_ID);
  if (!issuer || !apiAudience || !mcpResource || !workloadSub || !workloadClientId) {
    return null;
  }
  const tokenEndpoint =
    nonEmpty(env.IMMO_MCP_EXCHANGE_TOKEN_ENDPOINT) ?? defaultTokenEndpoint(issuer);
  return {
    issuer,
    apiAudience,
    mcpResource,
    tokenEndpoint,
    workloadSub,
    workloadClientId,
    environment: nonEmpty(env.IMMO_MCP_EXCHANGE_ENV) ?? nonEmpty(env.ENV) ?? "unknown",
    policyRevision:
      nonEmpty(env.IMMO_MCP_EXCHANGE_POLICY_REV) ?? EXCHANGE_DEFAULT_POLICY_REVISION,
  };
}

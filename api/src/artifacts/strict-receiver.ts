// H4 P5 strict receiver: search-route profile, exchange-first activation and
// strict-preserving recovery.
//
// Pure module (no Hono, no crypto): signature checks live in
// services/auth/oidc.ts, transport wiring in routes/auth.ts. This file owns
// the three decisions the receiver makes without I/O:
//   1. route profile — which requests may carry a delegated token;
//   2. activation — enforcement starts only after an A2 receipt match;
//   3. recovery — only a strict, exchange-capable target may replace it.
import type { AuthConfig, StrictReceiverConfig } from "../config.js";

/** City slug accepted on the strict search route (canonical lowercase form). */
const STRICT_CITY_PATTERN = /^[a-z0-9-]{1,128}$/;

/** Aggregate path is never a strict search, even though it matches the shape. */
const STRICT_EXCLUDED_CITY = "by-city";

/**
 * Query keys the strict search route preserves (bounded existing behavior of
 * the per-city feed and its aggregate sibling).
 */
const STRICT_SEARCH_QUERY_KEYS: ReadonlySet<string> = new Set([
  "showDiscarded",
  "dateFrom",
  "dateTo",
  "dateBasis",
  "excludePiia",
  "excludeDerogations",
]);

/**
 * Whether a request matches the strict search profile: GET on the canonical
 * per-city path with an allowlisted query. Encoded (`%`), uppercase,
 * trailing-slash, double-slash and aggregate variants never match — pass the
 * encoding-preserving pathname (from the raw request URL), not a decoded path.
 */
export function isStrictSearchRequest(
  method: string,
  rawPath: string,
  query: Record<string, string>,
): boolean {
  if (method !== "GET") return false;
  const prefix = "/api/graph-signals/";
  if (!rawPath.startsWith(prefix)) return false;
  const city = rawPath.slice(prefix.length);
  if (city === STRICT_EXCLUDED_CITY) return false;
  if (!STRICT_CITY_PATTERN.test(city)) return false;
  return Object.keys(query).every((key) => STRICT_SEARCH_QUERY_KEYS.has(key));
}

/**
 * Encoding-preserving pathname of a request URL (`URL.pathname` keeps `%`
 * sequences verbatim). Returns null when the URL cannot be parsed.
 */
export function strictRequestPath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Whether the strict receiver currently enforces (armed with an A2 receipt). */
export function isStrictReceiverEnforced(auth: AuthConfig | undefined): boolean {
  return auth?.strict?.enabled === true;
}

/**
 * Recovery eligibility for a strict-stage rollback target. Only a target that
 * retains strict enforcement AND exchange capability AND stored data may
 * replace the active receiver — a permissive (pre-strict) API or a
 * forwarding MCP target is refused, preserving the release-gate rigor.
 */
export interface StrictRecoveryTarget {
  readonly strictEnforced: boolean;
  readonly exchangeCapable: boolean;
  readonly preservesData: boolean;
}

export function assertStrictRecoveryEligible(target: StrictRecoveryTarget): void {
  if (!target.strictEnforced || !target.exchangeCapable || !target.preservesData) {
    throw new Error("strict_recovery_refused");
  }
}

/**
 * Annotated synthetic fixture: receiver wiring for tests. The explicit return
 * type keeps the API declaration build clean.
 */
export function strictReceiverTestConfig(
  overrides: { enabled?: boolean; apiAudience?: string; environment?: string } = {},
): StrictReceiverConfig {
  const apiAudience = overrides.apiAudience ?? "https://immo.example.test";
  return {
    enabled: overrides.enabled ?? true,
    issuer: "https://auth.example.test",
    apiAudience,
    mcpAudience: `${apiAudience}/mcp`,
    workloadSub: "immo-mcp-workload",
    workloadClientId: "immo-mcp-workload",
    requiredScope: "immo:search",
    maxLifetimeS: 300,
    environment: overrides.environment ?? "test",
  };
}

/** Annotated synthetic fixture: armed API auth for receiver tests. */
export function strictReceiverTestAuth(
  strict: StrictReceiverConfig,
  overrides: { appBaseUrl?: string } = {},
): AuthConfig {
  const appBaseUrl = overrides.appBaseUrl ?? strict.apiAudience;
  return {
    enabled: true,
    issuer: strict.issuer,
    clientId: "radar-immobilier",
    clientSecret: "super-secret",
    redirectUri: `${appBaseUrl}/api/v1/auth/oauth/callback`,
    scopes: "openid profile email",
    appBaseUrl,
    sessionSecret: "session-secret-32-bytes-long-padding!!",
    sessionTtlSeconds: 3600,
    sessionAbsoluteTtlSeconds: 7200,
    jwksUri: `${strict.issuer}/.well-known/jwks.json`,
    bearerAudiences: [strict.apiAudience, strict.mcpAudience],
    strict,
  };
}

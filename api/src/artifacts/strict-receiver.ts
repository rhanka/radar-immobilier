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
import { decodeMcpSignalSearch, MCP_SIGNAL_SEARCH_PATH } from "../routes/mcp-signal-search.js";

/** The candidate authorizes only the reserved read-search contract. */
export function isStrictSearchRequest(
  method: string, rawPath: string, query: URLSearchParams, accept?: string,
): boolean {
  if (method !== "GET" || rawPath !== MCP_SIGNAL_SEARCH_PATH) return false;
  if (accept?.toLowerCase().includes("text/event-stream")) return false;
  try { decodeMcpSignalSearch(query); return true; } catch { return false; }
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
 * Requested-but-not-enforced wiring. The config resolver never produces this
 * state (it throws); the middleware treats hand-built occurrences as
 * fail-closed and refuses every Bearer, never falling back to permissive.
 */
export function isStrictArmingInvalid(auth: AuthConfig | undefined): boolean {
  return (
    auth?.strict?.armingRequested === true && auth?.strict?.enabled !== true
  );
}

/**
 * Whether the strict wiring carries enough references to verify an exchanged
 * presentation (issuer, API audience, workload pair). Disarmed wiring without
 * these references cannot verify and falls back to the plain path for A2
 * continuity; complete wiring verifies strictly.
 */
export function isStrictWiringComplete(auth: AuthConfig | undefined): boolean {
  const strict = auth?.strict;
  return (
    strict !== undefined &&
    strict.issuer !== "" &&
    strict.apiAudience !== "" &&
    strict.workloadSub !== "" &&
    strict.workloadClientId !== ""
  );
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
  overrides: {
    enabled?: boolean;
    armingRequested?: boolean;
    apiAudience?: string;
    environment?: string;
  } = {},
): StrictReceiverConfig {
  const apiAudience = overrides.apiAudience ?? "https://immo.example.test";
  const enabled = overrides.enabled ?? true;
  return {
    enabled,
    armingRequested: overrides.armingRequested ?? enabled,
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

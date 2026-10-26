/**
 * PW-A identity domain: the application principal is built only from the
 * verified session cookie plus the server-configured domain. No bearer,
 * no client-supplied issuer, no NODE_ENV deduction.
 */
import type { AuthConfig } from "../config.js";
import type { VerifiedSession } from "../services/auth/session.js";
import type { PwPrincipal } from "../services/facets/pw-write-digests.js";

export type PwTier = "preprod" | "prod";

export interface PwIdentityDomain {
  readonly identityIssuer: string;
  readonly tier: PwTier;
  readonly appOrigin: string;
  readonly clientId: string;
}

const PROD_APP = "https://immo.sent-tech.ca";
const PROD_IDP = "https://auth.sent-tech.ca";
const PREPROD_APP = "https://preprod.immo.sent-tech.ca";
const PREPROD_IDP = "https://preprod.auth.sent-tech.ca";

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Resolve the single identity domain PW may attribute; null keeps PW closed. */
export function resolvePwIdentityDomain(
  auth: AuthConfig,
  tier: string | undefined,
): PwIdentityDomain | null {
  if (!auth.enabled) return null;
  if (tier !== "preprod" && tier !== "prod") return null;
  const appOrigin = canonicalOrigin(auth.appBaseUrl);
  const identityIssuer = auth.issuer.replace(/\/$/, "");
  if (appOrigin === null || identityIssuer === "") return null;
  const expectedApp = tier === "prod" ? PROD_APP : PREPROD_APP;
  const expectedIssuer = tier === "prod" ? PROD_IDP : PREPROD_IDP;
  if (appOrigin !== expectedApp || identityIssuer !== expectedIssuer) return null;
  if (auth.clientId === "") return null;
  return { identityIssuer, tier, appOrigin, clientId: auth.clientId };
}

/** Canonical application principal from a verified cookie session. */
export function canonicalAppPrincipal(session: VerifiedSession, domain: PwIdentityDomain): PwPrincipal {
  return { issuer: domain.identityIssuer, sub: session.sub, tier: domain.tier };
}

/** Canonical write principal from a verified write grant. */
export function canonicalWritePrincipal(grant: {
  identityIssuer: string; readerSub: string; tier: string;
}): PwPrincipal {
  return { issuer: grant.identityIssuer, sub: grant.readerSub, tier: grant.tier };
}

/** Exact three-field equality; email or sub alone never matches. */
export function samePwPrincipal(left: PwPrincipal, right: PwPrincipal): boolean {
  return left.issuer === right.issuer && left.sub === right.sub && left.tier === right.tier;
}

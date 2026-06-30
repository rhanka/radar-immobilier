// RP session cookie — radar mints its OWN HttpOnly session, separate from the
// IdP id_token (RP_SESSION_GLUE.md step 5: the id_token proves identity once;
// the RP session is what the browser carries afterwards). The session is a
// compact JWS (HS256) signed with SESSION_SECRET, so it is stateless and
// tamper-evident without a server-side store.

import { SignJWT, jwtVerify } from "jose";

/** Name of the HttpOnly session cookie radar sets on its own origin. */
export const SESSION_COOKIE_NAME = "radar_session";

/** Claims radar carries in its own session (derived from the IdP id_token). */
export interface SessionClaims {
  /** Subject — the IdP `sub` (stable user id). */
  sub: string;
  /** Display name, when the IdP returns one (Phase A0: name/email only). */
  name?: string;
  /** Email, when present. */
  email?: string;
  /**
   * Original issued-at (epoch seconds) — the ANCHOR of the absolute sliding
   * ceiling. Set once on the first mint (defaults to the current `iat`) and
   * carried verbatim through every sliding re-mint, so the rolling 15-day
   * window can never outlive the absolute ceiling (cf. shouldRefreshSession).
   */
  iat0?: number;
}

/**
 * A verified session: the claims plus the standard `exp`, and the current
 * `iat` (both epoch seconds). `iat0` is the original issuance used by the
 * sliding policy; it falls back to `iat` for legacy tokens minted before the
 * claim existed.
 */
export interface VerifiedSession extends SessionClaims {
  exp: number;
  iat: number;
}

function secretKey(sessionSecret: string): Uint8Array {
  return new TextEncoder().encode(sessionSecret);
}

/**
 * Sign a session token. `ttlSeconds` sets `exp`; `now` is injectable so tests
 * are deterministic and don't depend on wall-clock time.
 */
export async function signSession(
  claims: SessionClaims,
  opts: { sessionSecret: string; ttlSeconds: number; now?: number },
): Promise<string> {
  const issuedAt = Math.floor((opts.now ?? Date.now()) / 1000);
  const payload: Record<string, unknown> = { sub: claims.sub };
  if (claims.name !== undefined) payload.name = claims.name;
  if (claims.email !== undefined) payload.email = claims.email;
  // On the first mint, `iat0` defaults to the current issuance; on a sliding
  // re-mint the caller passes the ORIGINAL iat0 so the absolute ceiling holds.
  payload.iat0 = claims.iat0 ?? issuedAt;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setSubject(claims.sub)
    .setExpirationTime(issuedAt + opts.ttlSeconds)
    .sign(secretKey(opts.sessionSecret));
}

/**
 * Verify a session token. Returns the verified claims, or `null` for any
 * failure (bad signature, expired, malformed) — callers treat null as
 * "no valid session" and never throw to the client.
 */
export async function verifySession(
  token: string,
  opts: { sessionSecret: string; now?: number },
): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(opts.sessionSecret), {
      algorithms: ["HS256"],
      // jose checks exp against this clock; injectable for deterministic tests.
      // exactOptionalPropertyTypes forbids an explicit `undefined`, so omit the
      // key entirely when no clock is injected (jose defaults to Date.now()).
      ...(opts.now !== undefined ? { currentDate: new Date(opts.now) } : {}),
    });
    if (typeof payload.sub !== "string" || payload.sub === "") return null;
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    const iat = typeof payload.iat === "number" ? payload.iat : 0;
    const out: VerifiedSession = { sub: payload.sub, exp, iat };
    if (typeof payload.name === "string") out.name = payload.name;
    if (typeof payload.email === "string") out.email = payload.email;
    if (typeof payload.iat0 === "number") out.iat0 = payload.iat0;
    return out;
  } catch {
    return null;
  }
}

/**
 * Sliding-session policy: should the cookie be re-minted NOW?
 *
 * Re-mint when BOTH hold:
 *   1. we are past the TTL's half-life (`exp - now < ttl/2`), so we don't
 *      re-sign on every request — only roughly once per half-life window; and
 *   2. the ORIGINAL issuance (`iat0`, falling back to `iat`) is still younger
 *      than the absolute ceiling.
 *
 * Past the ceiling we return false: the session is left to expire at its
 * current `exp`, forcing a real re-login and bounding a stolen cookie's life.
 * Callers only invoke this on an ALREADY-VALID session (verifySession != null).
 * `now` is epoch milliseconds (same convention as sign/verifySession).
 */
export function shouldRefreshSession(
  session: VerifiedSession,
  opts: { ttlSeconds: number; absoluteMaxSeconds: number; now?: number },
): boolean {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const pastHalfLife = session.exp - nowSec < opts.ttlSeconds / 2;
  const anchor = session.iat0 ?? session.iat;
  const withinCeiling = nowSec - anchor < opts.absoluteMaxSeconds;
  return pastHalfLife && withinCeiling;
}

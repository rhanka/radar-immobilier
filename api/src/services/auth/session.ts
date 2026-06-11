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
}

/** A verified session: the claims plus the standard `exp` (epoch seconds). */
export interface VerifiedSession extends SessionClaims {
  exp: number;
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
    const out: VerifiedSession = { sub: payload.sub, exp };
    if (typeof payload.name === "string") out.name = payload.name;
    if (typeof payload.email === "string") out.email = payload.email;
    return out;
  } catch {
    return null;
  }
}

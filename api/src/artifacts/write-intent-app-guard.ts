import { writeRefusal } from "./write-intent-refusal.js";
/**
 * PW-A cookie-only application guard: no Authorization header, verified
 * session cookie, exact application origin, and approved account for
 * summary and confirm. Reuses verifySession; changes no shared guard.
 */
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AuthConfig } from "../config.js";
import { SESSION_COOKIE_NAME, verifySession, type VerifiedSession } from "../services/auth/session.js";
import { isApprovedAccountStatus, readAccountStatus, type AccountStatusQueryable } from "@radar/artifacts-host";
import type { PwIdentityDomain } from "./write-intent-principal.js";
import { canonicalAppPrincipal } from "./write-intent-principal.js";
import type { PwPrincipal } from "../services/facets/pw-write-digests.js";

export interface AppGuardDeps {
  auth: AuthConfig;
  domain: PwIdentityDomain;
  accounts: AccountStatusQueryable;
  nowMs?: (() => number) | undefined;
  sessionSecret: string;
}

export interface AppGuardPass {
  session: VerifiedSession;
  principal: PwPrincipal;
  rawCookie: string;
}

function privateHeaders(c: Context): void {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie, Authorization");
}

function servedOnApp(c: Context, appOrigin: string): boolean {
  const forwarded = c.req.header("forwarded") ?? c.req.header("x-forwarded-host") ?? c.req.header("x-forwarded-proto");
  if (forwarded !== undefined) return false;
  const host = (c.req.header("host") ?? "").toLowerCase();
  if (host.length === 0) return false;
  try {
    const url = new URL(`https://${host}`);
    return url.host === host && url.origin === appOrigin;
  } catch {
    return false;
  }
}

/** Session gate shared by summary, management, confirm, and revoke. */
export async function guardWriteIntentAppSession(
  c: Context, deps: AppGuardDeps, probe?: { code?: string },
): Promise<AppGuardPass | Response> {
  const refuse = (code: "cookie_required" | "unauthenticated" | "session_expired", status: 401) => {
    if (probe) probe.code = code;
    return writeRefusal(c, code, status);
  };
  privateHeaders(c);
  if (c.req.header("authorization") !== undefined) {
    return refuse("cookie_required", 401);
  }
  if (!deps.auth.enabled) return writeRefusal(c, "write_transport_closed", 503);
  if (deps.sessionSecret !== deps.auth.sessionSecret || Buffer.byteLength(deps.sessionSecret) < 32
    || deps.domain.identityIssuer !== deps.auth.issuer.replace(/\/$/, "")
    || deps.domain.appOrigin !== deps.auth.appBaseUrl.replace(/\/$/, "")
    || deps.domain.clientId !== deps.auth.clientId) return writeRefusal(c, "write_transport_closed", 503);
  if (!servedOnApp(c, deps.domain.appOrigin)) {
    return writeRefusal(c, "write_transport_closed", 503);
  }
  const rawCookie = getCookie(c, SESSION_COOKIE_NAME);
  if (!rawCookie) return refuse("unauthenticated", 401);
  const session = await verifySession(rawCookie, {
    sessionSecret: deps.sessionSecret,
    now: (deps.nowMs ?? Date.now)(),
  });
  if (!session || session.exp * 1000 <= (deps.nowMs ?? Date.now)()) return refuse("session_expired", 401);
  return { session, principal: canonicalAppPrincipal(session, deps.domain), rawCookie };
}

/** Approved account gate for summary and confirm; management stays open. */
export async function requireApprovedAppAccount(
  c: Context, deps: AppGuardDeps, sub: string,
): Promise<Response | null> {
  try {
    const status = await readAccountStatus(deps.accounts, sub);
    if (!isApprovedAccountStatus(status)) {
      return writeRefusal(c, "account_not_approved", 403);
    }
    return null;
  } catch {
    return writeRefusal(c, "write_authority_unavailable", 503);
  }
}

/** Mutation gate: exact origin, JSON, Fetch Metadata, no reader token. */
export function assertAppMutationHeaders(c: Context, appOrigin: string): Response | null {
  if (c.req.header("origin") !== appOrigin) {
    return writeRefusal(c, "csrf_refused", 403);
  }
  if (c.req.header("content-encoding") !== undefined) return writeRefusal(c, "unsupported_media_type", 415);
  if ((c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return writeRefusal(c, "unsupported_media_type", 415);
  }
  if (c.req.header("x-reader-csrf") !== undefined) {
    return writeRefusal(c, "csrf_refused", 403);
  }
  const site = c.req.header("sec-fetch-site");
  const mode = c.req.header("sec-fetch-mode");
  const dest = c.req.header("sec-fetch-dest");
  if ((site !== undefined && site !== "same-origin")
    || (mode !== undefined && mode !== "same-origin" && mode !== "cors")
    || (dest !== undefined && dest !== "empty")) {
    return writeRefusal(c, "csrf_refused", 403);
  }
  return null;
}

// Sentropic OIDC relying-party routes + session-protect middleware.
//
//   GET  /api/v1/auth/login            -> 302 to the IdP authorize endpoint
//   GET  /api/v1/auth/oauth/callback   -> code->token, verify id_token, set session
//   GET  /api/v1/auth/logout           -> clear session, 302 home
//   GET  /api/v1/auth/me               -> { authenticated, user } (UI session probe)
//
// The flow follows sentropic's RP_SESSION_GLUE.md (authorization_code + PKCE,
// id_token verified against the IdP JWKS, radar mints its OWN HttpOnly cookie).
// All of it is gated by AuthConfig.enabled: when auth is not configured (local
// dev / tests), the routes report 503 and `protect` lets every request pass.

import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { JWTVerifyGetKey } from "jose";
import type { AuthConfig } from "../config.js";
import {
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
} from "../services/auth/session.js";
import {
  buildAuthorizeUrl,
  createAuthFlowState,
  exchangeCode,
  fetchDiscovery,
  verifyIdToken,
  type FetchLike,
  type OidcDiscovery,
} from "../services/auth/oidc.js";

/** Transient cookie holding the per-login flow state until the callback. */
const FLOW_COOKIE_NAME = "radar_oauth_flow";

/** Injectable seams so the routes are unit-testable without real network. */
export interface AuthRouteOptions {
  /** Outbound HTTP. Defaults to the Node global `fetch`. */
  fetchImpl?: FetchLike;
  /** JWKS key getter for id_token verification (defaults to remote JWKS). */
  getKey?: JWTVerifyGetKey;
  /** Override discovery (tests); production fetches it from the issuer. */
  discovery?: OidcDiscovery;
  /** Clock injection for deterministic exp checks. */
  now?: () => number;
}

/** Is the request a browser navigation (vs. an XHR/fetch from the SPA)? */
function isBrowserNavigation(accept: string | undefined): boolean {
  return (accept ?? "").includes("text/html");
}

/** Whether the session cookie should carry the `Secure` flag. */
function cookieSecure(auth: AuthConfig): boolean {
  return auth.appBaseUrl.startsWith("https://");
}

/**
 * Build the OIDC RP routes. When `auth.enabled` is false the routes are still
 * mounted but answer 503 (so the wiring is greppable and the contract stable).
 */
export function authRoute(
  auth: AuthConfig,
  options: AuthRouteOptions = {},
): Hono {
  const app = new Hono();
  const fetchImpl: FetchLike =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const nowFn = options.now ?? (() => Date.now());

  async function discover(): Promise<OidcDiscovery> {
    return options.discovery ?? fetchDiscovery(auth, fetchImpl);
  }

  app.get("/api/v1/auth/login", async (c) => {
    if (!auth.enabled) return c.json({ error: "auth_disabled" }, 503);

    let discovery: OidcDiscovery;
    try {
      discovery = await discover();
    } catch (e) {
      return c.json({ error: "idp_unreachable", detail: String(e) }, 502);
    }

    const flow = createAuthFlowState();
    // Stash the flow state (state/nonce/PKCE verifier) in a short-lived,
    // HttpOnly cookie; it is consumed and cleared at the callback.
    setCookie(c, FLOW_COOKIE_NAME, JSON.stringify(flow), {
      httpOnly: true,
      secure: cookieSecure(auth),
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });

    return c.redirect(buildAuthorizeUrl(auth, discovery, flow), 302);
  });

  app.get("/api/v1/auth/oauth/callback", async (c) => {
    if (!auth.enabled) return c.json({ error: "auth_disabled" }, 503);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const idpError = c.req.query("error");
    if (idpError) {
      return c.json({ error: "idp_error", detail: idpError }, 400);
    }
    if (!code || !state) {
      return c.json({ error: "missing_code_or_state" }, 400);
    }

    const flowRaw = getCookie(c, FLOW_COOKIE_NAME);
    if (!flowRaw) return c.json({ error: "missing_flow_state" }, 400);
    // The flow cookie is single-use regardless of outcome.
    deleteCookie(c, FLOW_COOKIE_NAME, { path: "/" });

    let flow: { state: string; nonce: string; codeVerifier: string };
    try {
      flow = JSON.parse(flowRaw);
    } catch {
      return c.json({ error: "bad_flow_state" }, 400);
    }
    if (flow.state !== state) {
      return c.json({ error: "state_mismatch" }, 400);
    }

    let discovery: OidcDiscovery;
    try {
      discovery = await discover();
    } catch (e) {
      return c.json({ error: "idp_unreachable", detail: String(e) }, 502);
    }

    let idToken: string;
    try {
      const tokens = await exchangeCode(
        auth,
        discovery,
        code,
        flow.codeVerifier,
        fetchImpl,
      );
      idToken = tokens.id_token;
    } catch (e) {
      return c.json({ error: "token_exchange_failed", detail: String(e) }, 502);
    }

    let user;
    try {
      user = await verifyIdToken(idToken, {
        auth,
        discovery,
        expectedNonce: flow.nonce,
        ...(options.getKey ? { getKey: options.getKey } : {}),
        now: nowFn(),
      });
    } catch (e) {
      return c.json({ error: "id_token_invalid", detail: String(e) }, 401);
    }

    const sessionToken = await signSession(
      {
        sub: user.sub,
        ...(user.name !== undefined ? { name: user.name } : {}),
        ...(user.email !== undefined ? { email: user.email } : {}),
      },
      {
        sessionSecret: auth.sessionSecret,
        ttlSeconds: auth.sessionTtlSeconds,
        now: nowFn(),
      },
    );
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: cookieSecure(auth),
      sameSite: "Lax",
      path: "/",
      maxAge: auth.sessionTtlSeconds,
    });

    return c.redirect(auth.appBaseUrl || "/", 302);
  });

  app.get("/api/v1/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    if (isBrowserNavigation(c.req.header("accept"))) {
      return c.redirect(auth.appBaseUrl || "/", 302);
    }
    return c.json({ ok: true });
  });

  app.get("/api/v1/auth/me", async (c) => {
    if (!auth.enabled) {
      // Auth not configured -> open mode. Report so the SPA can adapt.
      return c.json({ authenticated: false, authDisabled: true });
    }
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) return c.json({ authenticated: false });
    const session = await verifySession(token, {
      sessionSecret: auth.sessionSecret,
      now: nowFn(),
    });
    if (!session) return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      user: {
        sub: session.sub,
        ...(session.name !== undefined ? { name: session.name } : {}),
        ...(session.email !== undefined ? { email: session.email } : {}),
      },
    });
  });

  return app;
}

/** Path prefixes that stay public even when auth is enabled. */
const PUBLIC_PREFIXES = [
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/oauth/callback",
  "/api/v1/auth/logout",
  "/api/v1/auth/me",
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}

/**
 * Session-protect middleware. When `auth.enabled` is false it is a no-op
 * (local dev / tests stay open). When enabled, it requires a valid session
 * cookie on every non-public route: browser navigations get a 302 to /login,
 * API/XHR requests get a 401 JSON (the SPA can then redirect). The verified
 * session is exposed on the context as `c.get("session")`.
 */
export function protect(
  auth: AuthConfig,
  options: { now?: () => number } = {},
): MiddlewareHandler {
  const nowFn = options.now ?? (() => Date.now());
  return async (c, next) => {
    if (!auth.enabled) return next();

    const path = c.req.path;
    if (isPublicPath(path)) return next();

    const token = getCookie(c, SESSION_COOKIE_NAME);
    const session = token
      ? await verifySession(token, {
          sessionSecret: auth.sessionSecret,
          now: nowFn(),
        })
      : null;

    if (!session) {
      if (isBrowserNavigation(c.req.header("accept"))) {
        return c.redirect("/api/v1/auth/login", 302);
      }
      return c.json({ error: "unauthenticated" }, 401);
    }

    c.set("session" as never, session as never);
    return next();
  };
}

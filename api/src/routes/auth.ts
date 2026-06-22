// Sentropic OIDC relying-party routes + session-protect middleware.
//
//   GET  /api/v1/auth/login            -> 302 to the IdP authorize endpoint
//   GET  /api/v1/auth/enroll           -> drop any session, 302 to /login (IdP)
//   GET  /api/v1/auth/oauth/callback   -> code->token, verify id_token, set session
//   GET  /api/v1/auth/logout           -> clear session, 302 home
//   GET  /api/v1/auth/me               -> { authenticated, user } (UI session probe)
//
// The flow follows sentropic's RP_SESSION_GLUE.md (authorization_code + PKCE,
// id_token verified against the IdP JWKS, radar mints its OWN HttpOnly cookie).
// All of it is gated by AuthConfig.enabled: when auth is not configured (local
// dev / tests), the routes report 503 and `protect` lets every request pass.

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
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
import type { Database } from "../db/client.js";
import { accountUsers, accountInvitations } from "../db/schema.js";

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
  /**
   * Database handle for enrollment (optional seam).
   * When absent, the callback skips enrollment (fail-open — maintains
   * backward compatibility for tests without DB).
   */
  db?: Database;
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
 * Identity attributes of the session cookie — the tuple the browser uses to
 * MATCH a `Set-Cookie` against an existing cookie (name + path + domain, with
 * secure/sameSite required to match by strict browsers). Login (set) and logout
 * (delete) MUST share these EXACT attributes, otherwise the deletion `Set-Cookie`
 * targets a different cookie and the browser keeps the live session — the root
 * cause of "reconnect lands on the previous user" + "still logged in after
 * clearing the F12 store" (the F12 store is localStorage, NOT this HttpOnly
 * cookie). No `Domain` is set on purpose: the cookie stays host-only on the app
 * origin (immo.sent-tech.ca), matching the deploy contract.
 */
function sessionCookieAttributes(
  auth: AuthConfig,
): { httpOnly: true; secure: boolean; sameSite: "Lax"; path: "/" } {
  return {
    httpOnly: true,
    secure: cookieSecure(auth),
    sameSite: "Lax",
    path: "/",
  };
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

  /**
   * Mint and set the RP session cookie for an authenticated user.
   *
   * IMPORTANT: this is called for EVERY authenticated user, including those
   * whose account status is `pending`/`rejected`/`suspended`. Previously the
   * callback redirected non-approved users to `/pending` (or `/rejected`)
   * WITHOUT setting the session cookie. The SPA then probed `/api/v1/auth/me`,
   * got `authenticated:false` (no cookie), and the auth guard bounced back to
   * `/login` — which the IdP silently re-authorized — producing an infinite
   * ping-pong on mobile. Setting the cookie regardless of status lets `/me`
   * report `authenticated:true` + the real `status`, so the SPA renders the
   * static Pending/Rejected screen instead of looping.
   */
  async function mintSessionCookie(
    c: Context,
    claims: { sub: string; name?: string; email?: string },
  ): Promise<void> {
    const sessionToken = await signSession(claims, {
      sessionSecret: auth.sessionSecret,
      ttlSeconds: auth.sessionTtlSeconds,
      now: nowFn(),
    });
    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      ...sessionCookieAttributes(auth),
      maxAge: auth.sessionTtlSeconds,
    });
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

    // `prompt=login` forces the IdP to RE-AUTHENTICATE rather than reuse an
    // active SSO session. Only `login` is whitelisted: the sentropic IdP's
    // authorize-handler honours `login`/`none`/`consent` but IGNORES
    // `select_account` (it has no account-chooser screen), and `none` must not
    // be smuggled in to silently bypass the re-auth. So we forward `login` and
    // drop anything else. The invitation sas (`/enroll`) and logout-then-
    // reconnect both arrive here with `?prompt=login`: even after radar's own
    // cookie is gone, without this the IdP would silently re-issue a token for
    // whoever is still signed in there.
    const requestedPrompt = c.req.query("prompt");
    const prompt = requestedPrompt === "login" ? "login" : undefined;

    return c.redirect(
      buildAuthorizeUrl(auth, discovery, flow, prompt ? { prompt } : {}),
      302,
    );
  });

  // Entrée d'un lien d'invitation. SÉCURITÉ : un lien d'invitation ne doit
  // JAMAIS réutiliser une session existante ni en créer une sans passer par
  // l'IdP. Le lien (mailer) pointe ici ; on DÉTRUIT toute session courante puis
  // on renvoie vers `/login` (flux OIDC device sur l'IdP sentropic). Ainsi
  // l'invité s'authentifie réellement (enrôlement device requis), et c'est le
  // callback OIDC — pas le clic sur le lien — qui décide approved/pending via
  // l'invitation. Sans ce sas, cliquer le lien chargeait directement le SPA qui
  // s'appuyait sur le cookie résiduel (p.ex. une session admin), accordant un
  // accès non authentifié (la faille rapportée).
  app.get("/api/v1/auth/enroll", (c) => {
    if (!auth.enabled) return c.json({ error: "auth_disabled" }, 503);
    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieAttributes(auth));
    // `prompt=login` is REQUIRED here: destroying radar's own cookie is not
    // enough if the IdP still holds an SSO session (e.g. a residual admin).
    // Forcing re-authentication guarantees the invitee proves their identity on
    // the IdP (device challenge) instead of silently riding the last user's
    // IdP session — the reported "invite link → logged in as admin" leak.
    return c.redirect("/api/v1/auth/login?prompt=login", 302);
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

    // Claims carried in the RP session cookie. Built once and reused for both
    // the success path and the not-yet-approved paths (so the cookie is always
    // set — see mintSessionCookie's note on the ping-pong bug).
    const sessionClaims = {
      sub: user.sub,
      ...(user.name !== undefined ? { name: user.name } : {}),
      ...(user.email !== undefined ? { email: user.email } : {}),
    };

    // Enrollment: create or look up the account when DB is available.
    // When db is absent (tests without DB), skip enrollment (fail-open).
    if (options.db) {
      const existing = await options.db
        .select()
        .from(accountUsers)
        .where(eq(accountUsers.sub, user.sub))
        .limit(1);

      if (existing.length === 0) {
        // First login: create account. Auto-approve for the designated admin
        // or for users with a pending invitation matching their email.
        const isAdmin = user.email === "admin@sent-tech.ca";

        // Check invitation by email
        let hasInvitation = false;
        if (!isAdmin && user.email) {
          const invitations = await options.db
            .select()
            .from(accountInvitations)
            .where(eq(accountInvitations.email, user.email))
            .limit(1);
          hasInvitation = invitations.some((inv) => inv.status === "pending");

          if (hasInvitation) {
            // Mark invitation as accepted
            await options.db
              .update(accountInvitations)
              .set({ status: "accepted", acceptedAt: new Date(nowFn()) })
              .where(eq(accountInvitations.email, user.email));
          }
        }

        const autoApproved = isAdmin || hasInvitation;
        await options.db.insert(accountUsers).values({
          sub: user.sub,
          email: user.email ?? null,
          name: user.name ?? null,
          status: autoApproved ? "approved" : "pending",
          isAdmin,
          ...(autoApproved ? { approvedAt: new Date(nowFn()), approvedBy: "invitation" } : {}),
        });
        if (!autoApproved) {
          // Set the session cookie BEFORE redirecting so the SPA's /me probe
          // recognises the user (status:pending) and renders PendingView.
          await mintSessionCookie(c, sessionClaims);
          return c.redirect(`${auth.appBaseUrl}/pending`, 302);
        }
      } else {
        const account = existing[0]!;

        if (account.status !== "approved") {
          // A pending invitation for this email is an explicit admin decision
          // and PRIMES over any non-approved status — including
          // `rejected`/`suspended`. Without this, a stale negative
          // `account_users.status` would shadow a fresh invitation (the login
          // reads account status, not the invitation), so the invitee would
          // land on /rejected despite being re-invited.
          let hasInvitation = false;
          if (user.email) {
            const invitations = await options.db
              .select()
              .from(accountInvitations)
              .where(eq(accountInvitations.email, user.email))
              .limit(1);
            hasInvitation = invitations.some((inv) => inv.status === "pending");
          }

          if (hasInvitation && user.email) {
            const now = new Date(nowFn());
            await options.db
              .update(accountUsers)
              .set({ status: "approved", approvedAt: now, approvedBy: "invitation" })
              .where(eq(accountUsers.sub, user.sub));
            await options.db
              .update(accountInvitations)
              .set({ status: "accepted", acceptedAt: now })
              .where(eq(accountInvitations.email, user.email));
            // continue to session minting (approved)
          } else if (account.status === "pending" || account.status === "invited") {
            await mintSessionCookie(c, sessionClaims);
            return c.redirect(`${auth.appBaseUrl}/pending`, 302);
          } else {
            // rejected / suspended (or any other non-approved status) and no
            // pending invitation: keep the negative status. This MUST NOT depend
            // on `user.email` — an emailless token must never bypass the gate.
            await mintSessionCookie(c, sessionClaims);
            return c.redirect(`${auth.appBaseUrl}/rejected`, 302);
          }
        }
      }
    }

    // Approved user (or DB-less fail-open path): set the session and land home.
    await mintSessionCookie(c, sessionClaims);
    return c.redirect(auth.appBaseUrl || "/", 302);
  });

  app.get("/api/v1/auth/logout", (c) => {
    // Efface le cookie de session avec EXACTEMENT les mêmes attributs que ceux
    // posés par `mintSessionCookie` (httpOnly/secure/sameSite/path). Le
    // navigateur n'applique un `Set-Cookie` de suppression que s'il cible le
    // même cookie (name + path + domain, secure/sameSite alignés sur les
    // navigateurs stricts) ; le moindre écart laisse la session vivante — d'où
    // « reconnect = compte précédent » et « encore logué après vidage du store
    // F12 » (le store F12 = localStorage, PAS ce cookie HttpOnly).
    //
    // NB — PAS de RP-initiated logout (OIDC end-session) : l'IdP sentropic
    // N'EXPOSE PAS d'`end_session_endpoint` (ni annoncé dans la discovery, ni
    // existant dans son code). Son seul logout est `DELETE /api/v1/auth/session`
    // (révoque la session + efface le cookie SSO host-only `session`), une route
    // fetch MÊME-ORIGINE non navigable cross-site : radar (immo.sent-tech.ca) ne
    // peut donc PAS détruire la session SSO de l'IdP (auth.sent-tech.ca). On
    // n'efface QUE le cookie radar. Le réemploi de la session SSO de l'IdP est
    // atténué en aval, à la reconnexion, via `prompt=login` sur l'authorize (cf.
    // /login + auth-store.ts) — la SEULE valeur `prompt` honorée par l'IdP, qui
    // force le ré-affichage du login. LIMITE : sans destruction du cookie SSO,
    // ça ne permet pas encore de CHANGER d'identité (l'IdP n'a pas de sélecteur
    // de comptes) — un vrai switch dépend d'une évolution IdP (cf. rapport auth).
    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieAttributes(auth));
    if (isBrowserNavigation(c.req.header("accept"))) {
      return c.redirect(auth.appBaseUrl || "/", 302);
    }
    return c.json({ ok: true });
  });

  app.get("/api/v1/auth/me", async (c) => {
    // The session probe MUST never be cached: a cached `/me` would let the
    // browser (HTTP cache / bfcache) or any intermediary replay a stale user
    // identity after a logout/reconnect — the "reconnect lands on the previous
    // user" symptom. `no-store` forbids any storage of the response.
    c.header("Cache-Control", "no-store");
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

    // Enrich with account status if DB is available.
    let status: string | undefined;
    let isAdmin: boolean | undefined;
    if (options.db) {
      const rows = await options.db
        .select()
        .from(accountUsers)
        .where(eq(accountUsers.sub, session.sub))
        .limit(1);
      if (rows.length > 0) {
        status = rows[0]!.status;
        isAdmin = rows[0]!.isAdmin;
      }
    }

    return c.json({
      authenticated: true,
      user: {
        sub: session.sub,
        ...(session.name !== undefined ? { name: session.name } : {}),
        ...(session.email !== undefined ? { email: session.email } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(isAdmin !== undefined ? { isAdmin } : {}),
      },
    });
  });

  return app;
}

/** Path prefixes that stay public even when auth is enabled. */
const PUBLIC_PREFIXES = [
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/enroll",
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
  options: { now?: () => number; db?: Database } = {},
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

    if (options.db) {
      const rows = await options.db
        .select()
        .from(accountUsers)
        .where(eq(accountUsers.sub, session.sub))
        .limit(1);
      if (rows.length > 0 && rows[0]!.status !== "approved") {
        return c.json(
          {
            error: "account_not_approved",
            status: rows[0]!.status,
          },
          403,
        );
      }
    }

    c.set("session" as never, session as never);
    return next();
  };
}

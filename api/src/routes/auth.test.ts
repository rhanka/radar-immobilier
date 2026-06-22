import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { authRoute, protect } from "./auth.js";
import type { AuthConfig } from "../config.js";
import type { OidcDiscovery, FetchLike } from "../services/auth/oidc.js";
import { signSession } from "../services/auth/session.js";

const AUTH_ON: AuthConfig = {
  enabled: true,
  issuer: "https://auth.example.test",
  clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://immo.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email",
  appBaseUrl: "https://immo.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!",
  sessionTtlSeconds: 3600,
};

const AUTH_OFF: AuthConfig = { ...AUTH_ON, enabled: false };

const DISCOVERY: OidcDiscovery = {
  issuer: AUTH_ON.issuer,
  authorization_endpoint: `${AUTH_ON.issuer}/api/v1/auth/oauth/authorize`,
  token_endpoint: `${AUTH_ON.issuer}/api/v1/auth/oauth/token`,
  jwks_uri: `${AUTH_ON.issuer}/.well-known/jwks.json`,
};

/** Pull the value of a Set-Cookie header for a given cookie name. */
function readSetCookie(res: Response, name: string): string | undefined {
  const all = res.headers.get("set-cookie") ?? "";
  const match = all.split(/,(?=[^;]+?=)/).find((c) => c.trim().startsWith(name + "="));
  if (!match) return undefined;
  return match.trim().split(";")[0]!.split("=").slice(1).join("=");
}

/**
 * Serialize a flow object into a Cookie header value the way the browser sends
 * it back: hono's setCookie URL-encodes the value, so we mirror that here
 * (the raw JSON contains `,` / `=` / `{}` which would otherwise corrupt the
 * Cookie header).
 */
function flowCookie(flow: {
  state: string;
  nonce: string;
  codeVerifier: string;
}): string {
  return `radar_oauth_flow=${encodeURIComponent(JSON.stringify(flow))}`;
}

async function makeIdToken(opts: {
  nonce: string;
  sub: string;
  name?: string;
  email?: string;
}): Promise<{ idToken: string; getKey: JWTVerifyGetKey }> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
  });
  const pubJwk: JWK = await exportJWK(publicKey);
  pubJwk.kid = "k1";
  pubJwk.alg = "EdDSA";
  const getKey = createLocalJWKSet({ keys: [pubJwk] });
  const idToken = await new SignJWT({
    nonce: opts.nonce,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.email !== undefined ? { email: opts.email } : {}),
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuer(AUTH_ON.issuer)
    .setAudience(AUTH_ON.clientId)
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return { idToken, getKey };
}

describe("auth routes — disabled mode", () => {
  it("/login returns 503 when auth is disabled", async () => {
    const app = authRoute(AUTH_OFF);
    const res = await app.request("/api/v1/auth/login");
    expect(res.status).toBe(503);
  });

  it("/me reports authDisabled when disabled", async () => {
    const app = authRoute(AUTH_OFF);
    const res = await app.request("/api/v1/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authenticated: false,
      authDisabled: true,
    });
  });
});

describe("GET /api/v1/auth/login", () => {
  it("redirects to the IdP authorize endpoint and sets a flow cookie", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith(DISCOVERY.authorization_endpoint)).toBe(true);
    const url = new URL(loc);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe(AUTH_ON.clientId);
    expect(readSetCookie(res, "radar_oauth_flow")).toBeTruthy();
  });

  it("does NOT force re-auth by default (SSO reuse allowed for first login)", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login");
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("forwards prompt=login to the IdP so it RE-AUTHENTICATES (kills SSO reuse)", async () => {
    // The reported symptom "logout → reconnect = previous user" and "invite
    // link → residual admin" both stem from the IdP silently re-authorizing its
    // own SSO session. `?prompt=login` (set by /enroll and the SPA login button)
    // must reach the IdP authorize endpoint to force a fresh authentication.
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login?prompt=login");
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("login");
  });

  it("forwards prompt=select_account to the IdP so the user can SWITCH account", async () => {
    // The REAL reported symptom: "logout → reconnect lands me back on the
    // previous account and I cannot switch / cannot pick another one".
    // `prompt=login` only re-prompts the password OF THE SAME SSO account;
    // `prompt=select_account` opens the IdP account chooser, which is the only
    // way to change identity (the IdP exposes no end_session_endpoint, so a
    // standard RP-initiated logout is not available — this is the sole lever).
    // The SPA login button now sends this value; the route must pass it through.
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login?prompt=select_account");
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("whitelists prompt: an attacker cannot smuggle prompt=none to bypass re-auth", async () => {
    // prompt=none would tell the IdP to NEVER show a login UI (silent auth),
    // which is the opposite of what we want here. Only login/select_account are
    // honoured; anything else is dropped (no prompt => default IdP behaviour).
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login?prompt=none");
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBeNull();
  });
});

describe("GET /api/v1/auth/oauth/callback", () => {
  it("completes the flow: exchanges code, verifies id_token, sets session", async () => {
    const { idToken, getKey } = await makeIdToken({
      nonce: "NONCE",
      sub: "user-1",
      name: "Alice",
      email: "alice@example.test",
    });
    const fetchImpl: FetchLike = async (url) => {
      if (url === DISCOVERY.token_endpoint) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id_token: idToken }),
          text: async () => "",
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, fetchImpl, getKey });

    // Forge a flow cookie matching the state/nonce the callback expects.
    const flow = { state: "STATE", nonce: "NONCE", codeVerifier: "VERIFIER" };
    const res = await app.request(
      "/api/v1/auth/oauth/callback?code=CODE&state=STATE",
      { headers: { cookie: flowCookie(flow) } },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("rejects a state mismatch", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const flow = { state: "REAL", nonce: "N", codeVerifier: "V" };
    const res = await app.request(
      "/api/v1/auth/oauth/callback?code=CODE&state=FORGED",
      { headers: { cookie: flowCookie(flow) } },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("state_mismatch");
  });

  it("rejects when the flow cookie is missing", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request(
      "/api/v1/auth/oauth/callback?code=CODE&state=STATE",
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_flow_state");
  });

  it("rejects an id_token with a bad nonce (replay protection)", async () => {
    const { idToken, getKey } = await makeIdToken({
      nonce: "SERVER-NONCE",
      sub: "user-1",
    });
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id_token: idToken }),
      text: async () => "",
    });
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, fetchImpl, getKey });
    const flow = { state: "S", nonce: "CLIENT-NONCE", codeVerifier: "V" };
    const res = await app.request(
      "/api/v1/auth/oauth/callback?code=CODE&state=S",
      { headers: { cookie: flowCookie(flow) } },
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("id_token_invalid");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns authenticated:false without a session", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/me");
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("sets Cache-Control: no-store so a stale identity is never replayed", async () => {
    // A cached /me would let the browser/bfcache resurrect the previous user
    // after a logout/reconnect — the "reconnect = previous user" symptom. The
    // probe must be uncacheable, with or without a session.
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/me");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const token = await signSession(
      { sub: "user-9", name: "Carol" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const res2 = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res2.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the user when a valid session cookie is present", async () => {
    const token = await signSession(
      { sub: "user-9", name: "Carol" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.sub).toBe("user-9");
    expect(body.user.name).toBe("Carol");
  });

  it("never invents isAdmin: a session without a matching DB account is NOT admin", async () => {
    // Guard against "logged in as admin without enrollment": admin is only ever
    // sourced from account_users.isAdmin in the DB. A valid session with no DB
    // row (or a non-admin row) must report no admin flag.
    const token = await signSession(
      { sub: "ghost", email: "fabien.antoine@gmail.com" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const db = makeEnrollmentDb([]) as unknown as import("../db/client.js").Database;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, db });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.isAdmin).toBeUndefined();
    expect(body.user.status).toBeUndefined();
  });
});

describe("GET /api/v1/auth/logout", () => {
  /** Full Set-Cookie segment (name + attributes) for a given cookie name. */
  function readSetCookieRaw(res: Response, name: string): string | undefined {
    const all = res.headers.get("set-cookie") ?? "";
    return all
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.trim())
      .find((c) => c.startsWith(name + "="));
  }

  it("clears the session cookie (Max-Age=0, Path=/)", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/logout");
    const raw = readSetCookieRaw(res, "radar_session");
    expect(raw).toBeTruthy();
    // The delete cookie must blank the value and expire immediately, on the
    // same Path as the cookie minted at login — otherwise the browser keeps it.
    expect(raw).toContain("radar_session=;");
    expect(raw).toMatch(/Max-Age=0/i);
    expect(raw).toMatch(/Path=\//);
  });

  it("delete-cookie attributes EXACTLY match the login set-cookie (else the browser keeps the session)", async () => {
    // Forge a login cookie via the OIDC callback, then logout, and compare the
    // attribute tuple (HttpOnly/Secure/SameSite/Path). A mismatch is the root
    // cause of "reconnect lands on the previous user" + "still logged in after
    // wiping the F12 store": the delete Set-Cookie targets a different cookie.
    const { idToken, getKey } = await makeIdToken({ nonce: "N", sub: "user-x" });
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id_token: idToken }),
      text: async () => "",
    });
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, fetchImpl, getKey });
    const flow = { state: "S", nonce: "N", codeVerifier: "V" };
    const setRes = await app.request(
      "/api/v1/auth/oauth/callback?code=C&state=S",
      { headers: { cookie: flowCookie(flow) } },
    );
    const setRaw = readSetCookieRaw(setRes, "radar_session")!;
    const delRaw = readSetCookieRaw(
      await app.request("/api/v1/auth/logout"),
      "radar_session",
    )!;

    // Helper: pull the attribute tokens that identify the cookie to the browser.
    const attrs = (raw: string) =>
      raw
        .split(";")
        .slice(1) // drop "name=value"
        .map((a) => a.trim())
        .filter((a) => /^(HttpOnly|Secure|SameSite|Path|Domain)/i.test(a))
        .map((a) => a.toLowerCase())
        .sort();

    // AUTH_ON.appBaseUrl is https -> Secure must be present on BOTH.
    expect(setRaw).toMatch(/Secure/i);
    expect(setRaw).toMatch(/HttpOnly/i);
    // The delete cookie must carry the SAME identity attributes as the set one.
    expect(attrs(delRaw)).toEqual(attrs(setRaw));
  });

  it("after logout, /me reports authenticated:false (session no longer accepted)", async () => {
    // Even if the browser somehow replayed the old token, /me must not honour a
    // logged-out session in the real flow: the cookie is gone client-side. Here
    // we assert the contract end-to-end — no cookie => authenticated:false.
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    await app.request("/api/v1/auth/logout");
    const me = await app.request("/api/v1/auth/me");
    expect(await me.json()).toEqual({ authenticated: false });
  });

  it("logout omits Secure when the app origin is http (dev), matching mint", async () => {
    const httpAuth: AuthConfig = { ...AUTH_ON, appBaseUrl: "http://localhost:5173" };
    const app = authRoute(httpAuth, { discovery: DISCOVERY });
    const raw = readSetCookieRaw(
      await app.request("/api/v1/auth/logout"),
      "radar_session",
    )!;
    expect(raw).not.toMatch(/Secure/i);
    expect(raw).toMatch(/HttpOnly/i);
  });

  it("redirects a browser navigation home", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/logout", {
      headers: { accept: "text/html" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
  });

  it("returns JSON {ok:true} for an XHR/fetch call", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/logout", {
      headers: { accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/v1/auth/enroll (invitation sas — no session without IdP)", () => {
  /** Full Set-Cookie segment (name + attributes) for a given cookie name. */
  function readSetCookieRaw(res: Response, name: string): string | undefined {
    const all = res.headers.get("set-cookie") ?? "";
    return all
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.trim())
      .find((c) => c.startsWith(name + "="));
  }

  it("does NOT mint a session and redirects to the IdP login flow (forcing re-auth)", async () => {
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/enroll?token=inv-tok");
    expect(res.status).toBe(302);
    // Must bounce to the real auth flow (which goes to the IdP), never grant
    // access on its own. No `radar_session` with a real value is ever set.
    // `prompt=login` is REQUIRED so the IdP re-authenticates (device challenge)
    // instead of silently reusing a residual SSO session.
    expect(res.headers.get("location")).toBe("/api/v1/auth/login?prompt=login");
    const raw = readSetCookieRaw(res, "radar_session");
    // The only Set-Cookie allowed is a DELETE (blank value, Max-Age=0).
    if (raw) {
      expect(raw).toContain("radar_session=;");
      expect(raw).toMatch(/Max-Age=0/i);
    }
  });

  it("DESTROYS an existing session so an invite link never reuses it (the reported admin leak)", async () => {
    // Scenario: a stale admin session cookie is present (e.g. the device was
    // previously logged in as admin). Clicking an invitation link MUST NOT land
    // that admin straight into the app — it must wipe the session and force a
    // fresh IdP authentication.
    const adminToken = await signSession(
      { sub: "admin-sub", email: "admin@sent-tech.ca" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/enroll?token=inv-tok", {
      headers: { cookie: `radar_session=${adminToken}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/v1/auth/login?prompt=login");
    // The residual session cookie is explicitly deleted.
    const raw = readSetCookieRaw(res, "radar_session")!;
    expect(raw).toContain("radar_session=;");
    expect(raw).toMatch(/Max-Age=0/i);
    expect(raw).toMatch(/Path=\//);
  });

  it("returns 503 when auth is disabled (no session granting in open mode)", async () => {
    const app = authRoute(AUTH_OFF);
    const res = await app.request("/api/v1/auth/enroll?token=inv-tok");
    expect(res.status).toBe(503);
  });
});

describe("secure session lifecycle — the reported symptoms end-to-end", () => {
  /** Full Set-Cookie segment (name + attributes) for a given cookie name. */
  function readSetCookieRaw(res: Response, name: string): string | undefined {
    const all = res.headers.get("set-cookie") ?? "";
    return all
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.trim())
      .find((c) => c.startsWith(name + "="));
  }

  it("SYMPTOM A — logout then reconnect cannot land on the previous user", async () => {
    // 1) A user is logged in (valid session cookie present).
    const prevUser = await signSession(
      { sub: "previous-user", email: "prev@example.com" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });

    // 2) Logout deletes the cookie with the exact mint attributes.
    const logout = await app.request("/api/v1/auth/logout");
    const delRaw = readSetCookieRaw(logout, "radar_session")!;
    expect(delRaw).toContain("radar_session=;");
    expect(delRaw).toMatch(/Max-Age=0/i);

    // 3) /me WITHOUT a cookie => authenticated:false (the browser dropped it).
    const meAfterLogout = await app.request("/api/v1/auth/me");
    expect(await meAfterLogout.json()).toEqual({ authenticated: false });
    expect(meAfterLogout.headers.get("cache-control")).toBe("no-store");

    // 4) Reconnect via the explicit login button => prompt=select_account
    //    reaches the IdP, opening the account chooser so the user can SWITCH
    //    account (the real symptom: "reconnect puts me back on the previous
    //    account and I can't pick another"). `prompt=login` only re-prompted the
    //    SAME account's password; `select_account` is what lets the user change
    //    identity. Even if the OLD cookie somehow lingered (replayed below), the
    //    login flow does not depend on it — it goes to the IdP account chooser.
    const reconnect = await app.request(
      "/api/v1/auth/login?prompt=select_account",
      { headers: { cookie: `radar_session=${prevUser}` } },
    );
    const url = new URL(reconnect.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
  });

  it("SYMPTOM B — an invite link with a residual admin cookie forces IdP re-auth and grants nothing", async () => {
    // A stale ADMIN session cookie is present on the device.
    const adminToken = await signSession(
      { sub: "admin-sub", email: "admin@sent-tech.ca" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });

    // Clicking the invitation link (the API sas) must: destroy the session AND
    // bounce to /login with prompt=login (no app access, no session reuse).
    const enroll = await app.request("/api/v1/auth/enroll?token=inv-tok", {
      headers: { cookie: `radar_session=${adminToken}` },
    });
    expect(enroll.status).toBe(302);
    expect(enroll.headers.get("location")).toBe("/api/v1/auth/login?prompt=login");
    const del = readSetCookieRaw(enroll, "radar_session")!;
    expect(del).toContain("radar_session=;");
    expect(del).toMatch(/Max-Age=0/i);

    // Following that redirect to /login (still carrying the residual admin
    // cookie, as a browser would until it processes the delete) reaches the IdP
    // with prompt=login — the IdP re-authenticates; the residual admin SSO
    // session can NOT be silently reused.
    const login = await app.request("/api/v1/auth/login?prompt=login", {
      headers: { cookie: `radar_session=${adminToken}` },
    });
    const url = new URL(login.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    // No NEW session cookie is minted by /login (only the transient flow cookie).
    expect(readSetCookie(login, "radar_session")).toBeFalsy();
  });
});

describe("protect middleware", () => {
  function appWith(
    auth: AuthConfig,
    db?: import("../db/client.js").Database,
  ): Hono {
    const app = new Hono();
    app.use("*", protect(auth, db ? { db } : {}));
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/api/protected", (c) => c.json({ secret: true }));
    return app;
  }

  it("is a no-op when auth is disabled", async () => {
    const app = appWith(AUTH_OFF);
    const res = await app.request("/api/protected");
    expect(res.status).toBe(200);
    expect((await res.json()).secret).toBe(true);
  });

  it("lets /health through even when auth is enabled", async () => {
    const app = appWith(AUTH_ON);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("blocks a protected route with 401 (JSON/XHR) when no session", async () => {
    const app = appWith(AUTH_ON);
    const res = await app.request("/api/protected");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("redirects a browser navigation to /login when no session", async () => {
    const app = appWith(AUTH_ON);
    const res = await app.request("/api/protected", {
      headers: { accept: "text/html" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/v1/auth/login");
  });

  it("allows a protected route with a valid session cookie", async () => {
    const token = await signSession(
      { sub: "user-1" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const app = appWith(AUTH_ON);
    const res = await app.request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).secret).toBe(true);
  });

  it("blocks a protected route with an expired session", async () => {
    const token = await signSession(
      { sub: "user-1" },
      {
        sessionSecret: AUTH_ON.sessionSecret,
        ttlSeconds: 60,
        now: 1_000_000_000_000,
      },
    );
    const app = new Hono();
    app.use("*", protect(AUTH_ON, { now: () => 1_000_000_000_000 + 120_000 }));
    app.get("/api/protected", (c) => c.json({ secret: true }));
    const res = await app.request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("blocks a protected route when the DB account is suspended", async () => {
    const token = await signSession(
      { sub: "user-1" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const db = makeEnrollmentDb([
      { sub: "user-1", status: "suspended", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = appWith(AUTH_ON, db);
    const res = await app.request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "account_not_approved",
      status: "suspended",
    });
  });
});

// ── Enrollment tests (DB mock) ──────────────────────────────────────────────

/**
 * Extract the field name + comparison value from a drizzle eq() result.
 * The queryChunks array contains:
 *   - a column chunk (has 'columnType' and 'name')
 *   - a value/param chunk (has 'value' as a non-array string)
 */
function parseEqFilter(filter: unknown): { field: string; value: string } | null {
  if (!filter || typeof filter !== "object") return null;
  const chunks: unknown[] = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
  const fieldChunk = chunks.find(
    (c) =>
      c &&
      typeof c === "object" &&
      "name" in (c as object) &&
      "columnType" in (c as object),
  ) as { name: string } | undefined;
  const valueChunk = chunks.find(
    (c) =>
      c &&
      typeof c === "object" &&
      "value" in (c as object) &&
      typeof (c as { value: unknown }).value === "string",
  ) as { value: string } | undefined;
  if (!fieldChunk || !valueChunk) return null;
  return { field: fieldChunk.name, value: valueChunk.value };
}

/**
 * Minimal in-memory DB mock for enrollment tests.
 * Discriminates `account_users` vs `account_invitations` by the drizzle table
 * name so the callback's invitation lookup/acceptance can be exercised.
 */
function makeEnrollmentDb(
  initialUsers: { sub: string; email?: string; status: string; isAdmin: boolean }[] = [],
  initialInvitations: { email: string; status: string }[] = [],
) {
  const users = [...initialUsers] as Record<string, unknown>[];
  const invitations = [...initialInvitations] as Record<string, unknown>[];
  const inserted: { sub: string; status: string; isAdmin: boolean }[] = [];
  const updates: { table: string; field: string; value: string; set: Record<string, unknown> }[] = [];

  const tableNameOf = (table: unknown): string | null =>
    table &&
    typeof table === "object" &&
    Symbol.for("drizzle:Name") in (table as object)
      ? ((table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] as string)
      : null;
  const collectionFor = (table: unknown): Record<string, unknown>[] =>
    tableNameOf(table) === "account_invitations" ? invitations : users;
  // The last table passed to update().set().where() — set on the from-step.
  let pendingUpdateTable: string | null = null;

  return {
    _users: users,
    _invitations: invitations,
    _inserted: inserted,
    _updates: updates,
    select: () => ({
      from: (table: unknown) => {
        const collection = collectionFor(table);
        return {
          where: (filter: unknown) => ({
            limit: (n: number) => {
              const parsed = parseEqFilter(filter);
              if (!parsed) return Promise.resolve(collection.slice(0, n));
              return Promise.resolve(
                collection
                  .filter((u) => u[parsed.field] === parsed.value)
                  .slice(0, n),
              );
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        collectionFor(table).push(vals);
        if (tableNameOf(table) !== "account_invitations") {
          inserted.push(vals as unknown as { sub: string; status: string; isAdmin: boolean });
        }
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => {
      pendingUpdateTable = tableNameOf(table);
      return {
        set: (set: Record<string, unknown>) => ({
          where: (filter: unknown) => {
            const parsed = parseEqFilter(filter);
            const tableName = pendingUpdateTable ?? "account_users";
            const collection =
              tableName === "account_invitations" ? invitations : users;
            if (parsed) {
              updates.push({ table: tableName, ...parsed, set });
              for (const row of collection) {
                if (row[parsed.field] === parsed.value) Object.assign(row, set);
              }
            }
            return Promise.resolve();
          },
        }),
      };
    },
  };
}

describe("enrollment — OIDC callback with DB", () => {
  async function makeCallback(opts: {
    sub: string;
    email?: string;
    existingUsers?: { sub: string; email?: string; status: string; isAdmin: boolean }[];
    existingInvitations?: { email: string; status: string }[];
  }) {
    const { idToken, getKey } = await makeIdToken({
      nonce: "NONCE",
      sub: opts.sub,
      ...(opts.email !== undefined ? { email: opts.email } : {}),
    });
    const fetchImpl: FetchLike = async (url) => {
      if (url === DISCOVERY.token_endpoint) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id_token: idToken }),
          text: async () => "",
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const dbMock = makeEnrollmentDb(opts.existingUsers ?? [], opts.existingInvitations ?? []);
    const db = dbMock as unknown as import("../db/client.js").Database;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, fetchImpl, getKey, db });
    const flow = { state: "STATE", nonce: "NONCE", codeVerifier: "VERIFIER" };
    const res = await app.request(
      "/api/v1/auth/oauth/callback?code=CODE&state=STATE",
      { headers: { cookie: flowCookie(flow) } },
    );
    return { res, db, dbMock };
  }

  it("new non-admin user is redirected to /pending WITH a session cookie", async () => {
    const { res } = await makeCallback({ sub: "new-user", email: "new@example.com" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/pending`);
    // Regression guard for the mobile ping-pong: the session cookie MUST be set
    // even for a pending user, so the SPA's /me probe sees authenticated:true
    // (status:pending) and renders PendingView instead of bouncing to /login.
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("admin@sent-tech.ca is approved and redirected to app", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "admin-sub",
      email: "admin@sent-tech.ca",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    // The inserted record should be approved
    const inserted = dbMock._inserted;
    expect(inserted.length).toBe(1);
    expect(inserted[0]!.status).toBe("approved");
    expect(inserted[0]!.isAdmin).toBe(true);
  });

  it("existing pending user is redirected to /pending WITH a session cookie", async () => {
    const { res } = await makeCallback({
      sub: "pending-user",
      existingUsers: [{ sub: "pending-user", status: "pending", isAdmin: false }],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/pending`);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("existing approved user gets a session and is redirected to app", async () => {
    const { res } = await makeCallback({
      sub: "approved-user",
      existingUsers: [{ sub: "approved-user", status: "approved", isAdmin: false }],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("existing suspended user is redirected to /rejected WITH a session cookie", async () => {
    const { res } = await makeCallback({
      sub: "suspended-user",
      existingUsers: [{ sub: "suspended-user", status: "suspended", isAdmin: false }],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/rejected`);
    // The session cookie is now set even for non-approved users so the SPA can
    // resolve /me to authenticated:true (status:suspended) and render the
    // static RejectedView — `protect` still 403s every protected API route, so
    // setting the cookie does NOT grant access; it only stops the ping-pong.
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("rejected user WITH a pending invitation is re-approved and lands on the app", async () => {
    // Bug prod (fabien.antoine@gmail.com) : un compte 'rejected' réinvité voyait
    // « refusé » au login car le callback ne consultait l'invitation que pour
    // les statuts pending/invited. L'invitation pending doit PRIMER.
    const { res, dbMock } = await makeCallback({
      sub: "rejected-then-reinvited",
      email: "comeback@example.com",
      existingUsers: [
        {
          sub: "rejected-then-reinvited",
          email: "comeback@example.com",
          status: "rejected",
          isAdmin: false,
        },
      ],
      existingInvitations: [{ email: "comeback@example.com", status: "pending" }],
    });
    // Accès accordé : redirigé vers l'app, pas vers /rejected.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();

    // Le compte est passé 'approved' via le flux invitation.
    const userUpdate = dbMock._updates.find(
      (u) => u.table === "account_users" && u.value === "rejected-then-reinvited",
    );
    expect(userUpdate).toBeDefined();
    expect(userUpdate!.set).toMatchObject({ status: "approved", approvedBy: "invitation" });
    expect((dbMock._users[0] as { status: string }).status).toBe("approved");

    // L'invitation est marquée 'accepted'.
    const invUpdate = dbMock._updates.find((u) => u.table === "account_invitations");
    expect(invUpdate).toBeDefined();
    expect(invUpdate!.set).toMatchObject({ status: "accepted" });
  });

  it("rejected user WITHOUT a pending invitation still lands on /rejected", async () => {
    const { res } = await makeCallback({
      sub: "stays-rejected",
      email: "nope@example.com",
      existingUsers: [
        { sub: "stays-rejected", email: "nope@example.com", status: "rejected", isAdmin: false },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/rejected`);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });
});

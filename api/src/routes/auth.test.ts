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
import { authRoute, protect, pickValidInvitation, resolveGraphSignalsViewer } from "./auth.js";
import { strictReceiverTestAuth, strictReceiverTestConfig } from "../artifacts/strict-receiver.js";
import { loadConfig, resolveAuthConfig, type AuthConfig } from "../config.js";
import type { OidcDiscovery, FetchLike } from "../services/auth/oidc.js";
import { signSession, verifySession } from "../services/auth/session.js";

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
  sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://immo.example.test", "https://immo.example.test/mcp"],
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

  it("DROPS prompt=select_account (the sentropic IdP ignores it — verified)", async () => {
    // The REAL reported symptom: "logout → reconnect lands me back on the
    // previous account and I cannot switch". A prior fix sent
    // `prompt=select_account`, but the sentropic IdP's authorize-handler does
    // not implement it (no account-chooser screen): the value is silently
    // ignored, so forwarding it is a no-op that masked the bug. The route now
    // only forwards `prompt=login` (the sole value the IdP honours) and DROPS
    // `select_account`. Reproduced live: the IdP's signed `continue` blob never
    // carries `prompt`. Full account-switch requires an IdP change.
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY });
    const res = await app.request("/api/v1/auth/login?prompt=select_account");
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("whitelists prompt: an attacker cannot smuggle prompt=none to bypass re-auth", async () => {
    // prompt=none would tell the IdP to NEVER show a login UI (silent auth),
    // which is the opposite of what we want here. Only `login` is honoured;
    // anything else is dropped (no prompt => default IdP behaviour).
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

  it("never invents isAdmin: a session without a matching DB account is 403, never admin", async () => {
    // Guard against "logged in as admin without enrollment": admin is only ever
    // sourced from account_users.isAdmin in the DB. A valid session with no DB
    // row is treated as not approved (403, same body as other status refusals).
    const token = await signSession(
      { sub: "ghost", email: "fabien.antoine@gmail.com" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
    const db = makeEnrollmentDb([]) as unknown as import("../db/client.js").Database;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, db });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "account_not_approved",
      status: "unknown",
    });
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

    // 4) Reconnect via the explicit login button => prompt=login reaches the
    //    IdP, forcing it to RE-DISPLAY the login instead of silently re-issuing
    //    a token for the SSO session in place (the real symptom: "reconnect puts
    //    me back on the previous account"). `prompt=login` is the ONLY value the
    //    sentropic IdP honours — `select_account` is silently ignored (no
    //    account-chooser), which is why the prior fix was a no-op. Even if the
    //    OLD cookie lingered (replayed below), the login flow does not depend on
    //    it — it goes to the IdP. NOTE: re-displaying the login does not yet let
    //    the user pick a DIFFERENT account while the IdP SSO cookie lives; a
    //    full switch requires destroying that cookie (IdP-side change).
    const reconnect = await app.request("/api/v1/auth/login?prompt=login", {
      headers: { cookie: `radar_session=${prevUser}` },
    });
    const url = new URL(reconnect.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("login");
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
    bearerGetKey?: JWTVerifyGetKey,
  ): Hono {
    const app = new Hono();
    app.use(
      "*",
      protect(auth, {
        ...(db ? { db } : {}),
        ...(bearerGetKey ? { bearerGetKey } : {}),
      }),
    );
    app.get("/livez", (c) => c.json({ status: "ok" }));
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/api/protected", (c) => c.json({ secret: true }));
    app.get("/api/geo/collections/:id/items", (c) => c.json({ type: "FeatureCollection" }));
    app.get("/api/documents/raw", (c) => c.json({ ok: true }));
    app.get("/api/graph-signals/:city", (c) => c.json({ ok: true, nodes: [] }));
    return app;
  }

  // D4 (per-user auth): the graph-signals feed is NOT public — the MCP must
  // present the user's own identity. Kept protected on purpose.

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

  it("lets /livez through even when auth is enabled (k8s liveness must not 401)", async () => {
    const app = appWith(AUTH_ON);
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
  });

  it("lets the public geo collections passthrough through even when auth is enabled", async () => {
    // Public zonage/lots data consumed server-side by the immo-mcp pod (no
    // session): see PUBLIC_PREFIXES comment in auth.ts.
    const app = appWith(AUTH_ON);
    const res = await app.request("/api/geo/collections/qc-lots-longueuil/items?limit=10");
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe("FeatureCollection");
  });

  it("lets the raw public-document route through even when auth is enabled", async () => {
    const app = appWith(AUTH_ON);
    const res = await app.request(
      "/api/documents/raw?rawRef=raw%2Fproces-verbaux-longueuil%2Fcas%2Fabc.pdf",
    );
    expect(res.status).toBe(200);
  });

  it("keeps /api/graph-signals PROTECTED (401 without session) — per-user auth, D4", async () => {
    // NOT a public prefix: the MCP must serve signals under the real user
    // identity (forwarded user bearer), never anonymously.
    const app = appWith(AUTH_ON);
    const res = await app.request("/api/graph-signals/mont-tremblant");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("does NOT open sibling api routes beyond the public data prefixes", async () => {
    const app = appWith(AUTH_ON);
    // Prefix matching is segment-exact: neither /api/geo nor /api/documents root.
    expect((await app.request("/api/protected")).status).toBe(401);
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

  // ── Per-user IdP bearer (D4, option A): the api accepts the user's OWN token ─
  // The immo-mcp pod forwards it on /api/graph-signals; the api verifies it
  // against OUR IdP JWKS and authorises per-user. NOT a public route.

  /** Sign a USER access token + return the matching local JWKS getter. */
  async function makeAccessToken(opts: {
    sub: string;
    aud?: string | string[];
    iss?: string;
    exp?: number; // epoch seconds (past → expired)
  }): Promise<{ accessToken: string; getKey: JWTVerifyGetKey }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "k1";
    pubJwk.alg = "EdDSA";
    const getKey = createLocalJWKSet({ keys: [pubJwk] });
    const builder = new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer(opts.iss ?? AUTH_ON.issuer)
      .setAudience(opts.aud ?? "https://immo.example.test/mcp")
      .setSubject(opts.sub)
      .setIssuedAt();
    builder.setExpirationTime(opts.exp ?? "5m");
    const accessToken = await builder.sign(privateKey);
    return { accessToken, getKey };
  }

  const approvedDb = () =>
    makeEnrollmentDb([
      { sub: "mcp-user", status: "approved", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;

  it("accepts a valid IdP bearer for an APPROVED user → 200 (per-user)", async () => {
    const { accessToken, getKey } = await makeAccessToken({ sub: "mcp-user" });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("accepts the api-origin audience too (aud allowlist)", async () => {
    const { accessToken, getKey } = await makeAccessToken({
      sub: "mcp-user",
      aud: "https://immo.example.test",
    });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a request with NO bearer and no session → 401", async () => {
    const app = appWith(AUTH_ON, approvedDb());
    const res = await app.request("/api/graph-signals/mont-tremblant");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("rejects an EXPIRED bearer → 401", async () => {
    const { accessToken, getKey } = await makeAccessToken({
      sub: "mcp-user",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a bearer from the WRONG issuer → 401", async () => {
    const { accessToken, getKey } = await makeAccessToken({
      sub: "mcp-user",
      iss: "https://evil.example",
    });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a bearer with the WRONG audience → 401", async () => {
    const { accessToken, getKey } = await makeAccessToken({
      sub: "mcp-user",
      aud: "https://someone-else.example/mcp",
    });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a valid bearer whose signature does not match the JWKS → 401", async () => {
    const { accessToken } = await makeAccessToken({ sub: "mcp-user" });
    // Different keypair than the token was signed with.
    const { getKey } = await makeAccessToken({ sub: "other" });
    const app = appWith(AUTH_ON, approvedDb(), getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a valid bearer for a SUSPENDED user → 403", async () => {
    const { accessToken, getKey } = await makeAccessToken({ sub: "mcp-user" });
    const db = makeEnrollmentDb([
      { sub: "mcp-user", status: "suspended", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = appWith(AUTH_ON, db, getKey);
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("account_not_approved");
  });

  it("rejects a valid bearer for an UNKNOWN (non-enrolled) user → 403", async () => {
    const { accessToken, getKey } = await makeAccessToken({ sub: "ghost" });
    const app = appWith(AUTH_ON, approvedDb(), getKey); // db has only mcp-user
    const res = await app.request("/api/graph-signals/mont-tremblant", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).status).toBe("unknown");
  });
});

describe("sliding session re-mint (durable session — wp5 §B)", () => {
  // AUTH_ON: ttl 3600s (half-life 1800s), absolute ceiling 7200s.
  const T0 = 1_700_000_000_000; // ms

  /** Decode a Set-Cookie session token to read its refreshed exp (seconds). */
  async function decodeExp(res: Response, now: number): Promise<number | null> {
    const token = readSetCookie(res, "radar_session");
    if (!token) return null;
    const s = await verifySession(token, {
      sessionSecret: AUTH_ON.sessionSecret,
      now,
    });
    return s?.exp ?? null;
  }

  function protectedApp(now: number): Hono {
    const app = new Hono();
    app.use("*", protect(AUTH_ON, { now: () => now }));
    app.get("/api/protected", (c) => c.json({ ok: true }));
    return app;
  }

  it("protect re-mints the cookie once past the half-life, pushing exp forward", async () => {
    const token = await signSession(
      { sub: "user-1" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600, now: T0 },
    );
    // 1900s later: exp - now = 1700 < 1800 (past half-life), 1900 < 7200 ceiling.
    const now = T0 + 1900 * 1000;
    const res = await protectedApp(now).request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200);
    // A fresh cookie is set, with exp advanced to now + ttl.
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
    expect(await decodeExp(res, now)).toBe(Math.floor(now / 1000) + 3600);
  });

  it("protect does NOT re-mint before the half-life (no churn on every request)", async () => {
    const token = await signSession(
      { sub: "user-1" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600, now: T0 },
    );
    // 100s later: exp - now = 3500 > 1800 → no re-mint.
    const now = T0 + 100 * 1000;
    const res = await protectedApp(now).request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(readSetCookie(res, "radar_session")).toBeFalsy();
  });

  it("protect STOPS re-minting past the absolute ceiling (still valid, but anchored too old)", async () => {
    // iat0 8000s in the past (> 7200 ceiling), freshly re-signed so still valid.
    const token = await signSession(
      { sub: "user-1", iat0: Math.floor(T0 / 1000) - 8000 },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600, now: T0 },
    );
    // 1900s later: past half-life, and now - iat0 = 9900 > 7200 → no re-mint.
    const now = T0 + 1900 * 1000;
    const res = await protectedApp(now).request("/api/protected", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200); // session still honoured until its exp
    expect(readSetCookie(res, "radar_session")).toBeFalsy();
  });

  it("/me re-mints the cookie past the half-life (the SPA's polling extends the window)", async () => {
    const token = await signSession(
      { sub: "user-9", name: "Carol" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600, now: T0 },
    );
    const now = T0 + 1900 * 1000;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, now: () => now });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
    expect(await decodeExp(res, now)).toBe(Math.floor(now / 1000) + 3600);
  });

  it("/me does NOT re-mint a freshly-minted session (still in the first half)", async () => {
    const token = await signSession(
      { sub: "user-9" },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600, now: T0 },
    );
    const now = T0 + 100 * 1000;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, now: () => now });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(readSetCookie(res, "radar_session")).toBeFalsy();
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
  initialInvitations: {
    id?: string;
    email: string;
    status: string;
    expiresAt?: Date | string | null;
    invitedAt?: Date | string | null;
  }[] = [],
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
          where: (filter: unknown) => {
            const parsed = parseEqFilter(filter);
            const filtered = parsed
              ? collection.filter((u) => u[parsed.field] === parsed.value)
              : [...collection];
            return {
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              then: (
                resolve: (v: unknown[]) => unknown,
                reject?: (e: unknown) => unknown,
              ) => Promise.resolve(filtered).then(resolve, reject),
            };
          },
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
    existingInvitations?: {
      id?: string;
      email: string;
      status: string;
      expiresAt?: Date | string | null;
      invitedAt?: Date | string | null;
    }[];
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

  it("existing suspended user keeps a session for the account status screen", async () => {
    const { res } = await makeCallback({
      sub: "suspended-user",
      existingUsers: [{ sub: "suspended-user", status: "suspended", isAdmin: false }],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/rejected`);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
  });

  it("rejected user with a pending invitation keeps the rejected status", async () => {
    // A suspended/rejected account is never reactivated by an invitation:
    // only an explicit admin status change reactivates it.
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
      existingInvitations: [
        { id: "inv-1", email: "comeback@example.com", status: "pending" },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/rejected`);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
    expect((dbMock._users[0] as { status: string }).status).toBe("rejected");
    expect(
      dbMock._updates.some((u) => u.table === "account_users"),
    ).toBe(false);
    // The invitation is left untouched (still pending, never consumed by id).
    expect(
      (dbMock._invitations[0] as { status: string }).status,
    ).toBe("pending");
  });

  it("suspended user with a pending invitation keeps the suspended status", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "suspended-then-reinvited",
      email: "back@example.com",
      existingUsers: [
        {
          sub: "suspended-then-reinvited",
          email: "back@example.com",
          status: "suspended",
          isAdmin: false,
        },
      ],
      existingInvitations: [
        { id: "inv-9", email: "back@example.com", status: "pending" },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/rejected`);
    expect(readSetCookie(res, "radar_session")).toBeTruthy();
    expect((dbMock._users[0] as { status: string }).status).toBe("suspended");
    expect(
      (dbMock._invitations[0] as { status: string }).status,
    ).toBe("pending");
  });

  it("new user with a REVOKED invitation stays pending (invitation ignored)", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "new-revoked",
      email: "revoked@example.com",
      existingInvitations: [
        { id: "inv-r", email: "revoked@example.com", status: "revoked" },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/pending`);
    expect(dbMock._inserted[0]!.status).toBe("pending");
  });

  it("new user with an EXPIRED invitation stays pending (expires_at honoured)", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "new-expired",
      email: "expired@example.com",
      existingInvitations: [
        {
          id: "inv-e",
          email: "expired@example.com",
          status: "pending",
          expiresAt: new Date("2020-01-01T00:00:00Z"),
        },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/pending`);
    expect(dbMock._inserted[0]!.status).toBe("pending");
  });

  it("acceptance consumes ONLY the retained invitation, by id", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "new-chooses-valid",
      email: "multi@example.com",
      existingInvitations: [
        { id: "inv-old-revoked", email: "multi@example.com", status: "revoked" },
        {
          id: "inv-valid",
          email: "multi@example.com",
          status: "pending",
          invitedAt: new Date("2026-06-22T10:00:00Z"),
        },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    const invUpdates = dbMock._updates.filter(
      (u) => u.table === "account_invitations",
    );
    expect(invUpdates).toHaveLength(1);
    expect(invUpdates[0]).toMatchObject({
      field: "id",
      value: "inv-valid",
      set: expect.objectContaining({ status: "accepted" }),
    });
    // The revoked row is untouched.
    expect(
      (dbMock._invitations.find((r) => (r as { id: string }).id === "inv-old-revoked") as { status: string }).status,
    ).toBe("revoked");
  });

  it("existing pending user with an EXPIRED invitation stays pending (not approved)", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "pending-expired",
      email: "pendexp@example.com",
      existingUsers: [
        {
          sub: "pending-expired",
          email: "pendexp@example.com",
          status: "pending",
          isAdmin: false,
        },
      ],
      existingInvitations: [
        {
          id: "inv-x",
          email: "pendexp@example.com",
          status: "pending",
          expiresAt: new Date("2020-01-01T00:00:00Z"),
        },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${AUTH_ON.appBaseUrl}/pending`);
    expect((dbMock._users[0] as { status: string }).status).toBe("pending");
  });

  it("new user with a VALID invitation is approved and the invitation is consumed by id", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "new-invited",
      email: "invited@example.com",
      existingInvitations: [
        { id: "inv-ok", email: "invited@example.com", status: "pending" },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    expect(dbMock._inserted[0]!.status).toBe("approved");
    const invUpdate = dbMock._updates.find(
      (u) => u.table === "account_invitations",
    );
    expect(invUpdate).toMatchObject({
      field: "id",
      value: "inv-ok",
      set: expect.objectContaining({ status: "accepted" }),
    });
  });

  it("existing pending user with a VALID invitation is approved (by id)", async () => {
    const { res, dbMock } = await makeCallback({
      sub: "pending-invited",
      email: "pendok@example.com",
      existingUsers: [
        {
          sub: "pending-invited",
          email: "pendok@example.com",
          status: "pending",
          isAdmin: false,
        },
      ],
      existingInvitations: [
        { id: "inv-p", email: "pendok@example.com", status: "pending" },
      ],
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(AUTH_ON.appBaseUrl);
    expect((dbMock._users[0] as { status: string }).status).toBe("approved");
    expect(
      dbMock._updates.find((u) => u.table === "account_invitations"),
    ).toMatchObject({ field: "id", value: "inv-p" });
  });

  it("rejected user without an invitation keeps a session for the status screen", async () => {
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

// ── Account-status enforcement (cookie path + /me) ──────────────────────────
// Only "approved" grants access on protected routes. A missing account row is
// treated as not approved (403). /me keeps identity and status in its 403
// response so the SPA can render the account status screen.
describe("account status enforcement — cookie path (protect) + /me", () => {
  function protectedAppWithDb(
    db: import("../db/client.js").Database,
  ): Hono {
    const app = new Hono();
    app.use("*", protect(AUTH_ON, { db }));
    app.get("/api/protected", (c) => c.json({ secret: true }));
    return app;
  }

  async function sessionFor(sub: string): Promise<string> {
    return signSession(
      { sub },
      { sessionSecret: AUTH_ON.sessionSecret, ttlSeconds: 3600 },
    );
  }

  it("protect: missing account row → 403 account_not_approved (unknown)", async () => {
    const db = makeEnrollmentDb([
      { sub: "someone-else", status: "approved", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = protectedAppWithDb(db);
    const res = await app.request("/api/protected", {
      headers: { cookie: `radar_session=${await sessionFor("ghost")}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "account_not_approved",
      status: "unknown",
    });
  });

  it.each(["pending", "invited", "rejected", "suspended"])(
    "protect: status %s → 403 account_not_approved",
    async (status) => {
      const db = makeEnrollmentDb([
        { sub: "user-1", status, isAdmin: false },
      ]) as unknown as import("../db/client.js").Database;
      const app = protectedAppWithDb(db);
      const res = await app.request("/api/protected", {
        headers: { cookie: `radar_session=${await sessionFor("user-1")}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "account_not_approved",
        status,
      });
    },
  );

  it("protect: approved → 200", async () => {
    const db = makeEnrollmentDb([
      { sub: "user-1", status: "approved", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = protectedAppWithDb(db);
    const res = await app.request("/api/protected", {
      headers: { cookie: `radar_session=${await sessionFor("user-1")}` },
    });
    expect(res.status).toBe(200);
  });

  it("/me: missing account row → 403 account_not_approved (unknown)", async () => {
    const db = makeEnrollmentDb([
      { sub: "someone-else", status: "approved", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, db });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${await sessionFor("ghost")}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "account_not_approved",
      status: "unknown",
    });
  });

  it.each(["pending", "invited", "rejected", "suspended"])(
    "/me: status %s returns 403 with the identity needed by the status screen",
    async (status) => {
      const db = makeEnrollmentDb([
        { sub: "user-1", status, isAdmin: false },
      ]) as unknown as import("../db/client.js").Database;
      const app = authRoute(AUTH_ON, { discovery: DISCOVERY, db });
      const res = await app.request("/api/v1/auth/me", {
        headers: { cookie: `radar_session=${await sessionFor("user-1")}` },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "account_not_approved",
        status,
        authenticated: true,
        user: { sub: "user-1", status, isAdmin: false },
      });
      expect(readSetCookie(res, "radar_session")).toBeFalsy();
    },
  );

  it("/me: approved → 200", async () => {
    const db = makeEnrollmentDb([
      { sub: "user-1", status: "approved", isAdmin: false },
    ]) as unknown as import("../db/client.js").Database;
    const app = authRoute(AUTH_ON, { discovery: DISCOVERY, db });
    const res = await app.request("/api/v1/auth/me", {
      headers: { cookie: `radar_session=${await sessionFor("user-1")}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).authenticated).toBe(true);
  });

});

describe("pickValidInvitation — retained invitation (C)", () => {
  const NOW = Date.parse("2026-06-22T12:00:00Z");

  it("ignores revoked/accepted/expired rows", () => {
    expect(
      pickValidInvitation(
        [
          { id: "r", status: "revoked", expiresAt: null },
          { id: "a", status: "accepted", expiresAt: null },
          { id: "e", status: "expired", expiresAt: null },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("ignores a pending row past expires_at, honours a live one", () => {
    const kept = pickValidInvitation(
      [
        {
          id: "old",
          status: "pending",
          expiresAt: new Date("2020-01-01T00:00:00Z"),
        },
        { id: "live", status: "pending", expiresAt: null },
      ],
      NOW,
    );
    expect(kept?.id).toBe("live");
  });

  it("treats expires_at == now as expired (strictly future required)", () => {
    expect(
      pickValidInvitation(
        [
          {
            id: "edge",
            status: "pending",
            expiresAt: new Date(NOW),
          },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("returns null when nothing is valid", () => {
    expect(pickValidInvitation([], NOW)).toBeNull();
  });

});

describe("resolveGraphSignalsViewer — session sub for the discard port", () => {
  async function viewerOf(sessionValue: unknown, present: boolean): Promise<string | null> {
    let seen: string | null | "unset" = "unset";
    const app = new Hono();
    app.use("*", async (c, next) => {
      if (present) c.set("session" as never, sessionValue as never);
      await next();
    });
    app.get("/", (c) => {
      seen = resolveGraphSignalsViewer(c);
      return c.json({ ok: true });
    });
    await app.request("/");
    expect(seen).not.toBe("unset");
    return seen as string | null;
  }

  it("returns the session sub, else null", async () => {
    expect(await viewerOf({ sub: "viewer-1" }, true)).toBe("viewer-1");
    expect(await viewerOf(undefined, true)).toBeNull();
    expect(await viewerOf({ sub: 42 }, true)).toBeNull();
    expect(await viewerOf({ sub: "" }, true)).toBeNull();
    expect(await viewerOf(null, false)).toBeNull();
  });

  it("returns the sub of an exchanged strict session (per-user discard intact)", async () => {
    expect(await viewerOf({ sub: "mcp-user", via: "exchanged" }, true)).toBe("mcp-user");
  });
});

describe("strict receiver — exchanged search and audience confusions (H4 P5)", () => {
  const STRICT_AUTH = strictReceiverTestAuth(strictReceiverTestConfig());
  const RESOLVED_BASE = {
    NODE_ENV: "test",
    POSTGRES_HOST: "localhost", POSTGRES_USER: "radar",
    POSTGRES_PASSWORD: "pw", POSTGRES_DB: "radar",
    S3_ENDPOINT: "http://localhost:9000", S3_ACCESS_KEY: "minio", S3_SECRET_KEY: "minio",
    SENTROPIC_IDP_ISSUER: STRICT_AUTH.issuer,
    SENTROPIC_OAUTH_CLIENT_ID: "radar-immobilier",
    SENTROPIC_OAUTH_CLIENT_SECRET: "super-secret",
    SENTROPIC_OAUTH_REDIRECT_URI: `${STRICT_AUTH.appBaseUrl}/api/v1/auth/oauth/callback`,
    AUTH_CALLBACK_BASE_URL: STRICT_AUTH.appBaseUrl,
    SESSION_SECRET: "session-signing-key-min-32-chars-x",
    STRICT_RECEIVER_WORKLOAD_SUB: "immo-mcp-workload",
    STRICT_RECEIVER_WORKLOAD_CLIENT_ID: "immo-mcp-workload",
    STRICT_RECEIVER_ENVIRONMENT: "test",
  };
  const A2_RECEIPT = {
    STRICT_RECEIVER_RECEIPT_ISSUER: STRICT_AUTH.issuer,
    STRICT_RECEIVER_RECEIPT_API_AUDIENCE: STRICT_AUTH.appBaseUrl,
    STRICT_RECEIVER_RECEIPT_WORKLOAD_SUB: "immo-mcp-workload",
    STRICT_RECEIVER_RECEIPT_WORKLOAD_CLIENT_ID: "immo-mcp-workload",
    STRICT_RECEIVER_RECEIPT_ENVIRONMENT: "test",
  };

  async function makeExchanged(
    overrides: Record<string, unknown> = {},
  ): Promise<{ presented: string; getKey: JWTVerifyGetKey }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "k1";
    pubJwk.alg = "EdDSA";
    const builder = new SignJWT({
      scope: "immo:search",
      client_id: "immo-mcp-workload",
      act: { sub: "immo-mcp-workload" },
      ...overrides,
    }).setProtectedHeader({ alg: "EdDSA", kid: "k1" });
    if (!("iss" in overrides)) builder.setIssuer(STRICT_AUTH.issuer);
    if (!("aud" in overrides)) builder.setAudience("https://immo.example.test");
    if (!("sub" in overrides)) builder.setSubject("mcp-user");
    if (!("iat" in overrides)) builder.setIssuedAt();
    if (!("exp" in overrides)) builder.setExpirationTime("5m");
    return {
      presented: await builder.sign(privateKey),
      getKey: createLocalJWKSet({ keys: [pubJwk] }),
    };
  }

  async function makeSubject(aud: string): Promise<{ presented: string; getKey: JWTVerifyGetKey }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "k1";
    pubJwk.alg = "EdDSA";
    const presented = await new SignJWT({ scope: "immo:search immo:read" })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer(STRICT_AUTH.issuer)
      .setAudience(aud)
      .setSubject("mcp-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { presented, getKey: createLocalJWKSet({ keys: [pubJwk] }) };
  }

  type Db = import("../db/client.js").Database;
  const approvedDb = () =>
    makeEnrollmentDb([{ sub: "mcp-user", status: "approved", isAdmin: false }]) as unknown as Db;

  function strictApp(
    auth: AuthConfig = STRICT_AUTH,
    db?: Db,
    bearerGetKey?: JWTVerifyGetKey,
  ): Hono {
    const app = new Hono();
    app.use(
      "*",
      protect(auth, {
        ...(db ? { db } : {}),
        ...(bearerGetKey ? { bearerGetKey } : {}),
      }),
    );
    app.get("/api/graph-signals/:city", (c) => c.json({ ok: true, nodes: [] }));
    app.get("/api/graph-signals/by-city", (c) => c.json({ ok: true, cities: [] }));
    app.get("/api/v1/signal-facets/reason-codes", (c) => c.json({ ok: true, codes: [] }));
    app.post("/api/v1/signal-facets/select", (c) => c.json({ ok: true }));
    app.get("/api/admin/ping", (c) => c.json({ ok: true }));
    app.get("/api/documents/raw", (c) => c.json({ ok: true }));
    app.get("/health", (c) => c.json({ status: "ok" }));
    return app;
  }

  it("serves the permitted search with a correct exchanged presentation, no cookie", async () => {
    const { presented, getKey } = await makeExchanged();
    const res = await strictApp(STRICT_AUTH, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${presented}` } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("refuses the MCP-audience subject presentation on the armed search route", async () => {
    const { presented, getKey } = await makeSubject("https://immo.example.test/mcp");
    const res = await strictApp(STRICT_AUTH, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${presented}` } },
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("refuses original subject tokens on every protected route after activation", async () => {
    for (const aud of [STRICT_AUTH.appBaseUrl, `${STRICT_AUTH.appBaseUrl}/mcp`]) {
      const { presented, getKey } = await makeSubject(aud);
      for (const path of ["/api/admin/ping", "/api/v1/signal-facets/reason-codes"]) {
        const res = await strictApp(STRICT_AUTH, approvedDb(), getKey).request(path, {
          headers: { authorization: `Bearer ${presented}` },
        });
        expect(res.status).toBe(401);
      }
    }
  });

  it("refuses a foreign-environment API audience on this receiver", async () => {
    const { presented, getKey } = await makeExchanged({ aud: "https://immo.sent-tech.ca" });
    const res = await strictApp(STRICT_AUTH, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${presented}` } },
    );
    expect(res.status).toBe(401);
  });

  it("refuses wrong actor, client and non-search scope", async () => {
    for (const [overrides, status, error] of [
      [{ act: { sub: "evil-workload" } }, 401, "unauthenticated"],
      [{ client_id: "evil-client" }, 401, "unauthenticated"],
      [{ scope: "immo:read" }, 403, "delegated_scope_refused"],
    ] as const) {
      const { presented, getKey } = await makeExchanged({ ...overrides });
      const res = await strictApp(STRICT_AUTH, approvedDb(), getKey).request(
        "/api/graph-signals/drummondville",
        { headers: { authorization: `Bearer ${presented}` } },
      );
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(error);
    }
  });

  it("serves exchanged search before activation (disarmed A2 continuity)", async () => {
    const unarmed = strictReceiverTestAuth(strictReceiverTestConfig({ enabled: false }));
    const { presented, getKey } = await makeExchanged();
    const res = await strictApp(unarmed, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${presented}` } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("accepts raw subject tokens before activation but refuses them after", async () => {
    const unarmed = strictReceiverTestAuth(strictReceiverTestConfig({ enabled: false }));
    const armed = strictReceiverTestAuth(strictReceiverTestConfig());
    for (const aud of [unarmed.appBaseUrl, `${unarmed.appBaseUrl}/mcp`]) {
      const { presented, getKey } = await makeSubject(aud);
      const before = await strictApp(unarmed, approvedDb(), getKey).request(
        "/api/graph-signals/drummondville",
        { headers: { authorization: `Bearer ${presented}` } },
      );
      expect(before.status).toBe(200);
      const after = await strictApp(armed, approvedDb(), getKey).request(
        "/api/graph-signals/drummondville",
        { headers: { authorization: `Bearer ${presented}` } },
      );
      expect(after.status).toBe(401);
    }
  });

  it("fails closed when arming was requested with an invalid receipt", async () => {
    const invalid = strictReceiverTestAuth(
      strictReceiverTestConfig({ enabled: false, armingRequested: true }),
    );
    const { presented: exchanged, getKey: exchangedKey } = await makeExchanged();
    const refusedExchanged = await strictApp(invalid, approvedDb(), exchangedKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${exchanged}` } },
    );
    expect(refusedExchanged.status).toBe(401);
    expect((await refusedExchanged.json()).error).toBe("strict_receiver_receipt_invalid");
    for (const aud of [invalid.appBaseUrl, `${invalid.appBaseUrl}/mcp`]) {
      const { presented, getKey } = await makeSubject(aud);
      const refusedRaw = await strictApp(invalid, approvedDb(), getKey).request(
        "/api/graph-signals/drummondville",
        { headers: { authorization: `Bearer ${presented}` } },
      );
      expect(refusedRaw.status).toBe(401);
      expect((await refusedRaw.json()).error).toBe("strict_receiver_receipt_invalid");
    }
  });

  it("refuses an exchanged presentation for a suspended account", async () => {
    const db = makeEnrollmentDb([
      { sub: "mcp-user", status: "suspended", isAdmin: false },
    ]) as unknown as Db;
    const { presented, getKey } = await makeExchanged();
    const res = await strictApp(STRICT_AUTH, db, getKey).request(
      "/api/graph-signals/drummondville",
      { headers: { authorization: `Bearer ${presented}` } },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("account_not_approved");
  });

  it("keeps exchanged search working disarmed then armed via resolved config, no cookie", async () => {
    const disarmed = resolveAuthConfig(
      loadConfig({ ...RESOLVED_BASE, STRICT_RECEIVER_ARMED: "0" }),
    );
    expect(disarmed.strict?.enabled).toBe(false);
    const armed = resolveAuthConfig(
      loadConfig({
        ...RESOLVED_BASE,
        STRICT_RECEIVER_ARMED: "1",
        ...A2_RECEIPT,
      }),
    );
    expect(armed.strict?.enabled).toBe(true);
    const { presented, getKey } = await makeExchanged();
    const headers = { authorization: `Bearer ${presented}` };
    const before = await strictApp(disarmed, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers },
    );
    expect(before.status).toBe(200);
    const after = await strictApp(armed, approvedDb(), getKey).request(
      "/api/graph-signals/drummondville",
      { headers },
    );
    expect(after.status).toBe(200);
    for (const aud of armed.bearerAudiences) {
      const raw = await makeSubject(aud);
      for (const [auth, status] of [[disarmed, 200], [armed, 401]] as const) {
        const res = await strictApp(auth, approvedDb(), raw.getKey).request(
          "/api/graph-signals/drummondville",
          { headers: { authorization: `Bearer ${raw.presented}` } },
        );
        expect(res.status).toBe(status);
      }
    }
  });

  it("keeps exchanged search working disarmed without workload references", async () => {
    const { presented, getKey } = await makeExchanged();
    for (const workload of [
      { STRICT_RECEIVER_WORKLOAD_SUB: "" },
      { STRICT_RECEIVER_WORKLOAD_CLIENT_ID: "" },
      { STRICT_RECEIVER_WORKLOAD_SUB: "", STRICT_RECEIVER_WORKLOAD_CLIENT_ID: "" },
    ]) {
      const auth = resolveAuthConfig(loadConfig({
        ...RESOLVED_BASE, ...workload, STRICT_RECEIVER_ARMED: "0",
      }));
      const res = await strictApp(auth, approvedDb(), getKey).request(
        "/api/graph-signals/drummondville",
        { headers: { authorization: `Bearer ${presented}` } },
      );
      expect(res.status).toBe(200);
    }
  });

  it("never serves raw tokens when arming has an invalid or incomplete receipt", async () => {
    const receiptKeys = Object.keys(A2_RECEIPT);
    const variants = [
      Object.fromEntries(receiptKeys.map((key) => [key, undefined])),
      ...receiptKeys.flatMap((key) => [
        { [key]: undefined }, { [key]: "" }, { [key]: "https://wrong.example.test" },
      ]),
    ];
    for (const aud of STRICT_AUTH.bearerAudiences) {
      const { presented, getKey } = await makeSubject(aud);
      for (const variant of variants) {
        let auth: AuthConfig;
        try {
          auth = resolveAuthConfig(loadConfig({
            ...RESOLVED_BASE, ...A2_RECEIPT, ...variant, STRICT_RECEIVER_ARMED: "1",
          }));
        } catch (err) {
          expect((err as Error).message).toBe("strict_receiver_receipt_invalid");
          continue;
        }
        const res = await strictApp(auth, approvedDb(), getKey).request(
          "/api/graph-signals/drummondville",
          { headers: { authorization: `Bearer ${presented}` } },
        );
        expect(res.status).toBe(401);
        expect.unreachable("invalid arming must refuse startup");
      }
    }
  });
});

describe("strict receiver — forbidden routes, methods and preserved behavior (H4 P5)", () => {
  const STRICT_AUTH = strictReceiverTestAuth(strictReceiverTestConfig());

  async function makeExchanged(): Promise<{ presented: string; getKey: JWTVerifyGetKey }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "k1";
    pubJwk.alg = "EdDSA";
    const presented = await new SignJWT({
      scope: "immo:search",
      client_id: "immo-mcp-workload",
      act: { sub: "immo-mcp-workload" },
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer(STRICT_AUTH.issuer)
      .setAudience("https://immo.example.test")
      .setSubject("mcp-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { presented, getKey: createLocalJWKSet({ keys: [pubJwk] }) };
  }

  type Db = import("../db/client.js").Database;
  const approvedDb = () =>
    makeEnrollmentDb([{ sub: "mcp-user", status: "approved", isAdmin: false }]) as unknown as Db;

  function strictApp(bearerGetKey?: JWTVerifyGetKey): Hono {
    const app = new Hono();
    app.use("*", protect(STRICT_AUTH, { db: approvedDb(), ...(bearerGetKey ? { bearerGetKey } : {}) }));
    app.get("/api/graph-signals/:city", (c) => c.json({ ok: true, nodes: [] }));
    app.get("/api/graph-signals/by-city", (c) => c.json({ ok: true, cities: [] }));
    app.get("/api/v1/signal-facets/reason-codes", (c) => c.json({ ok: true, codes: [] }));
    app.post("/api/v1/signal-facets/select", (c) => c.json({ ok: true }));
    return app;
  }

  it("denies a valid delegated presentation on aggregate, facets and writes", async () => {
    const { presented, getKey } = await makeExchanged();
    const headers = { authorization: `Bearer ${presented}` };
    for (const [path, method] of [
      ["/api/graph-signals/by-city", "GET"],
      ["/api/v1/signal-facets/reason-codes", "GET"],
      ["/api/v1/signal-facets/select", "POST"],
      ["/api/graph-signals/drummondville", "POST"],
    ] as const) {
      const res = await strictApp(getKey).request(path, { method, headers });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("delegated_scope_refused");
    }
  });

  it("denies encoded, case-varied, trailing-slash and double-slash variants", async () => {
    const { presented, getKey } = await makeExchanged();
    const headers = { authorization: `Bearer ${presented}` };
    for (const path of [
      "/api/graph-signals/%64rummondville",
      "/api/graph-signals/Drummondville",
      "/api/graph-signals/drummondville/",
      "/api/graph-signals//drummondville",
    ]) {
      const res = await strictApp(getKey).request(path, { headers });
      expect([401, 403, 404].includes(res.status)).toBe(true);
    }
  });

  it("denies an unknown query key on the delegated search", async () => {
    const { presented, getKey } = await makeExchanged();
    const res = await strictApp(getKey).request("/api/graph-signals/drummondville?debug=1", {
      headers: { authorization: `Bearer ${presented}` },
    });
    expect(res.status).toBe(403);
  });

  it("preserves cookie sessions on search, aggregate and facets under strict arming", async () => {
    const cookie = `radar_session=${await signSession(
      { sub: "mcp-user" },
      { sessionSecret: STRICT_AUTH.sessionSecret, ttlSeconds: 3600 },
    )}`;
    for (const [path, method] of [
      ["/api/graph-signals/drummondville", "GET"],
      ["/api/graph-signals/by-city", "GET"],
      ["/api/v1/signal-facets/reason-codes", "GET"],
    ] as const) {
      const res = await strictApp().request(path, { method, headers: { cookie } });
      expect(res.status).toBe(200);
    }
  });

  it("preserves public routes without any identity under strict arming", async () => {
    const app = new Hono();
    app.use("*", protect(STRICT_AUTH, {}));
    app.get("/livez", (c) => c.json({ status: "ok" }));
    app.get("/api/geo/collections/:id/items", (c) => c.json({ type: "FeatureCollection" }));
    app.get("/api/documents/raw", (c) => c.json({ ok: true }));
    expect((await app.request("/livez")).status).toBe(200);
    expect((await app.request("/api/geo/collections/qc-lots-x/items")).status).toBe(200);
    expect((await app.request("/api/documents/raw?rawRef=raw%2Fabc.pdf")).status).toBe(200);
  });
});

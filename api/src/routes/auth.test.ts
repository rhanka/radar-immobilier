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
 * We only mock select / insert; the auth route checks status to decide redirect.
 */
function makeEnrollmentDb(
  initialUsers: { sub: string; email?: string; status: string; isAdmin: boolean }[] = [],
) {
  const users = [...initialUsers];
  const inserted: { sub: string; status: string; isAdmin: boolean }[] = [];

  return {
    _users: users,
    _inserted: inserted,
    select: () => ({
      from: () => ({
        where: (filter: unknown) => ({
          limit: (n: number) => {
            const parsed = parseEqFilter(filter);
            if (!parsed) return Promise.resolve(users.slice(0, n));
            return Promise.resolve(
              users
                .filter((u) => (u as Record<string, unknown>)[parsed.field] === parsed.value)
                .slice(0, n),
            );
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: { sub: string; status: string; isAdmin: boolean }) => {
        users.push(vals);
        inserted.push(vals);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  };
}

describe("enrollment — OIDC callback with DB", () => {
  async function makeCallback(opts: {
    sub: string;
    email?: string;
    existingUsers?: { sub: string; email?: string; status: string; isAdmin: boolean }[];
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
    const dbMock = makeEnrollmentDb(opts.existingUsers ?? []);
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
});

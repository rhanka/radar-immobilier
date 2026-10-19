import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { controlRoute } from "./control-route.js";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";
import type { AccountStatusQueryable } from "@radar/artifacts-host";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret", redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const APP_HOST = "app.example.test";
const ENSURE_URL = `http://${APP_HOST}/api/v1/artifacts/control/ensure`;
const META_URL = `http://${APP_HOST}/api/v1/artifacts/control/meta`;

function stubAccounts(statuses: Record<string, string>): AccountStatusQueryable {
  return {
    async query(_text: string, params: unknown[] = []) {
      const sub = params[0];
      const status = typeof sub === "string" ? statuses[sub] : undefined;
      return { rows: status === undefined ? [] : [{ status }] };
    },
  };
}

const app = new Hono().route(
  "/api/v1/artifacts/control",
  controlRoute({ auth: AUTH, accounts: stubAccounts({ "sub-ok": "approved", "sub-pending": "pending" }),
    backend: { handle: async () => ({ status: 503, body: { error: "capability_unavailable" } }) } }),
);

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds },
  );
  return `radar_session=${token}`;
}

interface PostOptions {
  readonly sub?: string | undefined;
  readonly origin?: string | null | undefined;
  readonly contentType?: string | undefined;
  readonly body?: string | undefined;
  readonly authorization?: string | undefined;
}

async function postEnsure(options: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { host: APP_HOST };
  if (options.sub !== undefined) headers["cookie"] = await cookieFor(options.sub);
  if (options.origin === undefined) headers["origin"] = AUTH.appBaseUrl;
  else if (options.origin !== null) headers["origin"] = options.origin;
  if (options.contentType !== undefined) headers["content-type"] = options.contentType;
  if (options.authorization !== undefined) headers["authorization"] = options.authorization;
  return app.request(ENSURE_URL, { method: "POST", headers, ...(options.body !== undefined ? { body: options.body } : {}) });
}

describe("controlRoute identity guards", () => {
  it("refuses anonymous calls with 401", async () => {
    const res = await postEnsure({ contentType: "application/json", body: "{}" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses any Bearer [REDACTED] even with a valid cookie (cookie-only)", async () => {
    const withCookie = await postEnsure({
      sub: "sub-ok", contentType: "application/json", body: "{}",
      authorization: "Bearer [REDACTED]",
    });
    expect(withCookie.status).toBe(401);
    expect(await withCookie.json()).toEqual({ error: "cookie_required" });

    const bearerOnly = await postEnsure({
      contentType: "application/json", body: "{}",
      authorization: "Bearer [REDACTED]",
    });
    expect(bearerOnly.status).toBe(401);
    expect(await bearerOnly.json()).toEqual({ error: "cookie_required" });
  });

  it("refuses non-approved and unknown accounts with 403", async () => {
    const pending = await postEnsure({ sub: "sub-pending", contentType: "application/json", body: "{}" });
    expect(pending.status).toBe(403);
    expect(await pending.json()).toEqual({ error: "account_not_approved", status: "pending" });

    const unknown = await postEnsure({ sub: "no-such-sub", contentType: "application/json", body: "{}" });
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual({ error: "account_not_approved", status: "unknown" });
  });
});

describe("controlRoute origin guard", () => {
  it("refuses foreign, content-host and missing origins with 403 and no write", async () => {
    for (const origin of ["https://evil.example", "https://123e4567-e89b-12d3-a456-426614174000.pages.example.net", null]) {
      const res = await postEnsure({ sub: "sub-ok", contentType: "application/json", body: "{}", origin });
      expect(res.status, String(origin)).toBe(403);
      expect(await res.json(), String(origin)).toEqual({ error: "forbidden_origin" });
    }
  });
});

describe("controlRoute body guards", () => {
  it("refuses non-JSON content with 415", async () => {
    const res = await postEnsure({ sub: "sub-ok", contentType: "text/plain", body: "hello" });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_media_type" });
  });

  it("refuses bodies over 2 MiB with 413", async () => {
    const res = await postEnsure({ sub: "sub-ok", contentType: "application/json",
      body: `{"pad":${JSON.stringify("a".repeat(2 * 1024 * 1024 + 1))}}` });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
  });

  it("refuses unparseable JSON with 400", async () => {
    const res = await postEnsure({ sub: "sub-ok", contentType: "application/json", body: "{oops" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });
});

describe("controlRoute unavailable backend", () => {
  it("returns 503 for fully guarded POSTs when storage is unavailable", async () => {
    const res = await postEnsure({ sub: "sub-ok", contentType: "application/json", body: "{}" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capability_unavailable" });
  });

  it("guards GET routes without requiring a JSON body", async () => {
    const res = await app.request(META_URL, { headers: { host: APP_HOST, cookie: await cookieFor("sub-ok"), origin: AUTH.appBaseUrl } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capability_unavailable" });
  });

  it("still guards GETs for anonymous callers", async () => {
    const res = await app.request(META_URL, { headers: { host: APP_HOST, origin: AUTH.appBaseUrl } });
    expect(res.status).toBe(401);
  });
});

describe("controlRoute read origins", () => {
  it.each(["GET", "HEAD"])("accepts same-origin %s without Origin", async (method) => {
    const reads = new Hono().route("/", controlRoute({ auth: AUTH,
      accounts: stubAccounts({ "sub-ok": "approved" }),
      backend: { handle: async () => ({ status: 200, body: { total: 0 } }) } }));
    const response = await reads.request("/list", { method,
      headers: { cookie: await cookieFor("sub-ok"), "sec-fetch-site": "same-origin" } });
    expect(response.status).toBe(200);
  });

  it.each(["GET", "HEAD"])("refuses foreign Origin or fetch site on %s", async (method) => {
    for (const headers of [{ origin: "https://foreign.example" },
      { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
      const response = await app.request(META_URL, { method,
        headers: { ...headers, cookie: await cookieFor("sub-ok") } });
      expect(response.status).toBe(403);
    }
  });
});

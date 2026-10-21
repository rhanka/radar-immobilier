import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ActivationConfig, AccountStatusQueryable } from "@radar/artifacts-host";
import { controlRoute } from "./control-route.js";
import type { AuthConfig } from "../config.js";
import { signSession } from "../services/auth/session.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret", redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!", sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200, jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const APP_HOST = "app.example.test";
const CONTROL = `http://${APP_HOST}/api/v1/artifacts/control`;
const LIVE: ActivationConfig = {
  enabled: true, subjects: ["sub-ok"], expiresAtMs: Date.now() + 3600_000,
};

async function cookieFor(sub: string): Promise<string> {
  const token = await signSession(
    { sub },
    { sessionSecret: AUTH.sessionSecret, ttlSeconds: AUTH.sessionTtlSeconds },
  );
  return `radar_session=${token}`;
}

function stubAccounts(): AccountStatusQueryable {
  const statuses: Record<string, string> = { "sub-ok": "approved", bob: "approved", pending: "pending" };
  return {
    async query(_text: string, params: unknown[] = []) {
      const sub = typeof params[0] === "string" ? params[0] : "?";
      const status = statuses[sub];
      return { rows: status === undefined ? [] : [{ status }] };
    },
  };
}

function makeApp(withBackend = true): Hono {
  return new Hono().route("/api/v1/artifacts/control", controlRoute({
    auth: AUTH,
    accounts: stubAccounts(),
    ...(withBackend
      ? {
          backend: {
            async handle(_op: string, _actorId: string, _body: unknown) {
              return { status: 201, body: { ok: true } };
            },
          },
        }
      : {}),
    readActivation: () => LIVE,
  }));
}

function expectPrivate(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("vary")).toContain("Cookie");
  expect(res.headers.get("vary")).toContain("Authorization");
}

describe("control cache headers on success [T29]", () => {
  it("marks ensure, publish, meta and list successes private", async () => {
    const app = makeApp();
    const calls: Array<{ path: string; method: string; body?: string }> = [
      { path: `${CONTROL}/ensure`, method: "POST", body: "{}" },
      { path: `${CONTROL}/publish`, method: "POST", body: "{}" },
      { path: `${CONTROL}/meta`, method: "GET" },
      { path: `${CONTROL}/list`, method: "HEAD" },
    ];
    for (const init of calls) {
      const res = await app.request(init.path, { method: init.method,
        headers: { host: APP_HOST, origin: AUTH.appBaseUrl,
          "content-type": "application/json", cookie: await cookieFor("sub-ok") },
        ...(init.body !== undefined ? { body: init.body } : {}) });
      expect(res.status).toBe(201);
      expectPrivate(res);
    }
  });
});

describe("control cache headers on errors [T29]", () => {
  it("marks every refusal private without changing its status", async () => {
    const app = makeApp();
    const json = { origin: AUTH.appBaseUrl, "content-type": "application/json" };
    const cases: Array<{ name: string; expected: number; run: () => Promise<Response> }> = [
      { name: "anonymous", expected: 401,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST", headers: { host: APP_HOST, ...json }, body: "{}" }) },
      { name: "foreign origin", expected: 403,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST",
          headers: { host: APP_HOST, origin: "https://evil.example",
            "content-type": "application/json", cookie: await cookieFor("sub-ok") }, body: "{}" }) },
      { name: "non-cohort", expected: 403,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST",
          headers: { host: APP_HOST, ...json, cookie: await cookieFor("bob") }, body: "{}" }) },
      { name: "media type", expected: 415,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST",
          headers: { host: APP_HOST, origin: AUTH.appBaseUrl,
            "content-type": "text/plain", cookie: await cookieFor("sub-ok") }, body: "hello" }) },
      { name: "invalid json", expected: 400,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST",
          headers: { host: APP_HOST, ...json, cookie: await cookieFor("sub-ok") }, body: "{oops" }) },
      { name: "oversized", expected: 413,
        run: async () => app.request(`${CONTROL}/ensure`, { method: "POST",
          headers: { host: APP_HOST, ...json, cookie: await cookieFor("sub-ok") },
          body: `{"pad":${JSON.stringify("a".repeat(2 * 1024 * 1024 + 1))}}` }) },
      { name: "unknown op", expected: 503,
        run: async () => app.request(`${CONTROL}/fork`, { method: "POST",
          headers: { host: APP_HOST, ...json, cookie: await cookieFor("sub-ok") }, body: "{}" }) },
    ];
    for (const c of cases) {
      const res = await c.run();
      expect(res.status, c.name).toBe(c.expected);
      expectPrivate(res);
    }
    const bearer = await app.request(`${CONTROL}/ensure`, { method: "POST",
      headers: { host: APP_HOST, ...json,
        cookie: await cookieFor("sub-ok"), authorization: "Bearer [REDACTED]" }, body: "{}" });
    expect(bearer.status).toBe(401);
    expectPrivate(bearer);
    const unavailable = await makeApp(false).request(`${CONTROL}/list`,
      { headers: { host: APP_HOST, origin: AUTH.appBaseUrl, cookie: await cookieFor("sub-ok") } });
    expect(unavailable.status).toBe(503);
    expectPrivate(unavailable);
  });

  it("keeps private headers across an account switch", async () => {
    const app = makeApp();
    const headers = { host: APP_HOST, origin: AUTH.appBaseUrl, "content-type": "application/json" };
    const alice = await app.request(`${CONTROL}/ensure`, {
      method: "POST", headers: { ...headers, cookie: await cookieFor("sub-ok") }, body: "{}" });
    expect(alice.status).toBe(201);
    expectPrivate(alice);
    const bob = await app.request(`${CONTROL}/ensure`, {
      method: "POST", headers: { ...headers, cookie: await cookieFor("bob") }, body: "{}" });
    expect(bob.status).toBe(403);
    expectPrivate(bob);
    expect(bob.headers.get("vary")).toBe(alice.headers.get("vary"));
  });
});

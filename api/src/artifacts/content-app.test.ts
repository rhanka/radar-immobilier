import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { contentGate } from "./content-app.js";
import { READER_CONTENT_HEADERS } from "./content-isolation.js";
import { createApp } from "../app.js";
import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { OidcDiscovery } from "../services/auth/oidc.js";
import { signSession } from "../services/auth/session.js";

const AUTH: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback",
  scopes: "openid profile email", appBaseUrl: "https://app.example.test",
  sessionSecret: "session-secret-32-bytes-long-padding!!",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/.well-known/jwks.json",
  bearerAudiences: ["https://app.example.test", "https://app.example.test/mcp"],
};

const DISCOVERY: OidcDiscovery = {
  issuer: AUTH.issuer, authorization_endpoint: `${AUTH.issuer}/api/v1/auth/oauth/authorize`,
  token_endpoint: `${AUTH.issuer}/api/v1/auth/oauth/token`, jwks_uri: AUTH.jwksUri,
};

const BASE = "pages.example.net";
const STABLE = `123e4567-e89b-12d3-a456-426614174000.${BASE}`;
const PINNED = `123e4567-e89b-12d3-a456-426614174001.pinned.${BASE}`;
const APP_HOST = "app.example.test";

function makeApp(contentBase: string | null = BASE) {
  const content = contentBase === null ? {} : { contentHost: { enabled: true as const, contentBase } };
  const app = createApp({
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store: {} as unknown as ObjectStore, db: {} as unknown as Database,
    auth: AUTH, authOptions: { discovery: DISCOVERY }, ...content,
  });
  return { request: (url: string, init?: RequestInit) => app.request(url, {
    ...init, headers: { host: new URL(url).host, ...init?.headers },
  }) };
}

const app = makeApp();

function expectDenyHeaders(res: Response): void {
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(res.headers.get("location")).toBeNull();
}

describe("contentGate on a content host", () => {
  it.each([STABLE, PINNED])("denies official API routes and prospect writes on %s", async (host) => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/admin/users"]) {
      const res = await app.request(`http://${host}${path}`);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expectDenyHeaders(res);
    }
    const note = await app.request(`http://${host}/api/v1/prospects/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(note.status).toBe(401);
    expect(await note.json()).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(note);
  });

  it("denies page paths with generic 404 JSON (no app fallback, no HTML)", async () => {
    for (const url of [`http://${STABLE}/`, `http://${STABLE}/index.html`, `http://${PINNED}/`]) {
      const res = await app.request(url);
      expect(res.status, url).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expectDenyHeaders(res);
    }
  });

  it("ignores X-Forwarded-Host in both directions", async () => {
    expect((await app.request(`http://${APP_HOST}/api/v1/auth/login`, { headers: { "x-forwarded-host": STABLE } })).status).toBe(302);
    expect((await app.request(`http://${STABLE}/api/v1/auth/login`, { headers: { "x-forwarded-host": APP_HOST } })).status).toBe(401);
  });

  it("uses Host even when it disagrees with the request URL", async () => {
    const res = await app.request(`http://${APP_HOST}/`, { headers: { host: STABLE } });
    expect(res.status).toBe(404);
    expectDenyHeaders(res);
  });

  it("classifies a trailing-dot Host at the gate", async () => {
    const res = await app.request(`http://${APP_HOST}/`, { headers: { host: `${STABLE}.` } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expectDenyHeaders(res);
  });
});

describe("contentGate probes on a content host", () => {
  it.each(["GET", "HEAD"])("serves %s probes without a session cookie", async (method) => {
    for (const path of ["/livez", "/health"]) {
      const res = await app.request(`http://${STABLE}${path}`, { method });
      expect(res.status, path).toBe(200);
      if (method === "GET") expect((await res.json()).status, path).toBe("ok");
      else expect(await res.text(), path).toBe("");
      expect(res.headers.get("set-cookie"), path).toBeNull();
    }
  });

  it("denies probe paths for other methods", async () => {
    for (const path of ["/livez", "/health"]) {
      const res = await app.request(`http://${STABLE}${path}`, { method: "POST" });
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
      expectDenyHeaders(res);
    }
  });
});

describe("contentGate threat scenarios", () => {
  it("denies browser navigations without redirecting to login", async () => {
    expect((await app.request(`http://${APP_HOST}/api/v1/admin/users`, {
      headers: { accept: "text/html" },
    })).status).toBe(302);
    const res = await app.request(`http://${STABLE}/api/v1/admin/users`, {
      headers: { accept: "text/html" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(res);
  });

  it("denies requests bearing a valid session cookie", async () => {
    const token = await signSession(
      { sub: "user-1" },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 },
    );
    expect((await app.request(`http://${APP_HOST}/api/v1/auth/login`, {
      headers: { cookie: `radar_session=${token}` },
    })).status).toBe(302);
    const res = await app.request(`http://${STABLE}/api/v1/auth/login`, {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expectDenyHeaders(res);
  });
});

describe("contentGate on other hosts", () => {
  it("keeps the current chain for the application host", async () => {
    expect((await app.request(`http://${APP_HOST}/api/v1/auth/login`)).status).toBe(302);
    expect((await app.request(`http://${APP_HOST}/livez`)).status).toBe(200);
  });

  it("leaves pod-IP kubelet probes unchanged", async () => {
    expect((await app.request("http://10.244.0.17/livez")).status).toBe(200);
    const health = await app.request("http://10.244.0.17/health");
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");
  });

  it("passes every host through when no content base is configured", async () => {
    const open = makeApp(null);
    expect((await open.request(`http://${STABLE}/api/v1/auth/login`)).status).toBe(302);
  });
});

describe("contentGate reader dispatch (A6/H5 seam)", () => {
  it.each([STABLE, PINNED, `not-a-uuid.${BASE}`, `nope.pinned.${BASE}`])(
    "should isolate every wildcard host before application handlers on %s", async (host) => {
      for (const method of ["GET", "POST"]) {
        for (const path of ["/api/v1/auth/enroll", "/api/v1/auth/login", "/api/v1/workspaces", "/api/geo/collections", "/api", "/admin", "/app", "/auth/login", "/login"]) {
          const fetch = vi.fn(() => new Response("must not run"));
          const gated = new Hono();
          gated.use("*", contentGate(BASE, { fetch }));
          gated.all("*", (c) => c.redirect("/application-login"));
          const response = await gated.request(`https://${host}${path}`, {
            method, headers: { host, cookie: "radar_session=application-cookie" },
          });
          expect(response.status, `${method} ${path}`).toBe(path.startsWith("/api") ? 401 : 404);
          for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) expect(response.headers.get(name)).toBe(value);
          expect(response.headers.get("set-cookie")).toBeNull();
          expect(response.headers.get("location")).toBeNull();
          expect(fetch).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each([`not-a-uuid.${BASE}`, `nope.pinned.${BASE}`])(
    "should refuse malformed content hosts with and without a reader on %s", async (host) => {
      const response = await app.request(`https://${host}/api/v1/auth/enroll`);
      expect(response.status).toBe(401);
      expectDenyHeaders(response);
      const fetch = vi.fn(() => new Response("must not run"));
      const gated = new Hono();
      gated.use("*", contentGate(BASE, { fetch }));
      const page = await gated.request(`https://${host}/index.html`, { headers: { host } });
      expect(page.status).toBe(404);
      expect(fetch).not.toHaveBeenCalled();
      for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) expect(page.headers.get(name)).toBe(value);
      expect(page.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each(["GET", "POST"])("should deny %s API calls with reader isolation before delegation", async (method) => {
    const fetch = vi.fn(() => new Response("must not run"));
    const gated = new Hono();
    gated.use("*", contentGate(BASE, { fetch }));
    for (const host of [STABLE, PINNED]) {
      const response = await gated.request(`https://${host}/api/v1/workspaces`, { method, headers: { host } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
      for (const [name, value] of Object.entries(READER_CONTENT_HEADERS)) expect(response.headers.get(name)).toBe(value);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("delegates page paths to the mounted reader while /api stays denied", async () => {
    const reader = new Hono().get("*", (c) => c.text("reader"));
    const gated = new Hono();
    gated.use("*", contentGate(BASE, reader));
    gated.get("/fallback", (c) => c.text("fallback"));
    const page = await gated.request(`http://${STABLE}/index.html`, {
      headers: { host: STABLE },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("reader");
    const api = await gated.request(`http://${STABLE}/api/v1/auth/login`, {
      headers: { host: STABLE },
    });
    expect(api.status).toBe(401);
  });

  it("stays closed without a mounted reader", async () => {
    const res = await app.request(`http://${STABLE}/index.html`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

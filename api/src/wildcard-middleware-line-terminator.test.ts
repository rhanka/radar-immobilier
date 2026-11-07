import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createContentDenyApp } from "./artifacts/content-deny.js";
import { HOST as READER_HOST, makeApp as makeReaderApp } from "./artifacts/reader-test-fixture.js";
import type { AuthConfig } from "./config.js";
import type { Database } from "./db/client.js";
import type { ObjectStore } from "./storage/object-store.js";

/**
 * GHSA-h7mg-cq63-vhpq: before hono 4.13.16, RegExpRouter (selected by the
 * default SmartRouter) compiled a wildcard as `.*`, which does not match a
 * line terminator. A path carrying an encoded `%0A`, `%0D`, `%E2%80%A8` or
 * `%E2%80%A9` therefore matched no wildcard pattern: every `app.use("*", …)`
 * middleware was skipped and the request went straight to the not-found
 * handler.
 *
 * The content-deny listener is a single `app.use("*", …)` denial served by
 * RegExpRouter: on 4.13.13 such a path got hono's bare `404 Not Found`
 * (no denial body or headers, 404 instead of 401 under /api/). The api app
 * fronts its business routes with `app.use("*", protect)`; its route set is
 * not supported by RegExpRouter, so SmartRouter currently selects
 * TrieRouter and the guard already ran. Its case pins that outcome whatever
 * router SmartRouter ends up selecting.
 *
 * The reader content app (RegExpRouter too) gates every path with
 * `app.use("*", …)` before its `app.get("*", serveRelease)` catch-all: the
 * gate answers `/api/*` with a typed 401 and refuses an authority header
 * with a typed 400, under the reader isolation headers.
 */
const LINE_TERMINATOR_PATHS = [
  "/api/v1/opportunites%0A",
  "/api/v1/workspaces%0D",
  "/api/v1/backlog%E2%80%A8",
  "/private%E2%80%A9",
  "/%0A",
];

const auth: AuthConfig = {
  enabled: true, issuer: "https://auth.example.test", clientId: "radar", clientSecret: "test-client",
  redirectUri: "https://app.example.test/api/v1/auth/oauth/callback", scopes: "openid",
  appBaseUrl: "https://app.example.test", sessionSecret: "test-session-secret-32-bytes-padding",
  sessionTtlSeconds: 3600, sessionAbsoluteTtlSeconds: 7200,
  jwksUri: "https://auth.example.test/jwks", bearerAudiences: ["https://app.example.test"],
};

describe("wildcard middleware with an encoded line terminator in the path", () => {
  it("still runs the api auth guard (app.use('*', protect))", async () => {
    const app = createApp({ auth, store: {} as ObjectStore, db: {} as Database,
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }) });
    for (const path of LINE_TERMINATOR_PATHS) {
      const res = await app.request(`https://app.example.test${path}`);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toEqual({ error: "unauthenticated" });
    }
  });

  it("still runs the content-deny denial (app.use('*', deny))", async () => {
    const app = createContentDenyApp();
    const request = (path: string) =>
      app.request(`http://pages.example.net${path}`, { headers: { host: "pages.example.net" } });
    for (const path of ["/api/v1/auth/me%0A", "/api/%E2%80%A8"]) {
      const res = await request(path);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toEqual({ error: "unauthenticated" });
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    for (const path of ["/index.html%0D", "/livez%0A", "/%E2%80%A9"]) {
      const res = await request(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("still runs the reader content gate (app.use('*', gate))", async () => {
    const app = makeReaderApp();
    const request = (path: string, headers: Record<string, string> = {}) =>
      app.request(`http://${READER_HOST}${path}`, { headers: { host: READER_HOST, ...headers } });
    for (const path of ["/api/v1/auth/me%0A", "/api/%E2%80%A8", "/api/v1/workspaces%0D"]) {
      const res = await request(path);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toEqual({ error: "unauthenticated" });
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
    }
    for (const path of ["/index.html%0A", "/%E2%80%A9"]) {
      const res = await request(path, { authorization: "Bearer forged" });
      expect(res.status, path).toBe(400);
      expect(await res.json(), path).toEqual({ error: "invalid_authority" });
    }
  });
});

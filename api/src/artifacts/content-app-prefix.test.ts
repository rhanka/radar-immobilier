import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { AuthConfig } from "../config.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { OidcDiscovery } from "../services/auth/oidc.js";
import { createReaderContentApp } from "./content-serve.js";
import { createFixtureAuthority } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { GRANT_SECRET, HOST, ISSUER, SESSION_SECRET } from "./reader-test-fixture.js";

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
const APP_HOST = "app.example.test";

function makeApp() {
  const app = createApp({
    checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
    store: {} as unknown as ObjectStore, db: {} as unknown as Database,
    auth: AUTH, authOptions: { discovery: DISCOVERY },
    contentHost: { enabled: true as const, contentBase: BASE },
  });
  return (url: string, init?: RequestInit) => app.request(url, {
    ...init, headers: { host: new URL(url).host, ...init?.headers },
  });
}

function makeReaderApp(readOperation: ReturnType<typeof vi.fn>) {
  return createReaderContentApp({ authority: createFixtureAuthority(),
    readOperation: readOperation as never, contentBase: BASE,
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER,
    releaseFiles: createMemoryReleaseFiles([]), now: () => 1_000 });
}

describe("reserved /__app/ prefix (J1.2d/e §14.1)", () => {
  it("answers an explicit typed 404 on the app origin without any session", async () => {
    const request = makeApp();
    for (const path of ["/__app", "/__app/", "/__app/api/v1/auth/me", "/__app/api/v1/workspaces"]) {
      const res = await request(`http://${APP_HOST}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
    }
  });

  it("refuses /__app/ on a content host without delegating to the reader release", async () => {
    const fetch = vi.fn(async () => new Response("shadowed", { status: 200 }));
    const app = createApp({
      checkDb: async () => ({ ok: true }), checkObjectStore: async () => ({ ok: true }),
      store: {} as unknown as ObjectStore, db: {} as unknown as Database,
      auth: AUTH, authOptions: { discovery: DISCOVERY },
      contentHost: { enabled: true as const, contentBase: BASE },
      readerContent: { fetch: fetch as never },
    });
    const res = await app.request(`http://${STABLE}/__app/api/v1/auth/me`, {
      headers: { host: STABLE },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses /__app/ inside the reader content app without calling any operation", async () => {
    const readOperation = vi.fn(async () => ({}));
    const app = makeReaderApp(readOperation);
    for (const target of [`http://${HOST}/__app`, `http://${HOST}/__app/api/v1/auth/me`]) {
      const res = await app.request(target, { headers: { host: HOST } });
      expect(res.status, target).toBe(404);
      expect(await res.json(), target).toEqual({ error: "not_found" });
    }
    expect(readOperation).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_LIFETIME_MS,
  createImmoHttpApp,
  type ImmoHttpConfig,
} from "./server-http.js";

// Group 1b: exact GET discovery route table + identical JSON/Cache-Control
// on both discovery URLs and the bare route (0.1.0 baseline).
const RESOURCE = "https://immo.test.local/mcp";
const ISSUER = "https://auth.test.local";
const SCOPES = ["immo:read", "immo:search", "immo:documents:read"];
const LEGACY_PATH = "/mcp/.well-known/oauth-protected-resource";
const CANONICAL_PATH = "/.well-known/oauth-protected-resource/mcp";
const BARE_PATH = "/.well-known/oauth-protected-resource";

const config: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: SCOPES,
  port: 0,
  dataMode: "simulation",
  sessionIdleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionMaxLifetimeMs: DEFAULT_SESSION_MAX_LIFETIME_MS,
};

function createApp() {
  return createImmoHttpApp(config, {
    // Discovery must never reach the JWKS lookup.
    keySource: {
      resolveKey: async () => {
        throw new Error("unexpected JWKS lookup on the discovery path");
      },
    },
  });
}

describe("discovery routes on 0.1.0", () => {
  it.each([
    [LEGACY_PATH, 200],
    [CANONICAL_PATH, 200],
    [BARE_PATH, 200],
    ["/MCP/.well-known/oauth-protected-resource", 404],
    ["/.well-known/oauth-protected-resource/MCP", 404],
    ["/mcp//.well-known/oauth-protected-resource", 404],
    ["/.well-known//oauth-protected-resource/mcp", 404],
  ] as const)("GET %s returns %i", async (path, status) => {
    expect((await createApp().request(path)).status).toBe(status);
  });

  it("serves identical JSON and Cache-Control on both URLs and the bare route", async () => {
    const app = createApp();
    const [legacy, canonical, bare] = await Promise.all([
      app.request(LEGACY_PATH),
      app.request(CANONICAL_PATH),
      app.request(BARE_PATH),
    ]);
    expect(canonical.status).toBe(legacy.status);
    expect(bare.status).toBe(legacy.status);
    expect(legacy.headers.get("content-type")).toContain("application/json");
    expect(legacy.headers.get("cache-control")).toBe("public, max-age=300");
    expect(canonical.headers.get("cache-control")).toBe(
      legacy.headers.get("cache-control"),
    );
    expect(bare.headers.get("cache-control")).toBe(legacy.headers.get("cache-control"));
    const [legacyDoc, canonicalDoc, bareDoc] = await Promise.all([
      legacy.json(),
      canonical.json(),
      bare.json(),
    ]);
    expect(canonicalDoc).toEqual(legacyDoc);
    expect(bareDoc).toEqual(legacyDoc);
    expect(legacyDoc).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
    });
  });
});

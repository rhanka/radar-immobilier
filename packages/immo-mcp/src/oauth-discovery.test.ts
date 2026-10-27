import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";

const RESOURCE = "https://immo.test.local/mcp";
const ISSUER = "https://auth.test.local";
const SCOPES = ["immo:read", "immo:search", "immo:documents:read"];
const LEGACY_PATH = "/mcp/.well-known/oauth-protected-resource";
const CANONICAL_PATH = "/.well-known/oauth-protected-resource/mcp";
const config: ImmoHttpConfig = {
  resource: RESOURCE, issuer: ISSUER, scopesSupported: SCOPES,
  requiredScopes: ["immo:read"], port: 0, dataMode: "simulation",
};

function createApp() {
  return createImmoHttpApp(config, {
    keySource: { resolveKey: async () => { throw new Error("unexpected JWKS lookup"); } },
  });
}

describe("OAuth protected resource discovery", () => {
  it.each([LEGACY_PATH, CANONICAL_PATH])("serves exact public JSON metadata at %s", async (path) => {
    const res = await createApp().request(new URL(path, RESOURCE));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({
      resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: SCOPES,
      bearer_methods_supported: ["header"], dpop_signing_alg_values_supported: ["EdDSA"],
    });
  });

  it.each([
    "/MCP/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/MCP",
    "/mcp//.well-known/oauth-protected-resource",
    "/.well-known//oauth-protected-resource/mcp",
  ])("does not expose discovery through the non-exact path %s", async (path) => {
    const res = await createApp().request(new URL(path, RESOURCE));
    expect(res.status).toBe(404);
  });

  it("follows the canonical resource_metadata URL advertised by mcp-auth 0.2.1", async () => {
    const app = createApp();
    const denied = await app.request("/mcp", { method: "POST" });
    expect(denied.status).toBe(401);
    const challenge = denied.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="invalid_token"');
    const advertised = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(advertised).toBe(`https://immo.test.local${CANONICAL_PATH}`);
    const res = await app.request(advertised!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const canonical = await app.request(CANONICAL_PATH);
    expect(await res.json()).toEqual(await canonical.json());
  });

  it.each(["POST", "GET", "DELETE"])("keeps %s /mcp behind the transport auth guard", async (method) => {
    const res = await createApp().request("/mcp", { method });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("keeps the transport prefix and routes only the canonical metadata path exactly to MCP", () => {
    const ingress = readFileSync(new URL("../../../deploy/k8s/41-immo-mcp-ingress.yaml", import.meta.url), "utf8");
    const routes = [...ingress.matchAll(
      /- path: (\S+)\n\s+pathType: (\S+)\n\s+backend:\n\s+service:\n\s+name: (\S+)\n\s+port:\n\s+name: (\S+)/g,
    )].map(([, path, type, service, port]) => ({ path, type, service, port }));
    expect(routes).toEqual([
      { path: "/mcp", type: "Prefix", service: "radar-immo-mcp", port: "http" },
      { path: CANONICAL_PATH, type: "Exact", service: "radar-immo-mcp", port: "http" },
    ]);
  });
});

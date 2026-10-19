import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_LIFETIME_MS,
  createImmoHttpApp,
  type ImmoHttpConfig,
} from "./server-http.js";

// Group 1a: full 401 golden on 0.1.0 (status, challenge, body) for every /mcp method.
const RESOURCE = "https://immo.test.local/mcp";
const ISSUER = "https://auth.test.local";

const config: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read", "immo:search", "immo:documents:read"],
  port: 0,
  dataMode: "simulation",
  sessionIdleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionMaxLifetimeMs: DEFAULT_SESSION_MAX_LIFETIME_MS,
};

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
});

function createApp() {
  return createImmoHttpApp(config, {
    // Missing-auth must never reach the JWKS lookup.
    keySource: {
      resolveKey: async () => {
        throw new Error("unexpected JWKS lookup on the missing-auth path");
      },
    },
  });
}

async function unauthenticated(method: "POST" | "GET" | "DELETE") {
  const res = await createApp().request("/mcp", {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: method === "POST" ? INIT_BODY : undefined,
  });
  return {
    status: res.status,
    challenge: res.headers.get("www-authenticate") ?? "",
    body: await res.text(),
  };
}

describe("401 golden on 0.1.0", () => {
  it.each(["POST", "GET", "DELETE"] as const)(
    "refuses %s /mcp without auth (401 + invalid_token challenge)",
    async (method) => {
      const res = await unauthenticated(method);
      expect(res).toMatchInlineSnapshot(`
        {
          "body": "{"error":{"code":"invalid_token","message":"Authorization header is required."}}",
          "challenge": "Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.test.local/mcp/.well-known/oauth-protected-resource"",
          "status": 401,
        }
      `);
    },
  );

  it("keeps the POST, GET and DELETE 401 responses identical", async () => {
    const [post, get, del] = await Promise.all([
      unauthenticated("POST"),
      unauthenticated("GET"),
      unauthenticated("DELETE"),
    ]);
    expect(get.status).toBe(post.status);
    expect(del.status).toBe(post.status);
    expect(get.challenge).toBe(post.challenge);
    expect(del.challenge).toBe(post.challenge);
    expect(get.body).toBe(post.body);
    expect(del.body).toBe(post.body);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import type { Hono } from "hono";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import { HttpDataSource } from "./data-source.js";
import { HttpRawDataSource } from "./raw-data.js";

// Group 2: session client binding, simulated restart, egress spy (0.1.0 baseline).
const ISSUER = "https://auth.test.local";
const RESOURCE = "https://immo.test.local/mcp";
const BASE_URL = "https://radar-api.example.test";
const SCOPES = "immo:read immo:search immo:documents:read";
const CONFIG: ImmoHttpConfig = {
  issuer: ISSUER, resource: RESOURCE, requiredScopes: ["immo:read"],
  scopesSupported: SCOPES.split(" "), port: 0, dataMode: "simulation",
  sessionIdleTimeoutMs: 1800000, sessionMaxLifetimeMs: 28800000,
};
const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
});

let publicKey: KeyLike;
let privateKey: KeyLike;
let keySource: TokenKeySource;

async function signToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { scope = SCOPES, ...rest } = claims;
  return new SignJWT({ scope, client_id: "immo-cli", tid: "radar", ...rest })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(ISSUER).setSubject("user-1")
    .setAudience(RESOURCE).setIssuedAt().setExpirationTime("5m").sign(privateKey);
}

function headers(token: string, sessionId?: string | null): HeadersInit {
  const out: Record<string, string> = {
    "content-type": "application/json", accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
  };
  if (sessionId) out["mcp-session-id"] = sessionId;
  return out;
}

async function initialize(app: Hono, token: string): Promise<string> {
  const res = await app.request("/mcp", { method: "POST", headers: headers(token), body: INIT_BODY });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const notified = await app.request("/mcp", {
    method: "POST", headers: headers(token, sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  expect(notified.status).toBe(202);
  return sessionId as string;
}

function callTool(app: Hono, token: string, sessionId: string, name: string, args: unknown, id: number) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return app.request("/mcp", { method: "POST", headers: headers(token, sessionId), body });
}

beforeAll(async () => {
  ({ publicKey, privateKey } = await generateKeyPair("RS256"));
  keySource = { resolveKey: async () => publicKey };
});

describe("sessions and egress on 0.1.0", () => {
  it("rejects the session when the OAuth client differs (azp wins over client_id)", async () => {
    const app = createImmoHttpApp(CONFIG, { keySource });
    const sessionId = await initialize(app, await signToken({ azp: "client-a" }));
    for (const token of [
      await signToken({ azp: "client-b" }),
      await signToken({ azp: "client-evil", client_id: "client-a" }),
    ]) {
      const res = await app.request("/mcp", {
        method: "POST", headers: headers(token, sessionId),
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe("Unknown or expired MCP session");
    }
    const control = await app.request("/mcp", {
      method: "POST", headers: headers(await signToken({ azp: "client-a", client_id: "other" }), sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(control.status).toBe(200);
  });

  it("rejects the session when the fallback client_id differs (no azp)", async () => {
    const app = createImmoHttpApp(CONFIG, { keySource });
    const sessionId = await initialize(app, await signToken({ client_id: "client-a" }));
    const mismatch = await app.request("/mcp", {
      method: "POST", headers: headers(await signToken({ client_id: "client-b" }), sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(mismatch.status).toBe(404);
    expect(((await mismatch.json()) as { error: { message: string } }).error.message).toBe("Unknown or expired MCP session");
    const control = await app.request("/mcp", {
      method: "POST", headers: headers(await signToken({ client_id: "client-a" }), sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(control.status).toBe(200);
  });

  it("loses transport ids on restart and reinitializes with the same token", async () => {
    const token = await signToken();
    const first = createImmoHttpApp(CONFIG, { keySource });
    const staleId = await initialize(first, token);
    const restarted = createImmoHttpApp(CONFIG, { keySource });
    const stale = await restarted.request("/mcp", { method: "GET", headers: headers(token, staleId) });
    const staleCall = await callTool(restarted, token, staleId, "search_signals", { city: "longueuil" }, 2);
    for (const response of [stale, staleCall]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unknown or expired MCP session"},"id":null}');
      expect(response.headers.get("www-authenticate")).toBeNull();
    }
    await initialize(restarted, token);
  });

  async function captureEgress(calls: [string, unknown, number][]) {
    const seen: Request[] = [];
    const spy: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/api/graph-signals/longueuil") {
        return Response.json({ nodes: [{ id: "sig-1", type: "Signal" }] });
      }
      if (path.startsWith("/api/geo/collections/")) {
        return Response.json({ features: [], numberMatched: 0 });
      }
      if (path === "/api/documents/raw") return new Response(null, { status: 404 });
      throw new Error(`unexpected upstream route: ${path}`);
    };
    const app = createImmoHttpApp({ ...CONFIG, dataMode: "real" }, {
      keySource,
      data: new HttpDataSource({ baseUrl: BASE_URL, fetchImpl: spy }),
      raw: new HttpRawDataSource({ baseUrl: BASE_URL, publicBaseUrl: BASE_URL, fetchImpl: spy }),
    });
    const token = await signToken();
    const sessionId = await initialize(app, token);
    for (const [name, args, id] of calls) {
      const response = await callTool(app, token, sessionId, name, args, id);
      expect(response.status).toBe(200);
      expect((await response.json()).result.isError).not.toBe(true);
    }
    return { seen, token };
  }

  it("keeps the exact raw-data request inventory free of user credentials", async () => {
    const { seen, token } = await captureEgress([
      ["get_zones_geojson", { city: "longueuil", limit: 2 }, 11],
      ["query_zoning_events", { muni_slug: "longueuil" }, 12],
      ["get_pv_pdf", { rawRef: "raw/proces-verbaux-longueuil/cas/abc.pdf" }, 13],
    ]);
    expect(seen.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/geo/collections/qc-zonage-longueuil/items",
      "/api/geo/collections/qc-zoning-events-longueuil/items", "/api/documents/raw",
    ]);
    for (const request of seen) {
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.url).not.toContain(token);
      for (const value of request.headers.values()) expect(value).not.toContain(token);
    }
  });

  it("forwards the user bearer to graph-signals on 0.1.0", async () => {
    const { seen, token } = await captureEgress([
      ["search_signals", { city: "longueuil" }, 10],
    ]);
    expect(seen.map((request) => request.url)).toEqual([`${BASE_URL}/api/graph-signals/longueuil`]);
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${token}`);
  });
});

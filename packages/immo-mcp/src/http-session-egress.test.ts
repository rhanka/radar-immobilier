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

  it("loses transport ids on restart and reinitializes with the same token", async () => {
    const token = await signToken();
    const first = createImmoHttpApp(CONFIG, { keySource });
    const staleId = await initialize(first, token);
    const restarted = createImmoHttpApp(CONFIG, { keySource });
    const stale = await restarted.request("/mcp", { method: "GET", headers: headers(token, staleId) });
    expect(stale.status).toBe(404);
    expect(await initialize(restarted, token)).not.toBe(staleId);
  });

  it("forwards the user bearer only to graph-signals, never to raw data", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const spy: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const auth = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("authorization");
      seen.push({ url, authorization: auth });
      const path = new URL(url).pathname;
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
    const calls: [string, unknown, number][] = [
      ["search_signals", { city: "longueuil" }, 10],
      ["get_zones_geojson", { city: "longueuil", limit: 2 }, 11],
      ["query_zoning_events", { muni_slug: "longueuil" }, 12],
      ["get_pv_pdf", { rawRef: "raw/proces-verbaux-longueuil/cas/abc.pdf" }, 13],
    ];
    for (const [name, args, id] of calls) {
      const response = await callTool(app, token, sessionId, name, args, id);
      expect(response.status).toBe(200);
      expect((await response.json()).result.isError).not.toBe(true);
    }
    const graph = seen.filter((s) => s.url.includes("/api/graph-signals/"));
    expect(graph).toHaveLength(1);
    expect(graph[0]?.url).toBe(`${BASE_URL}/api/graph-signals/longueuil`);
    expect(graph[0]?.authorization).toBe(`Bearer ${token}`);
    const raw = seen.filter((s) => !s.url.includes("/api/graph-signals/"));
    expect(raw.map((s) => new URL(s.url).pathname)).toEqual([
      "/api/geo/collections/qc-zonage-longueuil/items",
      "/api/geo/collections/qc-zoning-events-longueuil/items", "/api/documents/raw",
    ]);
    for (const entry of raw) expect(entry.authorization).toBeNull();
  });
});

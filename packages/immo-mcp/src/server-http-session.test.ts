import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import type { KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import {
  createImmoHttpApp,
  type ImmoHttpConfig,
} from "./server-http.js";
import type { Hono } from "hono";

// Same resource-server settings as server-http.test.ts (`resource` == token `aud`).
const ISSUER = "https://auth.test.local";
const RESOURCE = "https://immo.test.local/mcp";

const BASE_CONFIG: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read", "immo:search", "immo:documents:read"],
  port: 0,
  dataMode: "simulation",
};

let publicKey: KeyLike;
let privateKey: KeyLike;
let keySource: TokenKeySource;

async function signToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const {
    scope = "immo:read immo:search immo:documents:read",
    sub = "user-1",
    ...rest
  } = overrides;
  return new SignJWT({ scope, client_id: "immo-cli", tid: "radar", ...rest })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setSubject(String(sub))
    .setAudience(RESOURCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function mcpHeaders(opts: { token?: string; sessionId?: string | null } = {}): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;
  return headers;
}

async function initialize(app: Hono, token: string): Promise<string> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: mcpHeaders({ token }),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    }),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  // Tool calls require an initialized session — mirror what a real client sends.
  const initialized = await app.request("/mcp", {
    method: "POST",
    headers: mcpHeaders({ token, sessionId }),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  expect(initialized.status).toBe(202);
  return sessionId!;
}

function searchLotsCall(id: number): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "search_lots", arguments: { city: "longueuil" } },
  };
}

beforeAll(async () => {
  ({ publicKey, privateKey } = await generateKeyPair("RS256"));
  keySource = { resolveKey: async () => publicKey };
});

describe("mcp http session ownership", () => {
  it("rejects a different subject on a known session exactly like an unknown session", async () => {
    const app = createImmoHttpApp(BASE_CONFIG, { keySource });
    const tokenA = await signToken({ sub: "user-1" });
    const sessionId = await initialize(app, tokenA);

    const unknownRes = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token: tokenA, sessionId: "no-such-session" }),
      body: JSON.stringify(searchLotsCall(90)),
    });
    expect(unknownRes.status).toBe(404);
    const unknownBody = await unknownRes.json();

    // A valid token for ANOTHER user reusing the known session id.
    const tokenB = await signToken({ sub: "user-2" });
    const res = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token: tokenB, sessionId }),
      body: JSON.stringify(searchLotsCall(91)),
    });
    expect(res.status).toBe(unknownRes.status);
    expect(await res.json()).toEqual(unknownBody);

    // The transport was left untouched: the owner can still use the session.
    const retry = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token: tokenA, sessionId }),
      body: JSON.stringify(searchLotsCall(92)),
    });
    expect(retry.status).toBe(200);
  });
});

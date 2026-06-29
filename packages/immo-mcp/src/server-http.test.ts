import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import type { KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import type { Hono } from "hono";

// Resource-server settings under test. `resource` == the token `aud` (single-audience model).
const ISSUER = "https://auth.test.local";
const RESOURCE = "https://immo.test.local/mcp";
const SUPPORTED = ["immo:read", "immo:search", "immo:documents:read"];
const PRM_PATH = "/.well-known/oauth-protected-resource";

const CONFIG: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: SUPPORTED,
  port: 0,
  dataMode: "simulation",
};

let publicKey: KeyLike;
let privateKey: KeyLike;
let app: Hono;
// Deterministic in-test key source — exercises the REAL @sentropic/oauth-verify path
// (decode header → resolveKey → jwtVerify) with a token we control, instead of mocking.
let keySource: TokenKeySource;

async function signToken(
  overrides: Record<string, unknown> = {},
  opts: { audience?: string } = {},
): Promise<string> {
  const {
    scope = "immo:read immo:search immo:documents:read",
    sub = "user-1",
    ...rest
  } = overrides;
  return new SignJWT({ scope, client_id: "immo-cli", tid: "radar", ...rest })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setSubject(String(sub))
    .setAudience(opts.audience ?? RESOURCE)
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

function postMcp(
  body: unknown,
  opts: { token?: string; sessionId?: string | null } = {},
): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: mcpHeaders(opts),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ publicKey, privateKey } = await generateKeyPair("RS256"));
  keySource = { resolveKey: async () => publicKey };
  app = createImmoHttpApp(CONFIG, { keySource });
});

describe("immo-mcp remote (Streamable HTTP + OAuth RS)", () => {
  it("(a) serves the RFC 9728 PRM and rejects an unauthenticated /mcp with WWW-Authenticate", async () => {
    const prm = await app.request(PRM_PATH);
    expect(prm.status).toBe(200);
    const prmDoc = (await prm.json()) as Record<string, unknown>;
    expect(prmDoc["resource"]).toBe(RESOURCE);
    expect(prmDoc["authorization_servers"]).toEqual([ISSUER]);
    expect(prmDoc["bearer_methods_supported"]).toEqual(["header"]);
    expect(prmDoc["scopes_supported"]).toEqual(SUPPORTED);

    const res = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(`resource_metadata="${RESOURCE}${PRM_PATH}"`);
  });

  it("(b) with a valid token, an initialize + tool call round-trips through the transport", async () => {
    const token = await signToken();

    const initRes = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { token },
    );
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initBody = (await initRes.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(initBody.result?.serverInfo?.name).toBe("immo");

    const initialized = await postMcp(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { token, sessionId },
    );
    expect(initialized.status).toBe(202);

    const callRes = await postMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search_lots", arguments: { city: "longueuil" } },
      },
      { token, sessionId },
    );
    expect(callRes.status).toBe(200);
    const callBody = (await callRes.json()) as {
      result?: { content?: { type: string; text?: string }[] };
    };
    const text = callBody.result?.content?.[0]?.text ?? "{}";
    const payload = JSON.parse(text) as { count: number; lots: { city: string }[] };
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.lots[0]?.city).toBe("longueuil");
  });

  it("(c) rejects a token with the wrong audience (401 invalid_token)", async () => {
    const token = await signToken({}, { audience: "https://someone-else.example/mcp" });
    const res = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { token },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
  });

  it("(c) rejects a token missing the required scope (401, scope re-asserted by the RS)", async () => {
    const token = await signToken({ scope: "immo:search immo:documents:read" }); // no immo:read
    const res = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      { token },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain('error="invalid_token"');
  });
});

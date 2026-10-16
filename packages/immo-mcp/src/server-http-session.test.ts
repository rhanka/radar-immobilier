import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import type { KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_LIFETIME_MS,
  createImmoHttpApp,
  type ImmoHttpConfig,
} from "./server-http.js";
import type { Hono } from "hono";
import type {
  DataSourceCallContext,
  ImmoDataSource,
  SearchSignalsArgs,
} from "./data-source.js";
import { MockDataSource } from "./data-source.js";
import type { MockSignal } from "./mocks.js";

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
  sessionIdleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionMaxLifetimeMs: DEFAULT_SESSION_MAX_LIFETIME_MS,
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

  it("keeps the session for the same subject with a refreshed token and forwards the new bearer", async () => {
    let lastAccessToken: string | undefined | null = null;
    class RecordingDataSource extends MockDataSource {
      override async searchSignals(
        args: SearchSignalsArgs,
        ctx: DataSourceCallContext = {},
      ): Promise<MockSignal[]> {
        lastAccessToken = ctx.accessToken;
        return [
          {
            id: "sig-x",
            city: args.city,
            type: "rezonage",
            etape: "avis_motion",
            etape_date: "2026-01-01",
            reglement_number: "R-1",
            zone_ref: "H-1",
            no_lot: null,
            summary: "signal reel",
            source_document_id: "doc-1",
          },
        ];
      }
    }
    const data: ImmoDataSource & { lastAccessToken: string | undefined | null } =
      new RecordingDataSource();
    const app = createImmoHttpApp(BASE_CONFIG, { keySource, data });

    const tokenA = await signToken({ sub: "user-1" });
    const sessionId = await initialize(app, tokenA);

    // Same subject, freshly minted token (no reconnection expected). The `jti`
    // keeps both tokens distinct even when signed within the same second.
    const tokenA2 = await signToken({ sub: "user-1", jti: "refreshed-2" });
    expect(tokenA2).not.toBe(tokenA);
    const callRes = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token: tokenA2, sessionId }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search_signals", arguments: { city: "longueuil" } },
      }),
    });
    expect(callRes.status).toBe(200);
    expect(lastAccessToken).toBe(tokenA2);
  });

  it("applies a removed scope to the next request on the same session", async () => {
    const app = createImmoHttpApp(BASE_CONFIG, { keySource });
    const full = await signToken({ sub: "user-1" });
    const sessionId = await initialize(app, full);

    // Route gate still passes (immo:read kept) but immo:search was removed.
    const reduced = await signToken({ sub: "user-1", scope: "immo:read" });
    const res = await app.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token: reduced, sessionId }),
      body: JSON.stringify(searchLotsCall(2)),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { content?: { type: string; text?: string }[]; isError?: boolean };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? "").toContain("scope_denied:immo:search");
  });
});

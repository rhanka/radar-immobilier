import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import type { Hono } from "hono";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import {
  MockDataSource,
  type DataSourceCallContext,
  type SearchSignalsArgs,
} from "./data-source.js";
import { getInvocationContext } from "./invocation-context.js";

const ISSUER = "https://auth.test.local";
const RESOURCE = "https://immo.test.local/mcp";
const SCOPES = "immo:read immo:search immo:documents:read";
const CONFIG: ImmoHttpConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  requiredScopes: ["immo:read"],
  scopesSupported: SCOPES.split(" "),
  port: 0,
  dataMode: "simulation",
  sessionIdleTimeoutMs: 1800000,
  sessionMaxLifetimeMs: 28800000,
};

let publicKey: KeyLike;
let privateKey: KeyLike;
let keySource: TokenKeySource;

async function signToken(claims: Record<string, unknown> = {}, subject = "user-1"): Promise<string> {
  const { scope = SCOPES, ...rest } = claims;
  return new SignJWT({ scope, client_id: "immo-cli", tid: "radar", ...rest })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setSubject(subject)
    .setAudience(RESOURCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function headers(credential: string, sessionId?: string | null): HeadersInit {
  const out: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${credential}`,
  };
  if (sessionId) out["mcp-session-id"] = sessionId;
  return out;
}

async function initialize(app: Hono, credential: string): Promise<string> {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: headers(credential),
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
  const notified = await app.request("/mcp", {
    method: "POST",
    headers: headers(credential, sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  expect(notified.status).toBe(202);
  return sessionId as string;
}

function callTool(app: Hono, credential: string, sessionId: string, name: string, args: unknown, id: number, pause = false) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const requestHeaders = new Headers(headers(credential, sessionId));
  if (pause) requestHeaders.set("x-test-pause", "1");
  return app.request("/mcp", { method: "POST", headers: requestHeaders, body });
}

async function toolPayload(res: Response): Promise<{ isError?: boolean; text: string }> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  };
  const text = (body.result?.content ?? []).map((block) => block.text ?? "").join("\n");
  return { isError: body.result?.isError, text };
}

class RecordingDataSource extends MockDataSource {
  calls: { credential: string | undefined; reveal: boolean; sub: string | undefined }[] = [];
  override async searchSignals(
    args: SearchSignalsArgs,
    ctx: DataSourceCallContext = {},
  ) {
    this.calls.push({ credential: ctx.accessToken, reveal: args.showDiscarded ?? false, sub: getInvocationContext()?.auth.sub });
    return super.searchSignals(args);
  }
}

/** Pause after HTTP context capture, BEFORE SDK dispatch and handler invocation. */
function pauseAtDispatch() {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const original = WebStandardStreamableHTTPServerTransport.prototype.handleRequest;
  vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "handleRequest")
    .mockImplementation(async function (request, ...rest) {
      if (request.headers.has("x-test-pause")) {
        entered();
        await gate;
      }
      return original.call(this, request, ...rest);
    });
  return { ready, release };
}

afterEach(() => vi.restoreAllMocks());

beforeAll(async () => {
  ({ publicKey, privateKey } = await generateKeyPair("RS256"));
  keySource = { resolveKey: async () => publicKey };
});

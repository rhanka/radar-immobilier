import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import type { KeyLike } from "jose";
import type { TokenKeySource } from "@sentropic/oauth-verify";
import { createImmoHttpApp, extractBearerToken, type ImmoHttpConfig } from "./server-http.js";
import type { Hono } from "hono";
import type {
  DataSourceCallContext,
  ImmoDataSource,
  SearchSignalsArgs,
} from "./data-source.js";
import { MockDataSource } from "./data-source.js";
import type { MockSignal } from "./mocks.js";

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
    // PRM is mounted under the resource's own path ("/mcp"), matching what
    // protectedResourceMetadataUrl() advertises in the 401 challenge below —
    // see server-http.ts's createImmoHttpApp() comment + BLOCKERS.md item 1.
    const prm = await app.request(`/mcp${PRM_PATH}`);
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

    // The raw-data tools are registered on the SAME shared factory: tools/list
    // over HTTP must expose them, and a bounded GeoJSON call must round-trip.
    const listRes = await postMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { token, sessionId },
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (listBody.result?.tools ?? []).map((t) => t.name);
    for (const expected of [
      "get_zones_geojson",
      "get_lots_geojson",
      "get_grille_pdf",
      "get_pv_pdf",
    ]) {
      expect(names).toContain(expected);
    }

    const lotsRes = await postMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_lots_geojson", arguments: { city: "longueuil", limit: 2 } },
      },
      { token, sessionId },
    );
    expect(lotsRes.status).toBe(200);
    const lotsBody = (await lotsRes.json()) as {
      result?: { content?: { type: string; text?: string }[] };
    };
    const lotsPayload = JSON.parse(lotsBody.result?.content?.[0]?.text ?? "{}") as {
      featureCollection: { type: string; features: unknown[] };
      numberReturned: number;
      truncated: boolean;
    };
    expect(lotsPayload.featureCollection.type).toBe("FeatureCollection");
    expect(lotsPayload.numberReturned).toBe(2);
    expect(lotsPayload.truncated).toBe(true); // 3 mock lots > limit 2 — bound reported
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

describe("extractBearerToken", () => {
  it("parses 'Bearer <token>' (case-insensitive), else undefined", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractBearerToken("bearer   xyz")).toBe("xyz");
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken(null)).toBeUndefined();
    expect(extractBearerToken("Basic abc")).toBeUndefined();
    expect(extractBearerToken("")).toBeUndefined();
  });
});

describe("per-user token propagation (D4) through the transport", () => {
  // A data source that records the per-call caller context so we can assert the
  // CURRENT user's own token reached search_signals (never a machine credential).
  class RecordingDataSource extends MockDataSource {
    lastAccessToken: string | undefined | null = null;
    override async searchSignals(
      args: SearchSignalsArgs,
      ctx: DataSourceCallContext = {},
    ): Promise<MockSignal[]> {
      this.lastAccessToken = ctx.accessToken;
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
          summary: "signal réel",
          source_document_id: "doc-1",
        },
      ];
    }
  }

  it("forwards the verified user bearer to search_signals", async () => {
    const data: ImmoDataSource & { lastAccessToken: string | undefined | null } =
      new RecordingDataSource();
    const scopedApp = createImmoHttpApp(CONFIG, { keySource, data });
    const token = await signToken();

    const initRes = await scopedApp.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });
    const sessionId = initRes.headers.get("mcp-session-id");
    await scopedApp.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token, sessionId }),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const callRes = await scopedApp.request("/mcp", {
      method: "POST",
      headers: mcpHeaders({ token, sessionId }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search_signals", arguments: { city: "mont-tremblant" } },
      }),
    });
    expect(callRes.status).toBe(200);
    // The raw JWT presented on the request is what reached the data source.
    expect(data.lastAccessToken).toBe(token);
  });
});

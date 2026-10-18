import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, type KeyLike } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createImmoHttpApp } from "./server-http.js";
import { buildImmoServer } from "./server.js";
import { HttpDataSource } from "./data-source.js";
import { HttpRawDataSource } from "./raw-data.js";

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
type Capture = {
  calls: Record<string, { args: Record<string, unknown>; result: ToolResult }>;
  limitedScope: { calls: Record<string, ToolResult> };
  missingCoarseScope: { code: number };
};
const fixtureBytes = readFileSync(new URL("./fixtures/immo-tools.v1.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
  serverVersion: { name: string; version: string };
  serverCapabilities: unknown;
  tools: unknown[];
  captures: { http: Capture; simulation: Capture };
};
const receipt = JSON.parse(readFileSync(
  new URL("./fixtures/immo-deployed-baseline.v1.json", import.meta.url), "utf8",
)) as {
  toolFixtureSha256: string;
  toolCount: number;
  versions: Record<string, string>;
};
const RESOURCE = "https://immo.test.local/mcp";
const ISSUER = "https://auth.test.local";
const BASE_URL = "https://radar-api.example.test";
const SCOPES = "immo:read immo:search immo:documents:read";
let publicKey: KeyLike;
let privateKey: KeyLike;

beforeAll(async () => {
  ({ publicKey, privateKey } = await generateKeyPair("RS256"));
});

// Preserve JSON formatting and all error fields; only the random UUID is variable.
function normalize(result: ToolResult): ToolResult {
  return {
    ...result,
    content: result.content.map((block) => {
      if (block.type !== "text" || !block.text) return block;
      const payload = JSON.parse(block.text) as { correlationId?: unknown };
      if (payload.correlationId === undefined) return block;
      expect(payload.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      return {
        ...block,
        text: block.text.replace(
          String(payload.correlationId), "00000000-0000-4000-8000-000000000000",
        ),
      };
    }),
  };
}

async function connectHttp(mode: "http" | "simulation", scope = SCOPES) {
  const upstream: typeof fetch = async (input) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(BASE_URL);
    if (url.pathname === "/api/graph-signals/longueuil") {
      return Response.json({ nodes: [{ id: "sig-synthetique-1", type: "reglement" }] });
    }
    if (url.pathname.startsWith("/api/geo/collections/") || url.pathname === "/api/documents/raw") {
      return new Response(null, { status: 404 });
    }
    throw new Error(`unexpected upstream route: ${url.pathname}`);
  };
  const app = createImmoHttpApp({
    issuer: ISSUER, resource: RESOURCE, requiredScopes: ["immo:read"],
    scopesSupported: SCOPES.split(" "), port: 0, dataMode: mode === "http" ? "real" : "simulation",
  }, {
    keySource: { resolveKey: async () => publicKey },
    ...(mode === "http" ? {
      data: new HttpDataSource({ baseUrl: BASE_URL, fetchImpl: upstream }),
      raw: new HttpRawDataSource({ baseUrl: BASE_URL, publicBaseUrl: BASE_URL, fetchImpl: upstream }),
    } : {}),
  });
  const token = await new SignJWT({ scope, client_id: "immo-mcp" })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(ISSUER).setAudience(RESOURCE)
    .setSubject("synthetic-user").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.request(input, init),
  });
  const client = new Client({ name: "deployed-baseline-test", version: "0.0.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    client,
    close: async () => {
      try { await transport.terminateSession(); } finally { await client.close(); }
    },
  };
}

describe("deployed twelve-tool baseline", () => {
  it("anchors the tool fixture to the captured image and build receipt", () => {
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      image: "ghcr.io/rhanka/radar-api@sha256:96a0f646b1316bce58231252cf45a766b31c46fdd7fb49ab359ada8834d3f221",
      buildCommit: "4dc37c8bc6d067af1c8c7a5a3643e113cf7e86e1",
      production: {
        image: "ghcr.io/rhanka/radar-api@sha256:73dc465bbe579932fcb644ee9e2538d6bb716542776d912dc7cbc19c25792f10",
        buildCommit: "ea90951ca253bd300c26daa44ce0ce416602a271",
      },
      toolFixture: "immo-tools.v1.json",
      toolFixtureSha256: "31487e8fb9b85019fc707ed3a7296e33156c46fb5fd3071d456d6dae1b44d998",
      toolCount: 12,
      versions: { "@sentropic/mcp-auth": "0.1.0" },
    });
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(receipt.toolFixtureSha256);
    expect(fixture.tools).toHaveLength(receipt.toolCount);
    expect(fixture.serverVersion.version).toBe(receipt.versions["@radar/immo-mcp"]);
  });

  it.each(["http", "simulation"] as const)(
    "matches complete discovery and representative results over HTTP in %s mode",
    async (mode) => {
      const { client, close } = await connectHttp(mode);
      try {
        expect(client.getServerVersion()).toEqual(fixture.serverVersion);
        expect(client.getServerCapabilities()).toEqual(fixture.serverCapabilities);
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(receipt.toolCount);
        expect(tools).toEqual(fixture.tools);
        for (const [name, call] of Object.entries(fixture.captures[mode].calls)) {
          const result = await client.callTool({ name, arguments: call.args }) as ToolResult;
          expect(normalize(result), name).toEqual(normalize(call.result));
        }
      } finally {
        await close();
      }
    },
  );

  it.each(["http", "simulation"] as const)(
    "preserves the captured missing-coarse-scope 401 with mcp-auth 0.1.0 in %s mode",
    async (mode) => {
      const capturedCode = fixture.captures[mode].missingCoarseScope.code;
      expect(receipt.versions["@sentropic/mcp-auth"]).toBe("0.1.0");
      expect(capturedCode).toBe(401);
      await expect(connectHttp(mode, "immo:search")).rejects.toMatchObject({ code: capturedCode });
    },
  );

  it.each(["http", "simulation"] as const)(
    "preserves captured narrow-scope results in %s mode",
    async (mode) => {
      const { client, close } = await connectHttp(mode, "immo:read");
      try {
        const capture = fixture.captures[mode];
        for (const [name, expected] of Object.entries(capture.limitedScope.calls)) {
          const result = await client.callTool({
            name, arguments: capture.calls[name]!.args,
          }) as ToolResult;
          expect(normalize(result), name).toEqual(normalize(expected));
        }
      } finally {
        await close();
      }
    },
  );

  it("matches the complete discovery of the current stdio server factory", async () => {
    const server = buildImmoServer({
      IMMO_MCP_AUTH_STUB_SUB: "synthetic-user", IMMO_MCP_AUTH_STUB_TENANT: "radar",
      IMMO_MCP_AUTH_STUB_SCOPES: SCOPES,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "factory-baseline-test", version: "0.0.0" });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      expect((await client.listTools()).tools).toEqual(fixture.tools);
    } finally {
      await client.close();
      await server.close();
    }
  });
});


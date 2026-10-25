import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import { HttpDataSource, MockDataSource } from "./data-source.js";
import { buildImmoServer } from "./server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const config: ImmoHttpConfig = {
  issuer: "https://synthetic.test", resource: "https://synthetic.test/mcp", requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read", "immo:search"], dataMode: "simulation", port: 0,
  sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000,
};
let privateKey: KeyLike; let publicKey: KeyLike;
beforeAll(async () => { ({ privateKey, publicKey } = await generateKeyPair("RS256")); });
const token = (client: string | undefined = "cli") => new SignJWT({ scope: "immo:read immo:search", client_id: client })
  .setIssuer(config.issuer).setAudience(config.resource).setSubject("alice")
  .setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256" }).sign(privateKey);
const headers = (bearer: string, session?: string) => ({
  authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  ...(session ? { "mcp-session-id": session } : {}),
});
const initializeBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" },
} };
async function session(app: ReturnType<typeof createImmoHttpApp>, bearer: string) {
  const res = await app.request("/mcp", { method: "POST", headers: headers(bearer), body: JSON.stringify(initializeBody) });
  expect(res.status).toBe(200);
  return res.headers.get("mcp-session-id")!;
}
async function call(app: ReturnType<typeof createImmoHttpApp>, bearer: string, sid: string) {
  return app.request("/mcp", { method: "POST", headers: headers(bearer, sid), body: JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_lots", arguments: { city: "longueuil" } },
  }) });
}

describe("P6 composed effects", () => {
  it("should execute once and recheck account approval before each effect", async () => {
    const data = new MockDataSource(); const effect = vi.spyOn(data, "searchLots");
    let approved = true;
    const authorize = vi.fn(async () => approved);
    const app = createImmoHttpApp(config, { data, authorize, keySource: { resolveKey: async () => publicKey } });
    const bearer = await token(); const sid = await session(app, bearer);
    const success = await (await call(app, bearer, sid)).json();
    expect(success.result.content[0].type).toBe("text");
    expect(JSON.parse(success.result.content[0].text)).toHaveProperty("lots");
    expect(effect).toHaveBeenCalledTimes(1);
    approved = false;
    const denied = await (await call(app, bearer, sid)).json();
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0].text).toContain("composition_account");
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("should deny a missing real account binding and lookup failure before business calls", async () => {
    const fetchImpl = vi.fn();
    const data = new HttpDataSource({ baseUrl: "https://unreachable.test", fetchImpl });
    for (const authorize of [undefined, async () => { throw new Error("private query error"); }]) {
      const app = createImmoHttpApp(config, { data, keySource: { resolveKey: async () => publicKey },
        ...(authorize ? { authorize } : {}) });
      const bearer = await token(); const sid = await session(app, bearer);
      const result = await (await call(app, bearer, sid)).json();
      expect(result.result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("composition_account");
      expect(JSON.stringify(result)).not.toContain("private query error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("should reject a client disappearing from an established session", async () => {
    const app = createImmoHttpApp(config, { keySource: { resolveKey: async () => publicKey } });
    const bearer = await token(); const sid = await session(app, bearer);
    const absent = await new SignJWT({ scope: "immo:read immo:search" }).setIssuer(config.issuer)
      .setAudience(config.resource).setSubject("alice").setIssuedAt().setExpirationTime("5m")
      .setProtectedHeader({ alg: "RS256" }).sign(privateKey);
    expect((await call(app, absent, sid)).status).toBe(404);
    expect((await call(app, bearer, sid)).status).toBe(200);
  });

  it("should confine synthetic stdio claims to fixtures despite inherited storage and API settings", async () => {
    const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    const server = await buildImmoServer({ RADAR_API_BASE_URL: "https://real-storage.invalid",
      IMMO_MCP_DATA_MODE: "http", ARTIFACTS_STORAGE_SCOPE: "real", DATABASE_URL: "postgres://real.invalid/db" });
    const client = new Client({ name: "test", version: "1" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(s), client.connect(c)]);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(12);
      expect(tools.tools.some((tool) => tool.name.startsWith("artifacts_"))).toBe(false);
      const result = await client.callTool({ name: "get_zones_geojson", arguments: { city: "longueuil" } });
      expect(result.isError).not.toBe(true);
      expect(outbound).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); outbound.mockRestore(); }
  });
});

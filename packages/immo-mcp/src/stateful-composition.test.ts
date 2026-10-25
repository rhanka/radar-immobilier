import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";
import { HttpDataSource, MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { buildImmoServer } from "./server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ImmoStatefulHost } from "./stateful-host.js";

const config: ImmoHttpConfig = {
  issuer: "https://synthetic.test", resource: "https://synthetic.test/mcp", requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read", "immo:search"], dataMode: "simulation", port: 0,
  sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000,
};
let privateKey: KeyLike; let publicKey: KeyLike;
beforeAll(async () => { ({ privateKey, publicKey } = await generateKeyPair("RS256")); });
const token = (client: string | undefined = "cli", scope = "immo:read immo:search") => new SignJWT({ scope, client_id: client })
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
  it("should return composition_unavailable for every method after a future binding fails", async () => {
    let host: ImmoStatefulHost | undefined;
    const bind = ImmoStatefulHost.prototype.bind;
    const capture = vi.spyOn(ImmoStatefulHost.prototype, "bind").mockImplementation(function (hooks) {
      host = this;
      return bind.call(this, hooks);
    });
    try {
      const app = createImmoHttpApp(config, { keySource: { resolveKey: async () => publicKey } });
      const bearer = await token(); const sid = await session(app, bearer);
      const future = new Server({ name: "failed", version: "1" });
      vi.spyOn(future, "setRequestHandler").mockImplementation(() => { throw new Error("install_failed"); });
      expect(() => host!.retain(future)).toThrow("install_failed");
      for (const method of ["POST", "GET", "DELETE"]) {
        const res = await app.request("/mcp", { method, headers: headers(bearer, sid),
          ...(method === "POST" ? { body: JSON.stringify(initializeBody) } : {}) });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "composition_unavailable" });
      }
    } finally { capture.mockRestore(); }
  });

  it("should reserve HTTP 413 for an oversized request body", async () => {
    const app = createImmoHttpApp(config, { keySource: { resolveKey: async () => publicKey } });
    const bearer = await token(); const sid = await session(app, bearer);
    const res = await app.request("/mcp", { method: "POST", headers: headers(bearer, sid), body: "x".repeat(256 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("should preserve the 2,000-feature result bound through native dispatch", async () => {
    const raw = new MockRawDataSource();
    const result = await raw.getZonesGeojson({ city: "longueuil" });
    const features = Array.from({ length: 2000 }, (_, index) => ({
      type: "Feature" as const, id: index, geometry: null, properties: { label: "x".repeat(300) },
    }));
    vi.spyOn(raw, "getZonesGeojson").mockResolvedValue({ ...result,
      featureCollection: { type: "FeatureCollection", features }, numberReturned: 2000, numberMatched: 2000, truncated: false });
    const app = createImmoHttpApp(config, { raw, keySource: { resolveKey: async () => publicKey } });
    const bearer = await token(); const sid = await session(app, bearer);
    const response = await app.request("/mcp", { method: "POST", headers: headers(bearer, sid), body: JSON.stringify({
      jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_zones_geojson",
        arguments: { city: "longueuil", limit: 2000, bbox: [-74, 45, -73, 46] } },
    }) });
    const payload = (await response.json()).result;
    expect(payload.isError).not.toBe(true);
    expect(JSON.stringify(payload).length).toBeGreaterThan(600_000);
    expect(JSON.parse(payload.content[0].text).featureCollection.features).toHaveLength(2000);
  });

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
    const reduced = await token("cli", "immo:read");
    const scopeDenied = await (await call(app, reduced, sid)).json();
    expect(scopeDenied.result.isError).toBe(true);
    expect(scopeDenied.result.content[0].text).toContain("scope_denied:immo:search");
    expect(effect).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(1);
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
    const audit = vi.spyOn(process.stderr, "write").mockReturnValue(true);
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
      const events = audit.mock.calls.map(([line]) => JSON.parse(String(line)))
        .filter((event) => event.kind === "immo-mcp.audit");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ tool: "get_zones_geojson", dataMode: "simulation" });
    } finally { await client.close(); await server.close(); outbound.mockRestore(); audit.mockRestore(); }
  });
});

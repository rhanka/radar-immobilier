import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { resolveAuthContext } from "./auth-context.js";
import { registerTools } from "./tools.js";
import { createImmoHttpApp } from "./server-http.js";

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "d6-test", version: "1" },
} };
const frame = (lexeme: string, id: number) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"search_lots","arguments":{"city":"valleyfield","minArea":${lexeme}}}}`;
type Rpc = { id: number; result: { isError?: boolean; content: { type: string; text: string }[] } };
function assertD6(message: Rpc) {
  expect(message.result).toEqual({ isError: true, content: [{ type: "text", text:
    "MCP error -32602: Input validation error: Invalid arguments for tool search_lots: Number must be finite at minArea",
  }] });
}
describe("D6 actual SDK byte transports", () => {
  it("rejects raw exponent lexemes on stdio before searchLots", async () => {
    const data = new MockDataSource();
    const search = vi.spyOn(data, "searchLots");
    const server = new McpServer({ name: "d6-stdio", version: "1" });
    registerTools(server, { data, raw: new MockRawDataSource(), auth: resolveAuthContext({}) });
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output });
    const send = (raw: string) => new Promise<Rpc>((resolve) => {
      lines.once("line", (line) => resolve(JSON.parse(line) as Rpc));
      input.write(raw + "\n");
    });
    try {
      await server.connect(new StdioServerTransport(input, output));
      await send(JSON.stringify(initialize));
      input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      for (const [i, lexeme] of ["1e400", "-1e400"].entries()) {
        const result = await send(frame(lexeme, i + 2));
        expect(result.id).toBe(i + 2);
        assertD6(result);
      }
      expect(search).not.toHaveBeenCalled();
      const valid = await send(frame("1e308", 4));
      expect(valid.result.isError).not.toBe(true);
      expect(search).toHaveBeenCalledOnce();
    } finally { await server.close(); lines.close(); input.destroy(); output.destroy(); }
  });

  it("rejects raw exponent lexemes after HTTP authentication and initialization", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const issuer = "https://auth.test.local";
    const resource = "https://immo.test.local/mcp";
    const data = new MockDataSource();
    const search = vi.spyOn(data, "searchLots");
    const app = createImmoHttpApp({ issuer, resource, requiredScopes: ["immo:read"],
      scopesSupported: ["immo:read", "immo:search"], port: 0, dataMode: "simulation",
    }, { data, keySource: { resolveKey: async () => publicKey } });
    const token = await new SignJWT({ scope: "immo:read immo:search", client_id: "d6-test" })
      .setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setAudience(resource)
      .setSubject("synthetic-user").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`,
      "content-type": "application/json", accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    };
    const post = (body: string) => app.request("/mcp", { method: "POST", headers, body });
    const first = await post(JSON.stringify(initialize));
    expect(first.status).toBe(200);
    await first.text();
    headers["mcp-session-id"] = first.headers.get("mcp-session-id")!;
    try {
      const ready = await post('{"jsonrpc":"2.0","method":"notifications/initialized"}');
      expect(ready.status).toBe(202);
      for (const [i, lexeme] of ["1e400", "-1e400"].entries()) {
        const response = await post(frame(lexeme, i + 2));
        expect(response.status).toBe(200);
        const text = await response.text();
        const json = response.headers.get("content-type")?.includes("text/event-stream")
          ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text;
        assertD6(JSON.parse(json) as Rpc);
      }
      expect(search).not.toHaveBeenCalled();
    } finally { await app.request("/mcp", { method: "DELETE", headers }); }
  });
});

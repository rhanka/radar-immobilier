import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildImmoServer } from "./server.js";
import { V0_TOOL_NAMES } from "./tools.js";

const STUB_ENV: NodeJS.ProcessEnv = {
  IMMO_MCP_AUTH_STUB_SUB: "test-user",
  IMMO_MCP_AUTH_STUB_TENANT: "radar",
  IMMO_MCP_AUTH_STUB_SCOPES: "immo:read immo:search immo:documents:read",
};

async function connectClient(env: NodeJS.ProcessEnv = STUB_ENV): Promise<Client> {
  const server = buildImmoServer(env);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "immo-test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: { content: unknown }): string {
  const blocks = (result.content as { type: string; text?: string }[]) ?? [];
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

describe("immo-mcp server", () => {
  it("lists exactly the 6 v0 tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...V0_TOOL_NAMES].sort());
    await client.close();
  });

  it("search_lots returns mock lots for a known city", async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: "search_lots", arguments: { city: "longueuil" } });
    const payload = JSON.parse(textOf(res as { content: unknown }));
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.lots[0]).toHaveProperty("no_lot");
    expect(payload.lots[0].city).toBe("longueuil");
    await client.close();
  });

  it("get_opportunity_dossier consolidates lots and signals", async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: "get_opportunity_dossier",
      arguments: { city: "longueuil", opportunityId: "opp-longueuil-h203" },
    });
    const payload = JSON.parse(textOf(res as { content: unknown }));
    expect(payload.found).toBe(true);
    expect(payload.dossier.lots.length).toBeGreaterThan(0);
    expect(payload.dossier.signals.length).toBeGreaterThan(0);
    await client.close();
  });

  it("read_document_excerpt redacts emails and phones (anti-PII)", async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: "read_document_excerpt",
      arguments: { documentId: "doc-longueuil-pv-2026-04-14" },
    });
    const payload = JSON.parse(textOf(res as { content: unknown }));
    expect(payload.found).toBe(true);
    expect(payload.excerpt).not.toMatch(/@[\w-]+\.[\w.-]+/);
    expect(payload.excerpt).not.toMatch(/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/);
    await client.close();
  });

  it("denies a tool when the required scope is missing", async () => {
    const client = await connectClient({
      ...STUB_ENV,
      IMMO_MCP_AUTH_STUB_SCOPES: "immo:read", // no immo:search
    });
    const res = (await client.callTool({
      name: "search_lots",
      arguments: { city: "longueuil" },
    })) as { content: unknown; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("scope_denied:immo:search");
    await client.close();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "./tools.js";
import { MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { resolveAuthContext } from "./auth-context.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const fields = [
  ["search_signals", "etape", z3.string().optional()],
  ["get_lots_geojson", "only4Plus", z3.boolean().optional()],
  ["get_lots_geojson", "superficieMinM2", z3.number().positive().optional()],
  ["get_pv_pdf", "rawRef", z3.string().min(1)],
  ["get_reglement_provenance", "zone_code", z3.string().optional()],
  ["query_zoning_events", "zone_code", z3.string().optional()],
  ["query_zoning_events", "document_type", z3.string().optional()],
  ["query_zoning_events", "decision_state", z3.string().optional()],
] as const;
const reference = new McpServer({ name: "astra-reference", version: "1" });
const current = new McpServer({ name: "astra-current", version: "1" });
const client3 = new Client({ name: "astra-reference", version: "1" });
const client4 = new Client({ name: "astra-current", version: "1" });
beforeAll(async () => {
  const shapes = new Map<string, Record<string, bundledV3.ZodTypeAny>>();
  for (const [name, field, schema] of fields) {
    if (!shapes.has(name)) shapes.set(name, {});
    shapes.get(name)![field] = schema;
  }
  for (const [name, inputSchema] of shapes) {
    reference.registerTool(name, { inputSchema }, () => ({ content: [] }));
  }
  registerTools(current, { data: new MockDataSource(), raw: new MockRawDataSource(), auth: resolveAuthContext({}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const [c, d] = InMemoryTransport.createLinkedPair();
  await Promise.all([reference.connect(a), client3.connect(b), current.connect(c), client4.connect(d)]);
});
afterAll(async () => { await Promise.all([client3.close(), client4.close(), reference.close(), current.close()]); });
describe("Astra native SDK diagnostics match the Zod 3 registrar", () => {
  for (const [name, field, schema] of fields) it(name + "/" + field, async () => {
    let checks = 0;
    for (const value of [undefined, null, 12, "", false, {}, [], NaN, 0, -1]) {
      if (schema.safeParse(value).success) continue;
      const args = { city: "test", muni_slug: "test", [field]: value };
      const expected = await client3.callTool({ name, arguments: args });
      const actual = await client4.callTool({ name, arguments: args });
      expect(expected.isError).toBe(true);
      expect(actual).toEqual(expected);
      checks++;
    }
    expect(checks).toBeGreaterThan(0);
  });
});

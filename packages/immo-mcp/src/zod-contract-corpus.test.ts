import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildImmoServer } from "./server.js";

const cases = [
  ["missing-city", "search_lots", {}],
  ["null-city", "search_lots", { city: null }],
  ["number-city", "search_lots", { city: 42 }],
  ["empty-city", "search_lots", { city: "" }],
  ["min-area-type", "search_lots", { city: "test", minArea: "1" }],
  ["min-area-zero", "search_lots", { city: "test", minArea: 0 }],
  ["min-area-negative", "search_lots", { city: "test", minArea: -1 }],
  ["limit-fraction-low", "search_lots", { city: "test", limit: -1.5 }],
  ["limit-fraction-high", "search_lots", { city: "test", limit: 101.5 }],
  ["limit-string", "search_lots", { city: "test", limit: "20" }],
  ["boolean-type", "search_signals", { city: "test", showDiscarded: "true" }],
  ["bbox-null", "get_lots_geojson", { city: "test", bbox: null }],
  ["bbox-type", "get_lots_geojson", { city: "test", bbox: "bbox" }],
  ["bbox-short", "get_lots_geojson", { city: "test", bbox: [0, 0, 1] }],
  ["bbox-long", "get_lots_geojson", { city: "test", bbox: [0, 0, 1, 1, 2] }],
  ["bbox-child", "get_lots_geojson", { city: "test", bbox: ["zero", 0, 1, 1] }],
  ["raw-limit-high", "get_lots_geojson", { city: "test", limit: 100001 }],
  ["offset-fraction", "read_document_excerpt", { documentId: "test", offset: -1.5 }],
  ["offset-string", "read_document_excerpt", { documentId: "test", offset: "0" }],
  ["excerpt-high", "read_document_excerpt", { documentId: "test", maxChars: 4001 }],
  ["excerpt-id", "read_document_excerpt", { documentId: "" }],
] as const;
const fixture = new URL("./fixtures/zod3-errors.json", import.meta.url);
describe("actual MCP argument error text from main 8156568a", () => {
  it("preserves complete SDK errors for every invalid argument family", async () => {
    const server = buildImmoServer({});
    const client = new Client({ name: "contract-corpus", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const actual: Record<string, unknown> = {};
    try {
      await Promise.all([server.connect(b), client.connect(a)]);
      for (const [key, name, args] of cases) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBe(true);
        expect((result.content as { text: string }[])[0]?.text).toMatch(/^MCP error -32602: Input validation error:/);
        actual[key] = result;
      }
      if (process.env.ZOD_CAPTURE === "1") writeFileSync(fixture,
        "{\n" + Object.entries(actual).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n") + "\n}\n");
      expect(actual).toEqual(JSON.parse(readFileSync(fixture, "utf8")));
    } finally { await client.close(); await server.close(); }
  });
});

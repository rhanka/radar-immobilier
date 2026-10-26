import { describe, expect, it } from "vitest";
import { McpSignalSearchInput } from "../../routes/mcp-signal-search.js";
import { toMcpSignalResult, projectMcpSignalResults } from "./mcp-signal-result.js";

const card = {
  id: "signal-1", citySlug: "synthetic-city", type: "Signal", label: "Label",
  description: "Evidence description", sourceRef: "raw/source", publishedAt: "2026-10-25",
  docRefs: [{ docSha: "sha", excerpt: "proof" }], regulatoryStatus: "firm" as const,
  props: { category: "ignored", properties: { category: "derogation_mineure", etape: "adoption",
    etape_date: "2026-09-01", reglement_number: "123", zone_ref: "H-1", no_lot: "42" } },
};
describe("MCP domain projection", () => {
  it("preserves nested business fields, canonical status, description and source priorities", () => {
    expect(toMcpSignalResult(card, "fallback")).toEqual({ id: "signal-1", city: "synthetic-city",
      type: "derogation_mineure", etape: "adoption", regulatoryStatus: "firm", etape_date: "2026-09-01",
      reglement_number: "123", zone_ref: "H-1", no_lot: "42", summary: "Evidence description",
      source_document_id: "raw/source" });
  });
  it("keeps absent evidence empty and falls back to the first document and label", () => {
    expect(toMcpSignalResult({ ...card, citySlug: null, sourceRef: null, description: null, props: {} }, "fallback"))
      .toMatchObject({ city: "fallback", summary: "Label", source_document_id: "sha", etape_date: "2026-10-25",
        type: "Signal", no_lot: null });
    expect(toMcpSignalResult({ ...card, sourceRef: null, docRefs: [] }, "fallback").source_document_id).toBe("");
  });
  it("filters the entire population before limit, preserving firm evidence on a late match", () => {
    const other = { ...card, id: "other", props: { properties: { etape: "avis" } } };
    const args = McpSignalSearchInput.parse({ city: "synthetic-city", etape: " ADOPTION ", query: " h-1 ", limit: 1 });
    expect(projectMcpSignalResults([other, card], args)).toEqual([toMcpSignalResult(card, args.city)]);
    expect(projectMcpSignalResults([card], { ...args, query: "missing" })).toEqual([]);
  });
});

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthContext } from "../auth-context.js";
import { registerTools, type ToolContext } from "../tools.js";
import { IMMO_TOOL_BINDINGS, IMMO_TOOL_NAMES, IMMO_TOOL_SCOPES } from "./immo-provider.js";

const calls = [
  ["search_lots", "searchLots", { city: "test-city" }],
  ["get_lot_card", "getLotCard", { city: "test-city", no_lot: "1" }],
  ["search_signals", "searchSignals", { city: "test-city" }],
  ["get_opportunity_dossier", "getOpportunityDossier", { city: "test-city", opportunityId: "1" }],
  ["list_documents", "listDocuments", {}],
  ["read_document_excerpt", "readDocumentBody", { documentId: "1", offset: 0, maxChars: 1 }],
  ["get_reglement_provenance", "getReglementProvenance", { muni_slug: "test-city" }],
  ["query_zoning_events", "queryZoningEvents", { muni_slug: "test-city" }],
  ["get_zones_geojson", "getZonesGeojson", { city: "test-city", limit: 1 }],
  ["get_lots_geojson", "getLotsGeojson", { city: "test-city", limit: 1 }],
  ["get_grille_pdf", "getGrillePdf", { city: "test-city", zone: "H-1" }],
  ["get_pv_pdf", "getPvPdf", { rawRef: "test.pdf" }],
] as const;
type Handler = (args: unknown) => Promise<unknown>;

describe("existing handler binding parity", () => {
  it.each(calls)("should bind %s to %s with its existing scope", async (name, method, args) => {
    const invoked = vi.fn();
    const seam = (context: string) => new Proxy({}, {
      get: (_target, key) => () => {
        invoked(context, key);
        throw new Error("binding-probe");
      },
    });
    const ctx: ToolContext = {
      auth: resolveAuthContext({}),
      data: seam("data") as ToolContext["data"],
      raw: seam("raw") as ToolContext["raw"],
    };
    const handlers = new Map<string, Handler>();
    const server = {
      server: { setRequestHandler: vi.fn() },
      registerTool: (tool: string, _metadata: unknown, handler: Handler) => handlers.set(tool, handler),
    } as unknown as McpServer;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      registerTools(server, ctx);
      expect(new Set(handlers.keys())).toEqual(new Set(IMMO_TOOL_NAMES));
      const handler = handlers.get(name)!;
      await handler(args);
      expect(invoked).toHaveBeenCalledExactlyOnceWith(IMMO_TOOL_BINDINGS[name].context, method);
      invoked.mockClear();
      ctx.auth.scopes = ctx.auth.scopes.filter((scope) => scope !== IMMO_TOOL_SCOPES[name]);
      const denied = await handler(args);
      expect(invoked).not.toHaveBeenCalled();
      expect(JSON.stringify(denied)).toContain(`scope_denied:${IMMO_TOOL_SCOPES[name]}`);
    } finally {
      stderr.mockRestore();
    }
  });
});

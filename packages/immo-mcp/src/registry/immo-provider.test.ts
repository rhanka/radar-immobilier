import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMMO_ENTRY_SCOPE,
  IMMO_PROVIDER_ID,
  IMMO_TOOL_BINDINGS,
  IMMO_TOOL_NAMES,
  IMMO_TOOL_SCOPES,
  isImmoToolName,
} from "./immo-provider.js";
import { ALL_TOOL_NAMES } from "../tools.js";

const config = JSON.parse(readFileSync(
  new URL("../../config/immo-tools.v1.json", import.meta.url),
  "utf8",
)) as {
  provider: { id: string; centralRegistryRequest: string };
  entryScope: string;
  tools: { name: string; scope: string; binding: { context: string; registeredBy: string } }[];
  compatibility: { toolCount: number };
};

describe("Immo provider definition", () => {
  it("should lock exactly the twelve public tool names", () => {
    expect([...IMMO_TOOL_NAMES]).toEqual([
      "search_lots",
      "get_lot_card",
      "search_signals",
      "get_opportunity_dossier",
      "list_documents",
      "read_document_excerpt",
      "get_reglement_provenance",
      "query_zoning_events",
      "get_zones_geojson",
      "get_lots_geojson",
      "get_grille_pdf",
      "get_pv_pdf",
    ]);
  });

  it("should bind every tool to the existing registerTools seams", () => {
    expect(IMMO_PROVIDER_ID).toBe("immo");
    for (const name of IMMO_TOOL_NAMES) {
      expect(IMMO_TOOL_BINDINGS[name].registeredBy).toBe("registerTools");
    }
    const dataTools = IMMO_TOOL_NAMES.filter((n) => IMMO_TOOL_BINDINGS[n].context === "data");
    const rawTools = IMMO_TOOL_NAMES.filter((n) => IMMO_TOOL_BINDINGS[n].context === "raw");
    expect(dataTools).toHaveLength(6);
    expect(rawTools).toHaveLength(6);
  });

  it("should cover exactly the tools registered by the server", () => {
    expect(new Set(IMMO_TOOL_NAMES)).toEqual(new Set(ALL_TOOL_NAMES));
  });

  it("should keep the embedded config aligned with the definition", () => {
    expect(config.provider.id).toBe(IMMO_PROVIDER_ID);
    expect(config.provider.centralRegistryRequest).toBe("never");
    expect(config.entryScope).toBe(IMMO_ENTRY_SCOPE);
    expect(config.compatibility.toolCount).toBe(12);
    expect(config.tools.map((t) => t.name)).toEqual([...IMMO_TOOL_NAMES]);
    for (const tool of config.tools) {
      expect(tool.scope).toBe(IMMO_TOOL_SCOPES[tool.name as (typeof IMMO_TOOL_NAMES)[number]]);
      expect(tool.binding).toEqual(IMMO_TOOL_BINDINGS[tool.name as (typeof IMMO_TOOL_NAMES)[number]]);
    }
  });

  it("should never present a test capture as production configuration", () => {
    expect(config).not.toHaveProperty("captures");
    expect(config).not.toHaveProperty("calls");
  });

  it("should recognise only the twelve locked names", () => {
    expect(isImmoToolName("search_signals")).toBe(true);
    expect(isImmoToolName("artifacts_ensure")).toBe(false);
    expect(isImmoToolName("")).toBe(false);
  });
});

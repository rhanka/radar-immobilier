import { describe, expect, it } from "vitest";
import { HttpDataSource, MockDataSource } from "./data-source.js";
import { captureInvocationContext } from "./invocation-context.js";
import { HttpRawDataSource, MockRawDataSource } from "./raw-data.js";
import { RadarSignalReadError } from "./signal-read-error.js";
import { signalSearchBody, signalSearchItem } from "./signal-search-test-fixture.js";
import { assertNoFixtureOnConnectedServer } from "./server-http.js";
import { invokeTool } from "./tools.js";

/**
 * Contract for #1063: a connected (real/http) MCP never serves fixtures.
 * Every response carries `source: "live" | "fixture"`; in real mode no
 * response may carry `source: "fixture"`, and a domain tool that is not
 * wired to the radar API fails with an explicit `not_wired` error instead
 * of returning fixture rows.
 */

const SCOPES = ["immo:read", "immo:search", "immo:documents:read"];

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  search_lots: { city: "longueuil", limit: 2 },
  get_lot_card: { city: "longueuil", no_lot: "6 359 591" },
  search_signals: { city: "longueuil", limit: 2 },
  get_opportunity_dossier: { city: "longueuil", opportunityId: "opp-longueuil-h203" },
  list_documents: { city: "longueuil", limit: 2 },
  read_document_excerpt: { documentId: "doc-longueuil-pv-2026-04-14", offset: 0, maxChars: 50 },
  get_zones_geojson: { city: "longueuil", limit: 2 },
  get_lots_geojson: { city: "longueuil", limit: 2 },
  get_grille_pdf: { city: "longueuil", zone: "H-203" },
  get_pv_pdf: { rawRef: "raw/proces-verbaux-longueuil/2026-04-14.pdf" },
  get_reglement_provenance: { muni_slug: "longueuil" },
  query_zoning_events: { muni_slug: "longueuil" },
};

const NOT_WIRED_TOOLS = [
  "search_lots",
  "get_lot_card",
  "get_opportunity_dossier",
  "list_documents",
  "read_document_excerpt",
] as const;

const ALL_TOOLS = Object.keys(TOOL_ARGS);

function liveFeatureCollection(): Response {
  return Response.json({
    type: "FeatureCollection",
    numberMatched: 1,
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: {
          NO_LOT: "1 000 001",
          ZONE: "H-999",
          zone_code: "H-999",
          URL_GRILLE: "https://api.test.local/grille.pdf",
          reglement_url: "https://api.test.local/reglement.pdf",
          reglement_numero: "R-LIVE-1",
        },
      },
    ],
  });
}

async function liveFetch(url: string): Promise<Response> {
  if (url.includes("/api/v1/mcp/facets/signals/search")) {
    return Response.json(signalSearchBody("longueuil", [signalSearchItem("longueuil", { id: "live-signal-1" })]));
  }
  if (url.includes("/api/documents/raw")) {
    return new Response("%PDF-live", { status: 200, headers: { "content-type": "application/pdf" } });
  }
  return liveFeatureCollection();
}

function context(dataMode: "real" | "simulation", data: unknown, raw: unknown) {
  return captureInvocationContext({
    auth: {
      sub: "user-1",
      userId: "user-1",
      tenantId: "radar",
      roles: ["viewer"],
      scopes: SCOPES,
      workspaces: ["default"],
      dataMode,
      audience: "mcp/immo",
    },
    data: data as never,
    raw: raw as never,
  });
}

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("source provenance contract (#1063)", () => {
  it("should never return source fixture in real mode when the server is connected to the radar API", async () => {
    const ctx = context(
      "real",
      new HttpDataSource({ baseUrl: "https://api.test.local", fetchImpl: liveFetch as typeof fetch }),
      new HttpRawDataSource({
        baseUrl: "https://api.test.local",
        publicBaseUrl: "https://api.test.local",
        fetchImpl: liveFetch as typeof fetch,
      }),
    );
    for (const name of ALL_TOOLS) {
      const result = await invokeTool(name, TOOL_ARGS[name]!, ctx);
      const payload = parse(result);
      expect(payload["source"], name).not.toBe("fixture");
      expect(result.content[0]!.text, name).not.toContain("sig-longueuil-001");
      expect(result.content[0]!.text, name).not.toContain("CO-2026-1187");
      if ((NOT_WIRED_TOOLS as readonly string[]).includes(name)) {
        expect(result.isError, name).toBe(true);
        expect(payload["source"], name).toBe("live");
        expect(result.content[0]!.text, name).toContain("not_wired");
      } else {
        expect(result.isError, name).toBeFalsy();
        expect(payload["source"], name).toBe("live");
      }
    }
  });

  it("should label every fixture response as source fixture in simulation mode", async () => {
    const ctx = context("simulation", new MockDataSource(), new MockRawDataSource());
    for (const name of ALL_TOOLS) {
      const result = await invokeTool(name, TOOL_ARGS[name]!, ctx);
      expect(result.isError, name).toBeFalsy();
      expect(parse(result)["source"], name).toBe("fixture");
    }
  });

  it("should carry source live on a typed search_signals error in real mode", async () => {
    const ctx = context(
      "real",
      new HttpDataSource({
        baseUrl: "https://api.test.local",
        fetchImpl: (async () => Response.json({ error: "unavailable" }, { status: 503 })) as typeof fetch,
      }),
      new HttpRawDataSource({
        baseUrl: "https://api.test.local",
        publicBaseUrl: "https://api.test.local",
        fetchImpl: liveFetch as typeof fetch,
      }),
    );
    const result = await invokeTool("search_signals", TOOL_ARGS["search_signals"]!, ctx);
    const payload = parse(result);
    expect(result.isError).toBe(true);
    expect(payload["error"]).toBe("radar_api_unavailable");
    expect(payload["upstreamStatus"]).toBe(503);
    expect(payload["source"]).toBe("live");
  });

  it("should carry source fixture on a typed search_signals error in simulation mode", async () => {
    const failingMock = {
      mode: "mock" as const,
      searchSignals: async (): Promise<never> => {
        throw new RadarSignalReadError("radar_api_unavailable", 503);
      },
    };
    const ctx = context("simulation", failingMock, new MockRawDataSource());
    const result = await invokeTool("search_signals", TOOL_ARGS["search_signals"]!, ctx);
    const payload = parse(result);
    expect(result.isError).toBe(true);
    expect(payload["error"]).toBe("radar_api_unavailable");
    expect(payload["source"]).toBe("fixture");
  });

  it("should refuse to start a real-configured connected server without the live API", () => {
    expect(() => assertNoFixtureOnConnectedServer({ IMMO_MCP_DATA_MODE: "http" })).toThrow(/^config_error: RADAR_API_BASE_URL is required/);
    expect(() => assertNoFixtureOnConnectedServer({ IMMO_MCP_DATA_MODE: "http", RADAR_API_BASE_URL: "https://api.test.local" })).not.toThrow();
    expect(() => assertNoFixtureOnConnectedServer({ IMMO_MCP_DATA_MODE: "mock" })).not.toThrow();
    expect(() => assertNoFixtureOnConnectedServer({})).not.toThrow();
  });

  it("should fail unwired domain tools with an explicit not_wired error in http mode", async () => {
    const data = new HttpDataSource({
      baseUrl: "https://api.test.local",
      fetchImpl: liveFetch as typeof fetch,
    });
    await expect(data.getLotCard({ city: "longueuil", no_lot: "6 359 591" })).rejects.toThrow(/^not_wired:/);
    await expect(data.searchLots({ city: "longueuil", limit: 1 })).rejects.toThrow(/^not_wired:/);
    await expect(data.listDocuments({ limit: 1 })).rejects.toThrow(/^not_wired:/);
  });
});

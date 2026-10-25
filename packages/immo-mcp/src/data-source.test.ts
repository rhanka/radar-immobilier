import { describe, expect, it, vi } from "vitest";
import {
  createDataSource,
  HttpDataSource,
  MockDataSource,
} from "./data-source.js";

const BASE = "http://radar-api:3000";

/** A realistic `/api/graph-signals/:city` node card (shape mirrors the api route). */
function signalNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sig-mont-tremblant-001",
    type: "Signal",
    label: "Dérogation mineure 2025-DM-042",
    citySlug: "mont-tremblant",
    sourceRef: "raw/proces-verbaux-mont-tremblant/cas/abc.pdf",
    description:
      "Demande de dérogation mineure visant la marge avant au 123 chemin du Village.",
    publishedAt: "2025-06-10",
    docRefs: [{ docSha: "abc123", excerpt: "Le conseil accorde la dérogation…" }],
    props: {
      properties: {
        category: "derogation_mineure",
        etape: "accorde",
        etape_date: "2025-06-10",
        reglement_number: "2025-DM-042",
        zone_ref: "V-101",
        no_lot: "5 013 224",
        description:
          "Demande de dérogation mineure visant la marge avant au 123 chemin du Village.",
      },
    },
    ...overrides,
  };
}

function apiResponse(nodes: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ ok: true, citySlug: "mont-tremblant", nodes }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createDataSource", () => {
  it("defaults to mock without RADAR_API_BASE_URL and to http with it", () => {
    expect(createDataSource({}).mode).toBe("mock");
    expect(createDataSource({ RADAR_API_BASE_URL: BASE }).mode).toBe("http");
  });
});

describe("MockDataSource.searchSignals (documents the bug)", () => {
  it("returns ZERO signals for a real city absent from the fixtures", async () => {
    // This is exactly the prod symptom: the remote MCP was pinned to the mock
    // source, so mont-tremblant/rosemere/sainte-catherine all came back count 0.
    const mock = new MockDataSource();
    const out = await mock.searchSignals({ city: "mont-tremblant", limit: 20 });
    expect(out).toHaveLength(0);
  });

  it("still serves its demo cities (no regression)", async () => {
    const mock = new MockDataSource();
    const out = await mock.searchSignals({ city: "longueuil", limit: 20 });
    expect(out.length).toBeGreaterThan(0);
  });
});




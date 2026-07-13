import { describe, expect, it, vi } from "vitest";
import {
  createDataSource,
  HttpDataSource,
  MockDataSource,
  toMockSignal,
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

describe("HttpDataSource.searchSignals (the fix — REAL signals)", () => {
  function source(fetchImpl: typeof fetch): HttpDataSource {
    return new HttpDataSource({ baseUrl: BASE, fetchImpl });
  }

  it("hits GET /api/graph-signals/<slug>, forwards the USER token, returns >=1 real signal", async () => {
    const fetchImpl = vi.fn(async () => apiResponse([signalNode()]));
    const out = await source(fetchImpl as unknown as typeof fetch).searchSignals(
      { city: "Mont-Tremblant", limit: 20 }, // mixed case + accent → normalised to slug
      { accessToken: "user-token-xyz" }, // per-user identity (D4)
    );

    const call = fetchImpl.mock.calls[0] as unknown[];
    const url = String(call[0]);
    expect(url).toBe(`${BASE}/api/graph-signals/mont-tremblant`);
    // The user's OWN bearer is forwarded so the api applies per-user auth.
    const init = call[1] as { headers?: Record<string, string> };
    expect(init.headers?.authorization).toBe("Bearer user-token-xyz");

    expect(out).toHaveLength(1);
    const sig = out[0]!;
    // Real data mapped through — not a marker, not a fixture.
    expect(sig.id).toBe("sig-mont-tremblant-001");
    expect(sig.city).toBe("mont-tremblant");
    expect(sig.type).toBe("derogation_mineure"); // props.properties.category
    expect(sig.etape).toBe("accorde");
    expect(sig.etape_date).toBe("2025-06-10");
    expect(sig.reglement_number).toBe("2025-DM-042");
    expect(sig.zone_ref).toBe("V-101");
    expect(sig.no_lot).toBe("5 013 224");
    expect(sig.summary).toContain("dérogation mineure");
    expect(sig.source_document_id).toContain("proces-verbaux-mont-tremblant");
  });

  it("applies the etape filter client-side", async () => {
    const fetchImpl = vi.fn(async () =>
      apiResponse([
        signalNode({ id: "a", props: { properties: { etape: "avis_motion" } } }),
        signalNode({ id: "b", props: { properties: { etape: "accorde" } } }),
      ]),
    );
    const out = await source(fetchImpl as unknown as typeof fetch).searchSignals({
      city: "mont-tremblant",
      etape: "avis_motion",
      limit: 20,
    });
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });

  it("applies the free-text query filter and the limit", async () => {
    const fetchImpl = vi.fn(async () =>
      apiResponse([
        signalNode({ id: "a", description: "rezonage secteur nord", props: {} }),
        signalNode({ id: "b", description: "dérogation mineure", props: {} }),
        signalNode({ id: "c", description: "rezonage secteur sud", props: {} }),
      ]),
    );
    const src = source(fetchImpl as unknown as typeof fetch);
    const rezonage = await src.searchSignals({ city: "x", query: "rezonage", limit: 20 });
    expect(rezonage.map((s) => s.id)).toEqual(["a", "c"]);
    const limited = await src.searchSignals({ city: "x", query: "rezonage", limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("maps a 404 (city has no signal node) to an EMPTY list, not an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const out = await source(fetchImpl as unknown as typeof fetch).searchSignals({
      city: "ville-sans-signal",
      limit: 20,
    });
    expect(out).toHaveLength(0);
  });

  it("throws an explicit error on a non-404 upstream failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(
      source(fetchImpl as unknown as typeof fetch).searchSignals({ city: "x", limit: 20 }),
    ).rejects.toThrow(/radar_api_error:500/);
  });

  it("sends NO Authorization header when the user is not authenticated", async () => {
    // No accessToken → no header → the protected api will 401 (never anonymous data).
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      source(fetchImpl as unknown as typeof fetch).searchSignals({ city: "x", limit: 20 }),
    ).rejects.toThrow(/unauthenticated/);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as { headers?: Record<string, string> };
    expect(init.headers?.authorization).toBeUndefined();
  });

  it("maps a 401/403 (rejected user token) to an explicit unauthenticated error", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response("{}", { status }));
      await expect(
        source(fetchImpl as unknown as typeof fetch).searchSignals(
          { city: "mont-tremblant", limit: 20 },
          { accessToken: "expired-or-wrong" },
        ),
      ).rejects.toThrow(/unauthenticated/);
    }
  });

  it("the other v0 domain tools remain not_wired_yet (honest limit)", async () => {
    const src = source(vi.fn() as unknown as typeof fetch);
    await expect(src.searchLots({ city: "x", limit: 20 })).rejects.toThrow(/not_wired_yet/);
    await expect(src.listDocuments({ limit: 20 })).rejects.toThrow(/not_wired_yet/);
  });
});

describe("toMockSignal (anti-invention normaliser)", () => {
  it("never fabricates: missing fields become empty string / null", () => {
    const sig = toMockSignal({ id: "bare" }, "delson");
    expect(sig).toEqual({
      id: "bare",
      city: "delson", // fallback when the node carries no citySlug
      type: "",
      etape: "",
      etape_date: "",
      reglement_number: "",
      zone_ref: "",
      no_lot: null,
      summary: "",
      source_document_id: "",
    });
  });

  it("falls back to the graph node type when no category is present", () => {
    const sig = toMockSignal(
      { id: "d", type: "DesignationEvent", label: "Zone désignée" },
      "delson",
    );
    expect(sig.type).toBe("DesignationEvent");
    expect(sig.summary).toBe("Zone désignée");
  });
});

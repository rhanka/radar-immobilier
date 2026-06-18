/**
 * WP A.3.x — Graph-signals route unit tests.
 *
 * Tests the Hono route layer for graph-signals endpoints.
 * Uses vitest.mock to mock graph-store functions — no Postgres required.
 *
 * Endpoints under test:
 *   GET /api/graph-signals/by-city  — aggregate signal counts per city
 *   GET /api/graph-signals/:city    — Signal+DesignationEvent nodes for one city
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";

import { graphSignalsRoute } from "./graph-signals.js";
import type { Database } from "../db/client.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";

// Mock the graph-store module so tests do not touch Postgres.
vi.mock("../services/graph/graph-store.js", () => ({
  listCitiesWithSignalNodes: vi.fn(),
  getSignalNodesForCity: vi.fn(),
}));

import {
  listCitiesWithSignalNodes,
  getSignalNodesForCity,
} from "../services/graph/graph-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const value = this.objects.get(key);
    return value ? { key, size: value.byteLength } : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}

async function seedPdf(store: ObjectStore) {
  const record = buildRawDocumentRecord({
    source: "proces-verbaux-drummondville",
    sourceUrl: "https://drummondville.ca/pv/2026-05-12.pdf",
    title: "Proces-verbal du 12 mai 2026",
    publishedAt: "2026-05-12",
    body: new TextEncoder().encode("%PDF-1.4"),
    fetchedAt: "2026-06-08T09:30:00.000Z",
    contentType: "application/pdf",
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
  });
  await store.put(record.storageKey, "%PDF-1.4", "application/pdf");
  await store.put(rawMetaKey(record.storageKey), JSON.stringify(record, null, 2));
  return record;
}

function makeNode(
  id: string,
  citySlug: string,
  type = "Signal",
  props: Record<string, unknown> = {},
) {
  return {
    id,
    citySlug,
    type,
    label: `Node ${id}`,
    props,
    sourceRef: null,
    createdAt: new Date("2025-03-15T10:00:00Z"),
  };
}

// Minimal mock DB (never actually called — graph-store is mocked).
const mockDb = {} as unknown as Database;
const freshRoute = (store: ObjectStore = new MemoryStore()) =>
  graphSignalsRoute({ db: mockDb, store });

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/graph-signals/by-city", () => {
  it("returns ok:true with empty cities when no signal nodes exist", async () => {
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValueOnce([]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/by-city");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalCount: number;
      cities: { citySlug: string; signalCount: number; subsetCounts: Record<string, number> }[];
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(0);
    expect(body.cities).toEqual([]);
  });

  it("returns ok:true with city list, correct totalCount et subsetCounts", async () => {
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValueOnce([
      {
        citySlug: "drummondville",
        signalCount: 5,
        subsetCounts: { "": 5, "z": 4, "m": 2, "p": 1, "z|m": 2, "z|p": 1, "m|p": 0, "z|m|p": 0 },
      },
      {
        citySlug: "saint-constant",
        signalCount: 3,
        subsetCounts: { "": 3, "z": 1, "m": 0, "p": 0, "z|m": 0, "z|p": 0, "m|p": 0, "z|m|p": 0 },
      },
    ]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/by-city");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      totalCount: number;
      cities: {
        citySlug: string;
        signalCount: number;
        subsetCounts: Record<string, number>;
      }[];
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(8);
    expect(body.cities).toHaveLength(2);
    // Drummondville : monotonie subsetCounts vérifiée
    const drummond = body.cities[0]!;
    expect(drummond.citySlug).toBe("drummondville");
    expect(drummond.subsetCounts["z"]).toBe(4);
    expect(drummond.subsetCounts["z|m"]).toBe(2);
    expect(drummond.subsetCounts["z|m|p"]).toBe(0);
    // Monotonie : z|m ≤ z ≤ ""
    expect(drummond.subsetCounts["z|m"]).toBeLessThanOrEqual(drummond.subsetCounts["z"]!);
    expect(drummond.subsetCounts["z"]).toBeLessThanOrEqual(drummond.subsetCounts[""]!);
    // Saint-Constant
    const stconst = body.cities[1]!;
    expect(stconst.subsetCounts["z"]).toBeLessThanOrEqual(stconst.subsetCounts[""]!);
    expect(stconst.subsetCounts["z|m"]).toBe(0);
  });
});

describe("GET /api/graph-signals/:city", () => {
  it("returns 404 with ok:false when no signal nodes exist for the city", async () => {
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/ville-inconnue");

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      citySlug: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("no_signal_nodes");
    expect(body.citySlug).toBe("ville-inconnue");
  });

  it("returns ok:true with mapped nodes for a city with signal nodes", async () => {
    const nodes = [
      makeNode("sig-001", "drummondville", "Signal"),
      makeNode("evt-002", "drummondville", "DesignationEvent"),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(nodes as ReturnType<typeof makeNode>[]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      nodes: { id: string; type: string; label: string; createdAt: string | null }[];
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("drummondville");
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]!.id).toBe("sig-001");
    expect(body.nodes[0]!.type).toBe("Signal");
    expect(body.nodes[1]!.type).toBe("DesignationEvent");
    // createdAt is serialized to ISO string
    expect(body.nodes[0]!.createdAt).toBe("2025-03-15T10:00:00.000Z");
  });

  it("returns ok:true with props and sourceRef when present", async () => {
    const nodeWithProps = {
      ...makeNode("sig-003", "drummondville", "Signal"),
      sourceRef: "s3://bucket/proc-verbal.pdf",
      props: { reglement_number: "1234-56", zone_ref: "H-431" },
    };
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([nodeWithProps] as unknown as ReturnType<typeof makeNode>[]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      nodes: { sourceRef: string | null; props: Record<string, unknown> }[];
    };
    expect(body.nodes[0]!.sourceRef).toBe("s3://bucket/proc-verbal.pdf");
    expect(body.nodes[0]!.props).toEqual({ reglement_number: "1234-56", zone_ref: "H-431" });
  });

  it("enriches node cards with description, citation, source PDF and document date", async () => {
    const store = new MemoryStore();
    const record = await seedPdf(store);
    const node = makeNode("sig-004", "drummondville", "Signal", {
      description: "Avis de motion pour un changement de zonage.",
      refs: [
        {
          rawRef: record.storageKey,
          excerpt: "Avis de motion est donné pour modifier le règlement de zonage.",
          page: 3,
        },
      ],
    });
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([node] as unknown as ReturnType<typeof makeNode>[]);

    const app = freshRoute(store);
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{
        description: string;
        publishedAt: string;
        docRefs: Array<{
          docSha: string;
          rawRef: string;
          sourceUrl: string;
          documentUrl: string;
          publishedAt: string;
          excerpt: string;
          page: number;
        }>;
      }>;
    };
    expect(body.nodes[0]!.description).toBe(
      "Avis de motion pour un changement de zonage.",
    );
    expect(body.nodes[0]!.publishedAt).toBe("2026-05-12");
    expect(body.nodes[0]!.docRefs[0]).toMatchObject({
      docSha: record.sha256,
      rawRef: record.storageKey,
      sourceUrl: "https://drummondville.ca/pv/2026-05-12.pdf",
      documentUrl: `/api/documents/raw?rawRef=${encodeURIComponent(record.storageKey)}`,
      publishedAt: "2026-05-12",
      excerpt: "Avis de motion est donné pour modifier le règlement de zonage.",
      page: 3,
    });
  });

  it("keeps a raw document link when metadata is missing but the raw key is resolvable", async () => {
    const legacyRawRef = "/tmp/scw-docs/raw/proces-verbaux-testville/cas/abc123.pdf";
    const node = makeNode("sig-005", "drummondville", "Signal", {
      refs: [
        {
          rawRef: legacyRawRef,
          excerpt: "Le conseil donne un avis de motion.",
        },
      ],
    });
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([node] as unknown as ReturnType<typeof makeNode>[]);

    const app = freshRoute();
    const res = await app.request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{
        docRefs: Array<{ rawRef: string; documentUrl: string; excerpt: string }>;
      }>;
    };
    expect(body.nodes[0]!.docRefs[0]).toMatchObject({
      rawRef: "raw/proces-verbaux-testville/cas/abc123.pdf",
      documentUrl:
        "/api/documents/raw?rawRef=raw%2Fproces-verbaux-testville%2Fcas%2Fabc123.pdf",
      excerpt: "Le conseil donne un avis de motion.",
    });
  });
});

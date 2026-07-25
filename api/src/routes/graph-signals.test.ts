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
vi.mock("../services/graph/graph-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/graph/graph-store.js")>();
  return {
    ...actual,
    listCitiesWithSignalNodes: vi.fn(),
    getSignalNodesForCity: vi.fn(),
  };
});

import {
  buildNodeRow,
  listCitiesWithSignalNodes,
  getSignalNodesForCity,
} from "../services/graph/graph-store.js";
import {
  SUTTON_A_IDS,
  SUTTON_LEGACY_GRAPH_NODES,
} from "../services/graph/sutton-legacy.fixture.js";

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

/**
 * Store qui simule une PANNE object-store (S3) pour toute clé contenant
 * `poison` : `head`/`get`/`list` jettent. Reproduit le cas prod « objet S3
 * manquant / réseau qui casse » à l'origine du 500 « Signaux indisponibles »
 * (les clés saines passent normalement via le MemoryStore parent).
 */
class FlakyStore extends MemoryStore {
  constructor(private readonly poison: string) {
    super();
  }

  override async head(key: string): Promise<ObjectInfo | null> {
    if (key.includes(this.poison)) throw new Error(`S3 head failed for ${key}`);
    return super.head(key);
  }

  override async get(key: string): Promise<Uint8Array> {
    if (key.includes(this.poison)) throw new Error(`S3 get failed for ${key}`);
    return super.get(key);
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

/**
 * Store dont `head`/`get` NE RÉPONDENT JAMAIS (promesse pendante) : reproduit
 * un S3 qui pend (ETIMEDOUT sans fin). Sert à prouver que le budget temps
 * global rend la main — l'endpoint répond quand même, refs dégradées.
 */
class HangingStore extends MemoryStore {
  override head(): Promise<ObjectInfo | null> {
    return new Promise<ObjectInfo | null>(() => {});
  }

  override get(): Promise<Uint8Array> {
    return new Promise<Uint8Array>(() => {});
  }
}

/** Store qui COMPTE les accès par clé (preuve du cache par requête). */
class CountingStore extends MemoryStore {
  readonly headCalls = new Map<string, number>();
  readonly getCalls = new Map<string, number>();

  override async head(key: string): Promise<ObjectInfo | null> {
    this.headCalls.set(key, (this.headCalls.get(key) ?? 0) + 1);
    return super.head(key);
  }

  override async get(key: string): Promise<Uint8Array> {
    this.getCalls.set(key, (this.getCalls.get(key) ?? 0) + 1);
    return super.get(key);
  }
}

// Minimal mock DB (never actually called — graph-store is mocked).
const mockDb = {} as unknown as Database;
const freshRoute = (store: ObjectStore = new MemoryStore(), docEnrichmentBudgetMs?: number) =>
  graphSignalsRoute({
    db: mockDb,
    store,
    ...(docEnrichmentBudgetMs !== undefined ? { docEnrichmentBudgetMs } : {}),
  });

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

  it("returns city list with legacy subset counts and v2 named counters", async () => {
    vi.mocked(listCitiesWithSignalNodes).mockResolvedValueOnce([
      {
        citySlug: "drummondville",
        signalCount: 5,
        subsetCounts: {
          "": 5, "z": 4, "m": 2, "p": 1, "r": 5,
          "z|m": 2, "z|p": 1, "z|r": 4, "m|p": 0, "m|r": 2, "p|r": 1,
          "z|m|p": 0, "z|m|r": 2, "z|p|r": 1, "m|p|r": 0,
          "z|m|p|r": 0,
        },
        vivierV2Counts: {
          qualified: 2,
          residentialUnknown: 2,
          excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 1, derogation_hors_sujet: 0 },
          stageCounts: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsResOui: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsResOuiHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          total: 5,
        },
      },
      {
        citySlug: "saint-constant",
        signalCount: 3,
        subsetCounts: {
          "": 3, "z": 1, "m": 0, "p": 0, "r": 3,
          "z|m": 0, "z|p": 0, "z|r": 1, "m|p": 0, "m|r": 0, "p|r": 0,
          "z|m|p": 0, "z|m|r": 0, "z|p|r": 0, "m|p|r": 0,
          "z|m|p|r": 0,
        },
        vivierV2Counts: {
          qualified: 1,
          residentialUnknown: 1,
          excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 1, derogation_hors_sujet: 0 },
          stageCounts: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsResOui: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          stageCountsResOuiHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
          total: 3,
        },
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
        vivierV2Counts: Record<string, unknown>;
      }[];
    };
    expect(body.ok).toBe(true);
    expect(body.totalCount).toBe(8);
    expect(body.cities).toHaveLength(2);
    const drummond = body.cities[0]!;
    expect(drummond.citySlug).toBe("drummondville");
    expect(drummond.subsetCounts["z"]).toBe(4);
    expect(drummond.vivierV2Counts.qualified).toBe(2);
    expect(drummond.vivierV2Counts.total).toBe(5);
    const stconst = body.cities[1]!;
    expect(stconst.subsetCounts["z|m|p"]).toBe(0);
    expect(stconst.vivierV2Counts.residentialUnknown).toBe(1);

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
      nodes: Array<{
        id: string;
        type: string;
        label: string;
        createdAt: string | null;
        legacySubset: { version: string; signalId: string; flags: { z: boolean; m: boolean; p: boolean } };
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("drummondville");
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]!.id).toBe("sig-001");
    expect(body.nodes[0]!.type).toBe("Signal");
    expect(body.nodes[1]!.type).toBe("DesignationEvent");
    expect(body.nodes[0]!.legacySubset).toEqual({
      version: "legacy-zmp-v1",
      signalId: "sig-001",
      flags: { z: false, m: false, p: false },
    });
    // createdAt is serialized to ISO string
    expect(body.nodes[0]!.createdAt).toBe("2025-03-15T10:00:00.000Z");
  });

  it("returns the real Sutton A/T IDs and counts from the detail authority", async () => {
    const nodes = SUTTON_LEGACY_GRAPH_NODES.map((node) => ({
      ...buildNodeRow(node, "sutton"),
      createdAt: new Date("2026-07-14T00:00:00Z"),
      updatedAt: new Date("2026-07-14T00:00:00Z"),
    }));
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(nodes as Awaited<ReturnType<typeof getSignalNodesForCity>>);

    const res = await freshRoute().request("/api/graph-signals/sutton");
    const body = (await res.json()) as {
      legacyProjection: {
        version: string;
        a: { count: number; signalIds: string[] };
      };
    };

    expect(res.status).toBe(200);
    // Seule A subsiste : la projection `transition` (z|p) est retirée avec le
    // mode « Transition vers B » de l'UI, remplacé par B (vivier v2).
    expect(body.legacyProjection).toEqual({
      version: "legacy-zmp-v1",
      a: { count: 1, signalIds: SUTTON_A_IDS },
    });
    expect(body.legacyProjection).not.toHaveProperty("transition");
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

  it("returns the auditable B′ classification without mutating signal provenance", async () => {
    const node = {
      ...makeNode("sig-bprime", "drummondville", "Signal"),
      sourceRef: "pv-42",
      props: {
        properties: {
          category: "rezonage",
          etape: "",
          extrait: "Pôle commercial régional",
        },
      },
      label: "Avis de motion — pôle commercial régional — projet résidentiel",
    };
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([node] as unknown as ReturnType<typeof makeNode>[]);

    const res = await freshRoute().request("/api/graph-signals/drummondville");
    const body = (await res.json()) as {
      nodes: Array<{
        props: Record<string, unknown>;
        bPrime: Record<string, unknown>;
        classification: Record<string, unknown>;
      }>;
    };
    expect(body.nodes[0]!.props).toEqual(node.props);
    expect(body.nodes[0]!.bPrime).toMatchObject({
      etape: "inconnu",
      etapeAnnotation: { raw: "", valid: false },
      exclusionReason: "pole_commercial_regional",
      provenance: { extrait: "Pôle commercial régional", source: "pv-42" },
      effetDensifiant: "inconnu",
    });
    // The same B′ exclusion is present on the active B wire classification.
    // R4 : le pôle commercial régional est désormais exclu par RAISON NOMMÉE dans
    // le chemin résidentiel serveur (source auditable), sans changer valeur ni
    // exclusion_reason.
    expect(body.nodes[0]!.classification).toMatchObject({
      residentiel: { valeur: "non", source: "classifyBPrime:R4_pole_commercial_regional" },
      exclusion_reason: "non_residentiel_franc",
    });
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
        evidence: {
          description: string | null;
          citation: string | null;
          sourceUrl: string | null;
          documentUrl: string | null;
          documentDate: string | null;
          page: number | null;
          completeness: { missing: string[] };
        };
      }>;
    };
    const evidence = body.nodes[0]!.evidence;
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
    expect(evidence.description).toBe("Avis de motion pour un changement de zonage.");
    expect(evidence.citation).toBe("Avis de motion est donné pour modifier le règlement de zonage.");
    expect(evidence.sourceUrl).toBe("https://drummondville.ca/pv/2026-05-12.pdf");
    expect(evidence.documentUrl).toBe(`/api/documents/raw?rawRef=${encodeURIComponent(record.storageKey)}`);
    expect(evidence.documentDate).toBe("2026-05-12");
    expect(evidence.page).toBe(3);
    expect(evidence.completeness.missing).toEqual(["bbox"]);
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
        evidence: {
          rawRef: string | null;
          documentUrl: string | null;
          citation: string | null;
          completeness: { hasPdfLink: boolean; missing: string[] };
        };
      }>;
    };
    expect(body.nodes[0]!.docRefs[0]).toMatchObject({
      rawRef: "raw/proces-verbaux-testville/cas/abc123.pdf",
      documentUrl:
        "/api/documents/raw?rawRef=raw%2Fproces-verbaux-testville%2Fcas%2Fabc123.pdf",
      excerpt: "Le conseil donne un avis de motion.",
    });
    const evidence = body.nodes[0]!.evidence;
    expect(evidence.rawRef).toBe("raw/proces-verbaux-testville/cas/abc123.pdf");
    expect(evidence.documentUrl).toBe(
      "/api/documents/raw?rawRef=raw%2Fproces-verbaux-testville%2Fcas%2Fabc123.pdf",
    );
    expect(evidence.citation).toBe("Le conseil donne un avis de motion.");
    expect(evidence.completeness.hasPdfLink).toBe(true);
    expect(evidence.completeness.missing).toEqual(["description", "documentDate", "page", "bbox"]);
  });

  // ── Régression : bug prod « Signaux indisponibles » (Sainte-Catherine) ──
  // Le rail gauche compte 1 signal (endpoint by-city), mais le panneau ville
  // renvoyait 500 dès qu'UNE doc-ref jetait à l'enrichissement (objet S3
  // manquant/réseau). Le fix rend l'enrichissement best-effort : la ville
  // renvoie quand même sa carte (200), doc-ref dégradée, PAS de 500.
  it("returns 200 with a degraded card when a doc-ref enrichment throws (no 500 for the whole city)", async () => {
    const rawRef = "raw/proces-verbaux-sainte-catherine/cas/deadbeef.pdf";
    const node = makeNode("sig-sc-001", "sainte-catherine", "Signal", {
      description: "Avis de motion — modification du règlement de zonage.",
      refs: [
        {
          rawRef,
          excerpt: "Le conseil donne un avis de motion.",
          page: 4,
        },
      ],
    });
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce([
      node,
    ] as unknown as ReturnType<typeof makeNode>[]);

    // L'enrichissement de CETTE ref jette (head/get S3 sur clé "sainte-catherine").
    const store = new FlakyStore("sainte-catherine");
    const app = freshRoute(store);
    const res = await app.request("/api/graph-signals/sainte-catherine");

    // Avant le fix : 500 (Promise.all rejeté) → bandeau « Signaux indisponibles ».
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      nodes: Array<{
        id: string;
        description: string | null;
        docRefs: Array<{
          rawRef?: string;
          documentUrl?: string;
          excerpt?: string;
          contentType?: string;
          fetchedAt?: string;
        }>;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("sainte-catherine");
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0]!.id).toBe("sig-sc-001");
    expect(body.nodes[0]!.description).toBe(
      "Avis de motion — modification du règlement de zonage.",
    );
    // La doc-ref est présente mais NON enrichie (pas de métadonnée S3) : le
    // fallback rawRef→documentUrl reste appliqué, l'excerpt est conservé.
    const docRef = body.nodes[0]!.docRefs[0]!;
    expect(docRef.rawRef).toBe(rawRef);
    expect(docRef.documentUrl).toBe(
      `/api/documents/raw?rawRef=${encodeURIComponent(rawRef)}`,
    );
    expect(docRef.excerpt).toBe("Le conseil donne un avis de motion.");
    expect(docRef.contentType).toBeUndefined();
    expect(docRef.fetchedAt).toBeUndefined();
  });

  it("keeps a healthy signal enriched while degrading a sibling whose enrichment throws", async () => {
    const store = new FlakyStore("sainte-catherine");
    const healthyRecord = await seedPdf(store); // clé "drummondville" → saine
    const brokenRawRef = "raw/proces-verbaux-sainte-catherine/cas/cafe01.pdf";
    const nodes = [
      makeNode("sig-ok", "sainte-catherine", "Signal", {
        refs: [{ rawRef: healthyRecord.storageKey, excerpt: "Citation saine." }],
      }),
      makeNode("sig-ko", "sainte-catherine", "Signal", {
        refs: [{ rawRef: brokenRawRef, excerpt: "Citation dégradée." }],
      }),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(
      nodes as unknown as ReturnType<typeof makeNode>[],
    );

    const app = freshRoute(store);
    const res = await app.request("/api/graph-signals/sainte-catherine");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{
        id: string;
        docRefs: Array<{ sourceUrl?: string; rawRef?: string; contentType?: string }>;
      }>;
    };
    expect(body.nodes).toHaveLength(2);
    const ok = body.nodes.find((n) => n.id === "sig-ok")!;
    const ko = body.nodes.find((n) => n.id === "sig-ko")!;
    // Le nœud sain est enrichi (sourceUrl + contentType issus de la métadonnée).
    expect(ok.docRefs[0]!.sourceUrl).toBe("https://drummondville.ca/pv/2026-05-12.pdf");
    expect(ok.docRefs[0]!.contentType).toBe("application/pdf");
    // Le nœud cassé est dégradé mais présent (rawRef conservé, pas de métadonnée).
    expect(ko.docRefs[0]!.rawRef).toBe(brokenRawRef);
    expect(ko.docRefs[0]!.contentType).toBeUndefined();
  });

  // ── Régression : incident « l'API signal ne répond pas » ─────────────────
  // 66 rawRefs sans `.meta.json` en prod : l'ancien repli docSha listait tout
  // le bucket (~20k objets) puis GETait chaque `.meta.json` (~50 min), lancé
  // PAR NŒUD → l'endpoint per-city ne répondait jamais (timeout client 15 s).
  it("never scans the bucket when a doc-ref's meta is missing (meta absent → degraded ref, zero store.list)", async () => {
    const store = new MemoryStore();
    await seedPdf(store); // le bucket contient d'autres `.meta.json` scannables
    const listSpy = vi.spyOn(store, "list").mockImplementation(() => {
      throw new Error("full bucket scan attempted — the incident regressed");
    });

    const orphanRawRef = "raw/proces-verbaux-plaisance/cas/0123456789abcdef.pdf";
    const nodes = [
      makeNode("sig-p1", "plaisance", "Signal", {
        refs: [{ rawRef: orphanRawRef, excerpt: "Avis de motion." }],
      }),
      makeNode("sig-p2", "plaisance", "Signal", {
        refs: [{ rawRef: orphanRawRef, excerpt: "Adoption du règlement." }],
      }),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(
      nodes as unknown as ReturnType<typeof makeNode>[],
    );

    const res = await freshRoute(store).request("/api/graph-signals/plaisance");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{ docRefs: Array<{ rawRef?: string; documentUrl?: string; contentType?: string }> }>;
    };
    // Refs dégradées mais servies : fallback rawRef→documentUrl, pas de méta.
    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0]!.docRefs[0]).toMatchObject({
      rawRef: orphanRawRef,
      documentUrl: `/api/documents/raw?rawRef=${encodeURIComponent(orphanRawRef)}`,
    });
    expect(body.nodes[0]!.docRefs[0]!.contentType).toBeUndefined();
    // Preuve du fix : AUCUN scan du bucket, quel que soit le nombre de nœuds.
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("shares one S3 resolution across ALL nodes citing the same document (per-request cache, not per-node)", async () => {
    const store = new CountingStore();
    const record = await seedPdf(store);
    const metaKey = rawMetaKey(record.storageKey);
    const nodes = [
      makeNode("sig-a", "drummondville", "Signal", {
        refs: [{ rawRef: record.storageKey, excerpt: "Citation A." }],
      }),
      makeNode("sig-b", "drummondville", "Signal", {
        refs: [{ rawRef: record.storageKey, excerpt: "Citation B." }],
      }),
      makeNode("sig-c", "drummondville", "Signal", {
        refs: [{ rawRef: record.storageKey, excerpt: "Citation C." }],
      }),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(
      nodes as unknown as ReturnType<typeof makeNode>[],
    );

    const res = await freshRoute(store).request("/api/graph-signals/drummondville");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{ docRefs: Array<{ sourceUrl?: string; contentType?: string }> }>;
    };
    // Les 3 nœuds sont enrichis (chemin nominal intact)…
    expect(body.nodes).toHaveLength(3);
    for (const node of body.nodes) {
      expect(node.docRefs[0]!.sourceUrl).toBe("https://drummondville.ca/pv/2026-05-12.pdf");
      expect(node.docRefs[0]!.contentType).toBe("application/pdf");
    }
    // …avec UNE SEULE résolution S3 du document partagé (cache par requête ;
    // le cache par nœud d'avant l'incident aurait fait 3 head + 3 get).
    expect(store.headCalls.get(metaKey)).toBe(1);
    expect(store.getCalls.get(metaKey)).toBe(1);
  });

  it("always responds within the doc-enrichment time budget even when S3 hangs forever", async () => {
    const store = new HangingStore();
    const nodes = [
      makeNode("sig-h1", "plaisance", "Signal", {
        refs: [{ rawRef: "raw/proces-verbaux-plaisance/cas/aaaa.pdf", excerpt: "Avis." }],
      }),
      makeNode("sig-h2", "plaisance", "Signal", {
        refs: [{ rawRef: "raw/proces-verbaux-plaisance/cas/bbbb.pdf", excerpt: "Adoption." }],
      }),
    ];
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(
      nodes as unknown as ReturnType<typeof makeNode>[],
    );

    const startedAt = Date.now();
    // Budget court pour le test (prod : DOC_ENRICHMENT_BUDGET_MS = 2 s).
    const res = await freshRoute(store, 50).request("/api/graph-signals/plaisance");
    const elapsedMs = Date.now() - startedAt;

    // Avant le fix : la requête PENDAIT indéfiniment (S3 qui ne répond pas).
    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(1_500);
    const body = (await res.json()) as {
      ok: boolean;
      nodes: Array<{
        id: string;
        docRefs: Array<{ rawRef?: string; documentUrl?: string; excerpt?: string; contentType?: string }>;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes).toHaveLength(2);
    // Les signaux sont servis SANS enrichissement doc (dégradation contrôlée) :
    // excerpt conservé, fallback rawRef→documentUrl appliqué, pas de méta S3.
    for (const node of body.nodes) {
      const ref = node.docRefs[0]!;
      expect(ref.rawRef).toMatch(/^raw\//u);
      expect(ref.documentUrl).toBe(`/api/documents/raw?rawRef=${encodeURIComponent(ref.rawRef!)}`);
      expect(ref.excerpt).toBeDefined();
      expect(ref.contentType).toBeUndefined();
    }
  });
});

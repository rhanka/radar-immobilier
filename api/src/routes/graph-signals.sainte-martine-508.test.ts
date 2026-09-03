/**
 * drawer-serving #3 — MEASUREMENT + regression guard.
 *
 * Feeds the BYTE-EXACT préprod `graph_nodes` for sainte-martine règlement
 * 026-508 (the DesignationEvent + the Signal, dumped verbatim from the DB by the
 * k8s lane) through the REAL serving projection
 * (`graphSignalsRoute` → getSignalNodesForCity[mocked] → toGraphSignalCard) and
 * DUMPS the served cards, to discriminate the "Document source non relié" the
 * owner saw:
 *   (i)  served cards keep reglement_number + an openable doc  → serving OK,
 *        the "non relié" is a UI evidence-selection concern downstream (vues);
 *   (ii) a served card DROPS reglement_number or the doc        → serving defect
 *        here (fix in this route).
 * i-cond #3 steer (A): measure the served payload, don't conclude from the code.
 */
import { describe, it, expect, vi } from "vitest";
import { rawMetaKey } from "@radar/sources";

import { graphSignalsRoute } from "./graph-signals.js";
import type { Database } from "../db/client.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";

vi.mock("../services/graph/graph-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/graph/graph-store.js")>();
  return { ...actual, getSignalNodesForCity: vi.fn() };
});
import { getSignalNodesForCity } from "../services/graph/graph-store.js";

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

// ── byte-exact fixture (k8s préprod dump, WHERE city_slug='sainte-martine') ──
const SHA = "5ddc6edab1bb7911761e47f9714151e6da4971f8152f7c59e4d057197a779a18";
const RAW_REF = `raw/proces-verbaux-sainte-martine/cas/${SHA}.pdf`;
const SOURCE_URL =
  "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf";
// The `\n` is a REAL newline in the DB JSON string — kept as a JS escape here.
const EXCERPT =
  "Avis de motion et dépôt du projet de Règlement numéro 2026-508 modifiant le Règlement numéro 2011-185 portant sur les nuisances (RMH-450)\nDonne avis de motion qu’il sera présenté pour adoption, lors d’une séance subséquente, le Règlement numéro 2026-508 modifiant le Règlement numéro 2011-185 portant sur les nuisances (RMH-450) ;";

// RECORD 1 — DesignationEvent (props verbatim)
const DE_NODE = {
  id: "event-sainte-martine-zonage-0014",
  type: "DesignationEvent",
  label:
    "Modification zonage règlement 026-508 (avis_motion) — Sainte-Martine 2026-04-14",
  citySlug: "sainte-martine",
  sourceRef: SHA,
  createdAt: new Date("2026-06-15T10:11:33.893Z"),
  props: {
    refs: [
      { page: 10, docSha: SHA, rawRef: RAW_REF, excerpt: EXCERPT, citation: EXCERPT, sourceUrl: SOURCE_URL },
    ],
    properties: {
      date: "2026-04-14",
      kind: "modification_zonage",
      page: 10,
      refs: [
        { page: 10, docSha: SHA, rawRef: RAW_REF, excerpt: EXCERPT, citation: EXCERPT, sourceUrl: SOURCE_URL },
      ],
      etape: "avis_motion",
      docSha: SHA,
      rawRef: RAW_REF,
      citation: EXCERPT,
      sourceUrl: SOURCE_URL,
      etape_date: "2026-04-14",
      description:
        "Modification zonage règlement 026-508 (avis_motion) — Sainte-Martine 2026-04-14",
      meetingDate: "2026-04-14",
      municipality: "sainte-martine",
      reglement_number: "026-508",
      regulatoryStatus: "anticipation",
    },
    source_file: SHA,
  },
};

// RECORD 2 — Signal (props verbatim: refs[] has docSha+rawRef+sourceUrl but NO
// excerpt; properties{} has reglement_number+bylaw_no but NO docSha/rawRef)
const SIGNAL_NODE = {
  id: "signal-sainte-martine-rezonage-0014",
  type: "Signal",
  label:
    "Signal : modification zonage règlement 026-508 — étape avis_motion — Sainte-Martine",
  citySlug: "sainte-martine",
  sourceRef: SHA,
  createdAt: new Date("2026-06-15T10:11:33.893Z"),
  props: {
    refs: [
      {
        docSha: SHA,
        rawRef: RAW_REF,
        sourceUrl: SOURCE_URL,
        linkSource: "data-repropagation-verified",
        provisional: false,
      },
    ],
    properties: {
      date: "2026-04-14",
      kind: "modification_zonage",
      etape: "avis_motion",
      status: "candidate",
      bylaw_no: "026-508",
      category: "rezonage",
      etape_date: "2026-04-14",
      description:
        "Signal : modification zonage règlement 026-508 — étape avis_motion — Sainte-Martine",
      municipality: "sainte-martine",
      reglement_number: "026-508",
      regulatoryStatus: "anticipation",
    },
    source_file: SHA,
  },
};

/** Seed the raw `.meta.json` sidecar so `findDocumentMetadata` resolves the PV
 *  (mirrors préprod, where the PV was stored by recueil) → served docRef gets a
 *  `documentUrl`. Even WITHOUT this, both refs carry `sourceUrl` (openable). */
async function seedSidecar(store: ObjectStore): Promise<void> {
  const record = {
    id: `proces-verbaux-sainte-martine:${SHA}`,
    source: "proces-verbaux-sainte-martine",
    sourceUrl: SOURCE_URL,
    title: "Procès-verbal du conseil — avril 2026",
    publishedAt: "2026-04-14",
    sha256: SHA,
    fetchedAt: "2026-05-01T00:00:00.000Z",
    storageKey: RAW_REF,
    contentType: "application/pdf",
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
    bytesLen: 123456,
  };
  await store.put(rawMetaKey(RAW_REF), JSON.stringify(record, null, 2), "application/json");
}

const freshRoute = (store: ObjectStore) =>
  graphSignalsRoute({ db: {} as unknown as Database, store });

describe("drawer-serving #3 — sainte-martine 026-508 served-card discriminator", () => {
  it("SERVED cards keep reglement_number + an openable doc for BOTH the DE and the Signal", async () => {
    const store = new MemoryStore();
    await seedSidecar(store);
    vi.mocked(getSignalNodesForCity).mockResolvedValueOnce(
      [DE_NODE, SIGNAL_NODE] as unknown as Awaited<ReturnType<typeof getSignalNodesForCity>>,
    );

    const res = await freshRoute(store).request("/api/graph-signals/sainte-martine");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{
        id: string;
        type: string;
        etape: string | null;
        regulatoryStatus: string;
        docRefs: Array<Record<string, unknown>>;
        evidence: unknown;
        props: { properties?: { reglement_number?: string } };
      }>;
    };

    // ── FULL served cards (exact response.nodes[] — the input to the vues
    //    reglement aggregation, handed to that lane for the empirical repro) ──
    console.log("=== FULL SERVED CARDS ===\n" + JSON.stringify(body.nodes, null, 2));

    // ── DUMP the served cards (the measurement) ──
    for (const card of body.nodes) {
      console.log(
        `\n[SERVED CARD] id=${card.id} type=${card.type}\n` +
          `  reglement_number=${card.props?.properties?.reglement_number} etape=${card.etape} regulatoryStatus=${card.regulatoryStatus}\n` +
          `  docRefs(${card.docRefs.length})=${JSON.stringify(card.docRefs)}\n` +
          `  evidence=${JSON.stringify(card.evidence)}`,
      );
    }

    const de = body.nodes.find((n) => n.type === "DesignationEvent")!;
    const signal = body.nodes.find((n) => n.type === "Signal")!;
    expect(de).toBeDefined();
    expect(signal).toBeDefined();

    // ── DISCRIMINATOR: serving preserves the grouping key + an openable doc for
    //    BOTH nodes. If this holds, the "non relié" is downstream of serving
    //    (UI evidence-selection, vues); if it fails, the defect is in this route.
    for (const card of [de, signal]) {
      expect(card.props.properties?.reglement_number).toBe("026-508");
      expect(card.docRefs.length).toBeGreaterThan(0);
      const ref = card.docRefs[0]!;
      expect(ref.documentUrl ?? ref.sourceUrl ?? ref.rawRef).toBeTruthy();
    }
  });
});

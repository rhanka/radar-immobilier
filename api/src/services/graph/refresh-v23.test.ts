import type { Extraction } from "@sentropic/graphify";
import { describe, expect, it } from "vitest";

import type { RefreshCorpusDocument } from "./refresh-corpus.js";
import { enrichGraphify34Snapshot } from "./graphify-34-enrichment.js";
import type { GraphifyGraph } from "./graph-store.js";
import { extractionToV23Graph } from "./refresh-v23.js";

const digest = "a".repeat(64);
const originalKey = `raw/pv-waterloo/cas/${digest}.pdf`;
const quote = "Que le conseil municipal adopte le Règlement 26-956-2";
const document: RefreshCorpusDocument = {
  sourceId: "pv-waterloo",
  citySlug: "waterloo",
  sha256: digest,
  originalKey,
  sourceUrl: "https://ville.waterloo.qc.ca/pv.pdf",
  pages: [
    { page: 1, text: "Ordre du jour" },
    { page: 2, text: "Procès-verbal" },
    { page: 3, text: `${quote} modifiant le règlement de zonage.` },
  ],
  chunks: [],
};
const citation = { source_file: originalKey, page: 3, excerpt: quote };

const baseline: GraphifyGraph = {
  municipality: "waterloo",
  ontology_version: "2.3",
  nodes: [
    { id: "source:baseline", type: "Source", label: "Baseline", properties: { retained: true } },
    { id: "excluded:baseline", type: "Signal", label: "Excluded" },
  ],
  edges: [{ source: "source:baseline", target: "excluded:baseline", type: "supports" }],
};

function extraction(page = 3): Extraction {
  const cited = { ...citation, page };
  return {
    nodes: [
      {
        id: "source:baseline",
        label: "Must not replace baseline",
        file_type: "document",
        source_file: originalKey,
        node_type: "Source",
        citations: [cited],
        properties: { retained: false },
      },
      {
        id: "signal:26-956-2",
        label: "Adoption du règlement 26-956-2",
        file_type: "document",
        source_file: originalKey,
        node_type: "Signal",
        citations: [cited],
        properties: {
          description: "Le conseil adopte le règlement de zonage.",
          category: "modification_zonage",
          resolution: "26.08.22.1",
        },
      },
      {
        id: "excluded:fresh",
        label: "Excluded fresh",
        file_type: "document",
        source_file: originalKey,
        node_type: "Signal",
        citations: [cited],
      },
    ],
    edges: [
      {
        source: "source:baseline",
        target: "signal:26-956-2",
        relation: "supports",
        confidence: "EXTRACTED",
        source_file: originalKey,
        citations: [cited],
      },
      {
        source: "source:baseline",
        target: "excluded:fresh",
        relation: "supports",
        confidence: "EXTRACTED",
        source_file: originalKey,
        citations: [cited],
      },
    ],
    input_tokens: 10,
    output_tokens: 20,
  };
}

function convert(value = extraction()) {
  return extractionToV23Graph(value, {
    municipality: "waterloo",
    generatedAt: "2026-09-13T00:00:00.000Z",
    documents: [document],
    baseline,
    excludedNodeIds: new Set(["excluded:baseline", "excluded:fresh"]),
  });
}

describe("refresh v2.3 candidate", () => {
  it("should preserve baseline-first IDs/properties and explicit exclusions", () => {
    const candidate = convert();
    expect(candidate).toEqual(convert());
    expect(candidate.nodes.map((node) => node.id)).toEqual(["signal:26-956-2", "source:baseline"]);
    expect(candidate.nodes.find((node) => node.id === "source:baseline")).toEqual(baseline.nodes[0]);
    expect(candidate.edges).toHaveLength(1);
  });

  it("should put exact original PDF references on mapped nodes and edges", () => {
    const candidate = convert();
    const expected = { docSha: digest, rawRef: originalKey, sourceUrl: document.sourceUrl, page: 3, excerpt: quote };
    expect(candidate.nodes.find((node) => node.id === "signal:26-956-2")?.refs).toEqual([expected]);
    expect(candidate.edges?.[0]?.refs).toEqual([expected]);
    expect(candidate.pv_count).toBe(1);
  });

  it("should refuse an excerpt attributed to the wrong original page", () => {
    expect(() => convert(extraction(1))).toThrow("not grounded on original PDF page");
  });

  it("should satisfy deterministic 3.4 enrichment field expectations", () => {
    const { snapshot } = enrichGraphify34Snapshot(convert(), "waterloo");
    const properties = snapshot.nodes.find((node) => node.id === "signal:26-956-2")?.properties;
    expect(snapshot.graphify_pass).toBe("3.4");
    expect(properties).toMatchObject({ etape: "adoption", instrument: "rezonage" });
    expect(properties).not.toHaveProperty("effet_densifiant");
  });
});

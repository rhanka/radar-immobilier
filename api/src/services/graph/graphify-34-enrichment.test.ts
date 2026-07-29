import { describe, expect, it } from "vitest";
import { classifyVivierSignal } from "./vivier-v2.js";
import {
  enrichGraphify34Snapshot,
  GRAPHIFY34_ONTOLOGY_VERSION,
  GRAPHIFY34_PASS,
} from "./graphify-34-enrichment.js";
import { buildGraphify34Manifest, snapshotFromExistingCity } from "./graphify-34-snapshot.js";

describe("Graphify 3.4 deterministic enrichment", () => {
  it("enriches a complete 48-node witness without reading raw data", () => {
    const graph = {
      nodes: Array.from({ length: 48 }, (_, index) => ({
        id: `witness:signal:${String(index).padStart(2, "0")}`,
        type: "Signal",
        label: index % 2 === 0 ? "Avis de motion — habitation" : "Adoption du règlement",
        properties: {
          category: index % 2 === 0 ? "rezonage" : "modification_zonage",
          description: "Projet de règlement de zonage résidentiel",
        },
      })),
    };

    const first = enrichGraphify34Snapshot(graph, "__test_g34_witness__");

    expect(first.stats).toEqual({
      node_count: 48,
      signal_node_count: 48,
      fields: {
        effet_densifiant: { before_missing: 48, after_present: 0, added_or_canonicalized: 0 },
        etape: { before_missing: 48, after_present: 48, added_or_canonicalized: 48 },
        instrument: { before_missing: 48, after_present: 48, added_or_canonicalized: 48 },
      },
    });
    expect(first.snapshot.ontology_version).toBe(GRAPHIFY34_ONTOLOGY_VERSION);
    expect(first.snapshot.graphify_pass).toBe(GRAPHIFY34_PASS);
    expect(first.snapshot.nodes.every((node) => {
      const props = node.properties as Record<string, unknown>;
      return !("effet_densifiant" in props) &&
        typeof props.etape === "string" &&
        typeof props.instrument === "string";
    })).toBe(true);
  });

  it("does not install an inconnu density placeholder", () => {
    const graph = {
      nodes: [{
        id: "witness:missing-density-effect",
        type: "Signal",
        label: "Projet de règlement",
        properties: { description: "Projet résidentiel" },
      }],
    };

    const result = enrichGraphify34Snapshot(graph, "witness");

    expect(result.snapshot.nodes[0]?.properties).not.toHaveProperty("effet_densifiant");
    expect(result.stats.fields.effet_densifiant).toEqual({
      before_missing: 1,
      after_present: 0,
      added_or_canonicalized: 0,
    });
  });

  it("reuses the live classifier's instrument function contract", () => {
    const graph = {
      nodes: [{
        id: "witness:ppcmoi",
        type: "Signal",
        label: "Projet particulier de construction",
        properties: { description: "PPCMOI pour habitation" },
      }],
    };
    const node = graph.nodes[0]!;
    const expected = classifyVivierSignal({
      id: "witness:ppcmoi",
      type: "Signal",
      label: node.label,
      description: node.properties.description,
      props: { properties: node.properties },
    }).instrument;
    const actual = enrichGraphify34Snapshot(graph, "witness").snapshot.nodes[0]!
      .properties?.instrument;

    expect(actual).toBe(expected);
    expect(actual).toBe("ppcmoi");
  });

  it("preserves an existing informative instrument when the classifier returns autre", () => {
    const graph = {
      nodes: [{
        id: "witness:existing-zoning-instrument",
        type: "Signal",
        label: "Règlement 92-2005-87",
        properties: {
          description: "Avis administratif sans catégorie de classification",
          instrument: "reglement_zonage",
        },
      }],
    };

    const result = enrichGraphify34Snapshot(graph, "witness");

    expect(result.snapshot.nodes[0]?.properties?.instrument).toBe("reglement_zonage");
    expect(result.stats.fields.instrument).toEqual({
      before_missing: 0,
      after_present: 1,
      added_or_canonicalized: 0,
    });
  });

  it("is strictly idempotent on replay", () => {
    const graph = {
      nodes: [{
        id: "witness:signal",
        type: "DesignationEvent",
        label: "Avis de motion",
        properties: { description: "Avis de motion pour un règlement" },
      }],
    };
    const first = enrichGraphify34Snapshot(graph, "witness");
    const second = enrichGraphify34Snapshot(first.snapshot, "witness");

    expect(JSON.stringify(second.snapshot)).toBe(JSON.stringify(first.snapshot));
    expect(second.stats.fields).toEqual({
      effet_densifiant: { before_missing: 1, after_present: 0, added_or_canonicalized: 0 },
      etape: { before_missing: 0, after_present: 1, added_or_canonicalized: 0 },
      instrument: { before_missing: 0, after_present: 1, added_or_canonicalized: 0 },
    });
  });

  it("builds a sorted complete-city snapshot and a compatible manifest", () => {
    const subgraph = {
      citySlug: "witness",
      nodes: [
        { id: "b", type: "Signal", label: "B", citySlug: "witness", props: {}, sourceRef: null },
        { id: "a", type: "Signal", label: "A", citySlug: "witness", props: {}, sourceRef: null },
      ],
      edges: [{ id: 1, srcId: "b", dstId: "a", kind: "related", props: {} }],
    } as never;
    const graph = snapshotFromExistingCity(subgraph);
    const enriched = enrichGraphify34Snapshot(graph, "witness").snapshot;
    const manifest = buildGraphify34Manifest("witness", enriched);

    expect(enriched.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(manifest).toEqual({
      municipality: "witness",
      graphify_pass: "3.4",
      ontology_version: "2.3",
      snapshot_key: "graph/witness/latest.json",
      snapshot_mode: "complete-city",
      source: "graph_nodes",
      node_count: 2,
      edge_count: 1,
    });
  });
});

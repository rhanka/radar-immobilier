import { describe, expect, it, vi } from "vitest";
import { graphSignalsRoute, type GraphSignalsDeps } from "../../../../../api/src/routes/graph-signals.js";
import { getSignalNodesForCity } from "../../../../../api/src/services/graph/graph-store.js";
import { discardedSignalKey, EMPTY_DISCARDED_KEYS } from "../../../../../api/src/services/graph/discarded-signals.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import { extractSignalEvidence } from "$lib/signals/graph-signal-detail-client.js";
import { buildNavSignals, buildOverlaySignals, rebuildSignalEvidence } from "$lib/signals/pdf-overlay-signals.js";
import { aggregateReglements, applyDemoReglementPdfUrls, enrichGeoZonesWithSignalReglements } from "$lib/maps/signaux-reglements.js";
import { decorateLotsWithSignalProjection } from "$lib/maps/signaux-map-geo.js";
import type { GeoZonesResponse } from "$lib/maps/geo-zones-client.js";
import type { LotFeatureCollection } from "$lib/maps/lots-client.js";

vi.mock("../../../../../api/src/services/graph/graph-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../api/src/services/graph/graph-store.js")>();
  return { ...actual, getSignalNodesForCity: vi.fn() };
});

const CITY = "calixa-lavallee";
const RAW = "raw/6d/pv.pdf";
const archive = (...ids: string[]) => new Set(ids.map((id) => discardedSignalKey(CITY, "Signal", id)));
const zones: GeoZonesResponse = {
  ok: true, citySlug: CITY, source: "official", resolutionStatus: "official",
  geometryStatus: "official", zoneCount: 1, warnings: [],
  featureCollection: { type: "FeatureCollection", features: [{
    type: "Feature", geometry: null, properties: {
      code: "H-1", citySlug: CITY, geometryStatus: "official", confidence: 1,
      source: "official-zone", lotCount: 0, lots: [], grillePdfUrl: "https://example.test/grid.pdf",
    },
  }] },
};
const lots: LotFeatureCollection = { type: "FeatureCollection", features: [{
  type: "Feature", geometry: null, properties: { noLot: "1234567", citySlug: CITY },
}] };

async function read(discarded = EMPTY_DISCARDED_KEYS, reveal = false) {
  vi.mocked(getSignalNodesForCity).mockResolvedValue(["A", "B", "C"].map((id) => ({
    id, type: "Signal", label: id, citySlug: CITY, sourceRef: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    props: {
      rawRef: RAW, page: 1, excerpt: `Citation ${id}`,
      properties: id === "A" ? {} : {
        reglement_number: id === "B" ? "275" : "ordinary",
        zone_ref: "H-1", targets_lot: ["1234567"],
        etape: "adoption", regulatoryStatus: "firm",
      },
    },
  })));
  const port = vi.fn(async () => discarded);
  const app = graphSignalsRoute({
    db: {} as GraphSignalsDeps["db"],
    store: {
      get: async () => { throw new Error("synthetic object missing"); },
      head: async () => null,
      put: async () => { throw new Error("read-only test"); },
    },
    discarded: { forViewer: port },
  });
  const response = await app.request(`/api/graph-signals/${CITY}${reveal ? "?showDiscarded=1" : ""}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { nodes: GraphSignalNode[] };
  return { nodes: body.nodes, port };
}

function surfaces(nodes: GraphSignalNode[]) {
  const current = nodes[0]!;
  const evidence = extractSignalEvidence(current);
  return {
    regulations: aggregateReglements(nodes, zones.featureCollection.features),
    demo: applyDemoReglementPdfUrls(aggregateReglements(nodes), CITY),
    zones: enrichGeoZonesWithSignalReglements(zones, nodes),
    navigation: buildNavSignals(nodes),
    overlay: buildOverlaySignals(current, nodes, evidence.rawRef),
    lots: decorateLotsWithSignalProjection(lots, zones.featureCollection.features, nodes),
  };
}

describe("6D server-to-secondary population parity", () => {
  it("should rebuild open evidence without archived co-document highlights", async () => {
    const before = await read();
    const current = before.nodes[0]!;
    const active = { title: current.label, nodeId: current.id,
      evidence: extractSignalEvidence(current), signals: surfaces(before.nodes).overlay };
    const after = await read(archive("B"));
    const ids = new Set(after.nodes.map((node) => node.id));
    const rebuilt = rebuildSignalEvidence(active, after.nodes, (node) => ids.has(node.id), ids);
    expect(rebuilt?.signals.map((signal) => signal.id)).toEqual(["A", "C"]);
    expect(buildNavSignals(after.nodes).map((signal) => signal.id)).toEqual(["A", "C"]);
  });

  it("should retain only independent demo entries and geographic data after the last citations are archived", async () => {
    const { nodes } = await read(archive("B", "C"));
    const after = surfaces(nodes);
    expect(after.regulations).toEqual([]);
    expect(after.demo).toHaveLength(1);
    expect(after.demo[0]).toMatchObject({ number: "275", signalCount: 0, signalNodeIds: [], evidenceNodeId: null });
    expect(after.demo[0]!.reglementPdfUrl).toBeTruthy();
    expect(after.zones).toEqual(zones);
    expect(after.lots).toEqual(lots);
  });

  it("should preserve reference ids, order, counts and projections with no archives or explicit reveal", async () => {
    const baseline = await read();
    const zero = await read(archive());
    const reveal = await read(archive("B", "C"), true);
    expect(baseline.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
    expect(zero.nodes).toEqual(baseline.nodes);
    expect(reveal.nodes).toEqual(baseline.nodes);
    expect(surfaces(zero.nodes)).toEqual(surfaces(baseline.nodes));
    expect(surfaces(reveal.nodes)).toEqual(surfaces(baseline.nodes));
    expect(reveal.port).not.toHaveBeenCalled();
  });
});

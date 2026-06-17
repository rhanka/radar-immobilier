import { describe, expect, it } from "vitest";
import {
  graphGeoConfidence,
  resolvePriorityGeo,
  textFallbackGeoConfidence,
  type PriorityGraphLayer,
} from "./priority-resolver.js";

describe("resolvePriorityGeo — graph edges", () => {
  it("uses canonical graph-edge zones and lots before flat fallback fields", () => {
    const graph: PriorityGraphLayer = {
      nodes: [
        { id: "signal::delson::p1", type: "Signal", citySlug: "delson" },
        {
          id: "zone::delson::M-216",
          type: "Zone",
          citySlug: "delson",
          label: "Zone M-216",
          props: { codeAffiche: "M-216" },
        },
        {
          id: "lot::delson::3131014",
          type: "Lot",
          citySlug: "delson",
          label: "Lot 3 131 014",
          props: { no_lot: "3 131 014" },
        },
      ],
      edges: [
        { srcId: "signal::delson::p1", dstId: "zone::delson::M-216", kind: "CONCERNS" },
        { srcId: "lot::delson::3131014", dstId: "signal::delson::p1", kind: "AFFECTED_BY" },
      ],
    };

    const resolved = resolvePriorityGeo(
      {
        id: "signal::delson::p1",
        citySlug: "delson",
        props: {
          zone_ref: "H-999",
          no_lot: "9 999 999",
          reglement_number: "1234-56",
        },
      },
      graph,
    );

    expect(resolved.resolutionStatus).toBe("graph");
    expect(resolved.confidence).toBe(graphGeoConfidence());
    expect(resolved.zones).toEqual([
      {
        code: "M-216",
        source: "graph-edge",
        confidence: graphGeoConfidence(),
        graphNodeId: "zone::delson::M-216",
      },
    ]);
    expect(resolved.lots[0]?.noLot).toBe("3 131 014");
    expect(resolved.zones.map((zone) => zone.code)).not.toContain("H-999");
  });

  it("ignores graph neighbours from another city", () => {
    const graph: PriorityGraphLayer = {
      nodes: [
        { id: "signal::delson::p1", type: "Signal", citySlug: "delson" },
        { id: "zone::candiac::H-1", type: "Zone", citySlug: "candiac", label: "H-1" },
      ],
      edges: [
        { srcId: "signal::delson::p1", dstId: "zone::candiac::H-1", kind: "CONCERNS" },
      ],
    };

    const resolved = resolvePriorityGeo(
      { id: "signal::delson::p1", citySlug: "delson" },
      graph,
    );

    expect(resolved.resolutionStatus).toBe("missing");
    expect(resolved.zones).toHaveLength(0);
  });
});

describe("resolvePriorityGeo — text fallback", () => {
  it("falls back weakly to explicit zoneRefs and lotNumbers without graph data", () => {
    const resolved = resolvePriorityGeo({
      id: "priority-1",
      citySlug: "salaberry-de-valleyfield",
      zoneRefs: ["h-609-4"],
      lotNumbers: ["4 516 943"],
    });

    expect(resolved.resolutionStatus).toBe("text-fallback");
    expect(resolved.confidence).toBe(textFallbackGeoConfidence());
    expect(resolved.zones).toEqual([
      {
        code: "H-609-4",
        source: "text-fallback",
        confidence: textFallbackGeoConfidence(),
      },
    ]);
    expect(resolved.lots[0]?.noLot).toBe("4 516 943");
  });

  it("reads legacy flat props only as text fallback", () => {
    const resolved = resolvePriorityGeo({
      id: "priority-2",
      citySlug: "saint-constant",
      props: {
        zone_ref: "H-431",
        no_lot: "5 123 456",
        reglement_number: "1926-26",
      },
    });

    expect(resolved.resolutionStatus).toBe("text-fallback");
    expect(resolved.zones[0]?.source).toBe("text-fallback");
    expect(resolved.zones[0]?.code).toBe("H-431");
    expect(resolved.lots[0]?.noLot).toBe("5 123 456");
  });

  it("keeps text fallback confidence below graph confidence", () => {
    expect(textFallbackGeoConfidence()).toBeLessThan(graphGeoConfidence());
  });
});

describe("resolvePriorityGeo — missing", () => {
  it("returns explicit missing when neither graph nor fallback data resolves", () => {
    const resolved = resolvePriorityGeo({
      id: "priority-3",
      citySlug: "candiac",
      props: { reglement_number: "1234-56" },
    });

    expect(resolved.resolutionStatus).toBe("missing");
    expect(resolved.confidence).toBe(0);
    expect(resolved.zones).toEqual([]);
    expect(resolved.lots).toEqual([]);
  });
});

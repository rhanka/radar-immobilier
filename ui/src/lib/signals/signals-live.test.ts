/**
 * signals-live.test.ts — the real T1 feed is derived from graph_nodes
 * (GET /api/graph-signals/*), with NO synthetic/simulation fixtures.
 * Cities with 0 signal nodes are skipped (anti-invention).
 */
import { describe, expect, it, vi } from "vitest";

import { Signal } from "@radar/domain";

import type { GraphSignalsByCityResponse } from "./graph-signals-by-city-client.js";
import type { GraphSignalDetailResponse } from "./graph-signal-detail-client.js";
import {
  citiesWithSignalNodes,
  loadLiveSignals,
  mapGraphSignalNodeToSignal,
} from "./signals-live.js";

/**
 * Helper : construit une GraphSignalsByCityResponse de test.
 * Les items partiels sont complétés avec countsByType et zonageCount
 * pour satisfaire l'interface GraphSignalCityItem sans polluer les tests avec
 * des champs non pertinents pour leurs assertions.
 */
const byCity = (
  ...cities: (Omit<GraphSignalsByCityResponse["cities"][0], "countsByType" | "zonageCount"> & {
    countsByType?: Record<string, number>;
    zonageCount?: number;
  })[]
): GraphSignalsByCityResponse => {
  const normalized = cities.map((c) => ({
    ...c,
    countsByType: c.countsByType ?? { Signal: c.signalCount },
    zonageCount: c.zonageCount ?? 0,
  }));
  return {
    ok: true,
    totalCount: normalized.reduce((acc, c) => acc + c.signalCount, 0),
    cities: normalized,
  };
};

const detail = (
  citySlug: string,
  nodes: GraphSignalDetailResponse["nodes"],
): GraphSignalDetailResponse => ({ ok: true, citySlug, nodes });

const makeNode = (
  id: string,
  citySlug: string,
  overrides: Partial<GraphSignalDetailResponse["nodes"][0]> = {},
) => ({
  id,
  type: "Signal" as const,
  label: `Node ${id}`,
  citySlug,
  sourceRef: null,
  createdAt: "2026-05-19",
  props: {} as Record<string, unknown>,
  ...overrides,
});

describe("mapGraphSignalNodeToSignal", () => {
  it("maps a node with community_name to a high-confidence real rezoning signal", () => {
    const node = makeNode("sig-001", "saint-constant", {
      sourceRef: "raw/proc-verbaux-saint-constant/2026/05/19/abc.txt",
      props: { reglement_number: "1926-26", zone_ref: "H-431", community_name: "Saint-Constant" },
    });
    const signal = mapGraphSignalNodeToSignal(node, 0);

    // It is a real, valid SignalT (schema-conformant).
    expect(() => Signal.parse(signal)).not.toThrow();
    expect(signal.mode).toBe("real");
    expect(signal.type).toBe("residential-rezoning");
    expect(signal.confidence).toBe("high");
    expect(signal.status).toBe("nouveau");
    expect(signal.bylaw).toBe("1926-26");
    expect(signal.zone).toBe("H-431");
    expect(signal.sourceRefs).toEqual([
      "raw/proc-verbaux-saint-constant/2026/05/19/abc.txt",
    ]);
    expect(signal.detectedAt).toBe("2026-05-19");
  });

  it("downgrades confidence to medium when only sourceRef is present (no community_name)", () => {
    const node = makeNode("sig-002", "x", {
      sourceRef: "raw/some/ref.txt",
      props: { reglement_number: "42-01" },
    });
    const signal = mapGraphSignalNodeToSignal(node, 0);
    expect(signal.confidence).toBe("medium");
    expect(signal.bylaw).toBe("42-01");
    expect(signal.zone).toBeUndefined();
  });

  it("downgrades confidence to low when neither community_name nor sourceRef is present", () => {
    const node = makeNode("sig-003", "x", { sourceRef: null, props: {} });
    const signal = mapGraphSignalNodeToSignal(node, 1);
    expect(signal.confidence).toBe("low");
    expect(signal.bylaw).toBeUndefined();
    expect(signal.sourceRefs).toEqual([]);
  });
});

describe("citiesWithSignalNodes", () => {
  it("keeps only cities with a positive signalCount", () => {
    const items = byCity(
      { citySlug: "a", signalCount: 2 },
      { citySlug: "b", signalCount: 0 },
    ).cities;
    expect(citiesWithSignalNodes(items).map((c) => c.citySlug)).toEqual(["a"]);
  });
});

describe("loadLiveSignals", () => {
  it("fetches details only for cities with signal nodes and returns real signals newest-first", async () => {
    const fetchGraphSignalsByCity = vi.fn(async () =>
      byCity(
        { citySlug: "saint-constant", signalCount: 1 },
        { citySlug: "sainte-catherine", signalCount: 0 },
        { citySlug: "chateauguay", signalCount: 1 },
      ),
    );
    const fetchGraphSignalDetail = vi.fn(async (citySlug: string) => {
      if (citySlug === "saint-constant")
        return detail("saint-constant", [
          makeNode("sig-sc", "saint-constant", {
            sourceRef: "r1",
            createdAt: "2026-05-19",
            props: { reglement_number: "1926-26", zone_ref: "H-431", community_name: "SC" },
          }),
        ]);
      if (citySlug === "chateauguay")
        return detail("chateauguay", [
          makeNode("sig-ch", "chateauguay", {
            sourceRef: "r2",
            createdAt: "2026-02-23",
            props: { reglement_number: "Z-3001", zone_ref: "C-754" },
          }),
        ]);
      throw new Error(`unexpected detail fetch for ${citySlug}`);
    });

    const signals = await loadLiveSignals({ fetchGraphSignalsByCity, fetchGraphSignalDetail });

    // sainte-catherine (0 signal nodes) was never fetched → anti-invention.
    expect(fetchGraphSignalDetail).toHaveBeenCalledTimes(2);
    expect(fetchGraphSignalDetail).not.toHaveBeenCalledWith("sainte-catherine");

    // Two real signals, all mode:"real", newest-first by detectedAt.
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.mode === "real")).toBe(true);
    expect(signals[0]!.detectedAt).toBe("2026-05-19");
    expect(signals[1]!.detectedAt).toBe("2026-02-23");
    // No simulation fixtures ever appear.
    expect(signals.some((s) => s.mode === "simulation")).toBe(false);
  });

  it("returns an empty feed (honest) when no city has signal nodes", async () => {
    const fetchGraphSignalsByCity = vi.fn(async () =>
      byCity({ citySlug: "a", signalCount: 0 }),
    );
    const fetchGraphSignalDetail = vi.fn(async () => detail("a", []));
    const signals = await loadLiveSignals({ fetchGraphSignalsByCity, fetchGraphSignalDetail });
    expect(signals).toEqual([]);
    expect(fetchGraphSignalDetail).not.toHaveBeenCalled();
  });
});

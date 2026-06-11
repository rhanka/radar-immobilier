/**
 * signals-live.test.ts — the real T1 feed is derived from the ontology API
 * (by-city counts → per-city details → SignalT), with NO synthetic/simulation
 * fixtures. Cities with 0 events are skipped (anti-invention).
 */
import { describe, expect, it, vi } from "vitest";

import { Signal } from "@radar/domain";

import type { SignalsByCityResponse } from "./signals-by-city-client.js";
import type { SignalDetailResponse } from "./signal-detail-client.js";
import {
  citiesWithEvents,
  loadLiveSignals,
  mapDesignationEventToSignal,
} from "./signals-live.js";

const byCity = (...items: SignalsByCityResponse["items"]): SignalsByCityResponse => ({
  ok: true,
  items,
});

const detail = (
  citySlug: string,
  events: SignalDetailResponse["events"],
): SignalDetailResponse => ({ ok: true, citySlug, events });

describe("mapDesignationEventToSignal", () => {
  it("maps a fully-structured event to a high-confidence real rezoning signal", () => {
    const signal = mapDesignationEventToSignal(
      "saint-constant",
      {
        label: "Avis de motion règlement de zonage 1926-26 (zone H-431)",
        reglementNumbers: ["1926-26", "1927-26"],
        zoneRefs: ["H-431"],
        sourceRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc.txt",
        dateObserved: "2026-05-19T12:00:00.000Z",
      },
      0,
    );

    // It is a real, valid SignalT (schema-conformant).
    expect(() => Signal.parse(signal)).not.toThrow();
    expect(signal.mode).toBe("real");
    expect(signal.type).toBe("residential-rezoning");
    expect(signal.value).toBe(10);
    expect(signal.confidence).toBe("high");
    expect(signal.status).toBe("nouveau");
    expect(signal.bylaw).toBe("1926-26, 1927-26");
    expect(signal.zone).toBe("H-431");
    expect(signal.sourceRefs).toEqual([
      "raw/proces-verbaux-saint-constant/2026/05/19/abc.txt",
    ]);
    expect(signal.detectedAt).toBe("2026-05-19T12:00:00.000Z");
  });

  it("downgrades confidence when only one of règlement/zone is present", () => {
    const onlyReglement = mapDesignationEventToSignal(
      "x",
      { label: "l", reglementNumbers: ["42-01"], zoneRefs: [], sourceRef: "r", dateObserved: "2026-01-01" },
      0,
    );
    expect(onlyReglement.confidence).toBe("medium");
    expect(onlyReglement.zone).toBeUndefined();

    const neither = mapDesignationEventToSignal(
      "x",
      { label: "l", reglementNumbers: [], zoneRefs: [], sourceRef: "", dateObserved: "2026-01-01" },
      1,
    );
    expect(neither.confidence).toBe("low");
    expect(neither.bylaw).toBeUndefined();
    expect(neither.sourceRefs).toEqual([]);
  });
});

describe("citiesWithEvents", () => {
  it("keeps only cities with a positive designationEventCount", () => {
    const items = byCity(
      { citySlug: "a", designationEventCount: 2, generatedAt: "2026-05-01" },
      { citySlug: "b", designationEventCount: 0, generatedAt: null },
    ).items;
    expect(citiesWithEvents(items).map((c) => c.citySlug)).toEqual(["a"]);
  });
});

describe("loadLiveSignals", () => {
  it("fetches details only for cities with events and returns real signals newest-first", async () => {
    const fetchSignalsByCity = vi.fn(async () =>
      byCity(
        { citySlug: "saint-constant", designationEventCount: 1, generatedAt: "2026-05-19T12:00:00.000Z" },
        { citySlug: "sainte-catherine", designationEventCount: 0, generatedAt: null },
        { citySlug: "chateauguay", designationEventCount: 1, generatedAt: "2026-02-23T12:00:00.000Z" },
      ),
    );
    const fetchSignalDetail = vi.fn(async (citySlug: string) => {
      if (citySlug === "saint-constant")
        return detail("saint-constant", [
          { label: "z 1926-26", reglementNumbers: ["1926-26"], zoneRefs: ["H-431"], sourceRef: "r1", dateObserved: "2026-05-19T12:00:00.000Z" },
        ]);
      if (citySlug === "chateauguay")
        return detail("chateauguay", [
          { label: "z Z-3001", reglementNumbers: ["Z-3001"], zoneRefs: ["C-754"], sourceRef: "r2", dateObserved: "2026-02-23T12:00:00.000Z" },
        ]);
      throw new Error(`unexpected detail fetch for ${citySlug}`);
    });

    const signals = await loadLiveSignals({ fetchSignalsByCity, fetchSignalDetail });

    // sainte-catherine (0 events) was never fetched → anti-invention.
    expect(fetchSignalDetail).toHaveBeenCalledTimes(2);
    expect(fetchSignalDetail).not.toHaveBeenCalledWith("sainte-catherine");

    // Two real signals, all mode:"real", newest-first by detectedAt.
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.mode === "real")).toBe(true);
    expect(signals[0]!.detectedAt).toBe("2026-05-19T12:00:00.000Z");
    expect(signals[1]!.detectedAt).toBe("2026-02-23T12:00:00.000Z");
    // No simulation fixtures ever appear.
    expect(signals.some((s) => s.mode === "simulation")).toBe(false);
  });

  it("returns an empty feed (honest) when no city has events", async () => {
    const fetchSignalsByCity = vi.fn(async () =>
      byCity({ citySlug: "a", designationEventCount: 0, generatedAt: null }),
    );
    const fetchSignalDetail = vi.fn(async () => detail("a", []));
    const signals = await loadLiveSignals({ fetchSignalsByCity, fetchSignalDetail });
    expect(signals).toEqual([]);
    expect(fetchSignalDetail).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { benchmarkTracks } from "../demo/benchmark-data.js";
import {
  CONNECTORS,
  STATUS_LABELS_FR,
  TREATMENTS,
  benchmarkRecap,
} from "./automation-data.js";
import type { ConnectorStatus, TreatmentKind } from "./automation-data.js";

describe("TREATMENTS", () => {
  it("has exactly 3 treatments", () => {
    expect(TREATMENTS).toHaveLength(3);
  });

  it("has all three required kinds", () => {
    const kinds: TreatmentKind[] = ["initial", "recurrent", "approfondissement"];
    for (const kind of kinds) {
      expect(TREATMENTS.some((t) => t.kind === kind)).toBe(true);
    }
  });

  it("each treatment has non-empty title, cadence, description, and trigger", () => {
    for (const t of TREATMENTS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.cadence.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.trigger.length).toBeGreaterThan(0);
    }
  });
});

describe("CONNECTORS", () => {
  it("is non-empty", () => {
    expect(CONNECTORS.length).toBeGreaterThan(0);
  });

  it("all have valid statuses", () => {
    const valid: ConnectorStatus[] = ["connecte", "a-venir", "manuel", "reel"];
    for (const c of CONNECTORS) {
      expect(valid).toContain(c.status);
    }
  });

  it("a 'reel' connector exposes a server-side collector source (ÉV11)", () => {
    for (const c of CONNECTORS) {
      if (c.status === "reel") {
        expect(c.realCollectSource).toBeTruthy();
      } else {
        expect(c.realCollectSource).toBeUndefined();
      }
    }
  });

  it("exactly one connector is wired to a real collector", () => {
    expect(CONNECTORS.filter((c) => c.realCollectSource).length).toBe(1);
  });

  it("each connector has a non-empty id and label", () => {
    for (const c of CONNECTORS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});

describe("STATUS_LABELS_FR", () => {
  it("has an entry for each ConnectorStatus", () => {
    const statuses: ConnectorStatus[] = ["connecte", "a-venir", "manuel", "reel"];
    for (const s of statuses) {
      expect(STATUS_LABELS_FR[s]).toBeDefined();
      expect(STATUS_LABELS_FR[s].length).toBeGreaterThan(0);
    }
  });
});

describe("benchmarkRecap", () => {
  it("returns one entry per track in benchmark-data", () => {
    const recap = benchmarkRecap();
    expect(recap).toHaveLength(benchmarkTracks.length);
  });

  it("agent names match those from benchmark-data", () => {
    const recap = benchmarkRecap();
    const sourceNames = new Set(benchmarkTracks.map((t) => t.name));
    for (const entry of recap) {
      expect(sourceNames.has(entry.name)).toBe(true);
    }
  });

  it("totals match exactly what benchmark-data contains", () => {
    const recap = benchmarkRecap();
    const byName = new Map(benchmarkTracks.map((t) => [t.name, t]));
    for (const entry of recap) {
      const source = byName.get(entry.name);
      expect(source).toBeDefined();
      expect(entry.total).toBe(source!.total);
    }
  });

  it("ranks match exactly what benchmark-data contains", () => {
    const recap = benchmarkRecap();
    const byName = new Map(benchmarkTracks.map((t) => [t.name, t]));
    for (const entry of recap) {
      const source = byName.get(entry.name);
      expect(source).toBeDefined();
      expect(entry.rank).toBe(source!.rank);
    }
  });
});

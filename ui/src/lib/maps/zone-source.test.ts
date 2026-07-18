import { describe, it, expect } from "vitest";
import type { GeoZoneProperties } from "$lib/maps/geo-zones-client.js";
import { describeZoneSource } from "./zone-source.js";

function props(over: Partial<GeoZoneProperties>): GeoZoneProperties {
  return {
    code: "H-431",
    citySlug: "delson",
    geometryStatus: "official",
    confidence: 1,
    source: "official-zone",
    lotCount: 0,
    lots: [],
    ...over,
  };
}

describe("describeZoneSource", () => {
  it("géométrie officielle → type « site » approximatif (provenance fine non servie)", () => {
    const d = describeZoneSource(props({ geometryStatus: "official" }));
    expect(d.type).toBe("site");
    expect(d.approximate).toBe(true);
    expect(d.openUrl).toBeNull();
    expect(d.openKind).toBeNull();
  });

  it("union de lots → type « recalage » approximatif", () => {
    const d = describeZoneSource(props({ geometryStatus: "lot-union-fallback" }));
    expect(d.type).toBe("recalage");
    expect(d.approximate).toBe(true);
  });

  it("référence texte → type « texte », non approximatif", () => {
    const d = describeZoneSource(props({ geometryStatus: "text-only" }));
    expect(d.type).toBe("texte");
    expect(d.approximate).toBe(false);
  });

  it("zone désignée par signal → type « designee »", () => {
    const d = describeZoneSource(
      props({ source: "signal-designated", geometryStatus: "missing" }),
    );
    expect(d.type).toBe("designee");
  });

  it("géométrie manquante → type « missing », rien à ouvrir", () => {
    const d = describeZoneSource(props({ geometryStatus: "missing" }));
    expect(d.type).toBe("missing");
    expect(d.openUrl).toBeNull();
  });

  it("grille PDF servie → source ouvrable en viewer PDF (indépendant du type)", () => {
    const d = describeZoneSource(
      props({ grillePdfUrl: "https://ville.qc.ca/grille.pdf" }),
    );
    expect(d.openUrl).toBe("https://ville.qc.ca/grille.pdf");
    expect(d.openKind).toBe("pdf");
  });
});

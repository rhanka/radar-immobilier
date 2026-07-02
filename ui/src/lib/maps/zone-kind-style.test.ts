/**
 * Tests de zone-kind-style — teinte des aplats de zone par kind (tokens DS).
 *
 * Données de référence : Salaberry-de-Valleyfield (645 zones live) porte
 * kind=null partout mais des codes préfixés (A-118, H-354, CONS-2, Cons-5,
 * i-93, REC-11, U-4, P-411, C-186…) — la résolution DOIT retomber sur le
 * préfixe du code, insensible à la casse.
 */
import { describe, it, expect } from "vitest";
import {
  ZONE_KIND_NEUTRAL,
  ZONE_KIND_STYLES,
  canonicalZoneKind,
  decorateZonesWithKindColor,
  zoneKindColor,
  zoneKindLegend,
  zoneKindStyle,
} from "./zone-kind-style.js";
import type { GeoZoneFeatureCollection } from "./geo-zones-client.js";

describe("canonicalZoneKind", () => {
  it("résout depuis le préfixe du code quand kind est absent (cas Salaberry)", () => {
    expect(canonicalZoneKind(null, "A-118")).toBe("A");
    expect(canonicalZoneKind(null, "H-354")).toBe("H");
    expect(canonicalZoneKind(null, "C-186")).toBe("C");
    expect(canonicalZoneKind(null, "I-31")).toBe("I");
    expect(canonicalZoneKind(null, "P-411")).toBe("P");
    expect(canonicalZoneKind(null, "U-4")).toBe("U");
    expect(canonicalZoneKind(null, "REC-11")).toBe("REC");
    expect(canonicalZoneKind(null, "CONS-2")).toBe("CONS");
  });

  it("est insensible à la casse du code (Cons-5, i-93 réels à Salaberry)", () => {
    expect(canonicalZoneKind(null, "Cons-5")).toBe("CONS");
    expect(canonicalZoneKind(null, "i-93")).toBe("I");
  });

  it("résout depuis le libellé kind quand présent (variantes FR)", () => {
    expect(canonicalZoneKind("habitation", null)).toBe("H");
    expect(canonicalZoneKind("Résidentiel", null)).toBe("H");
    expect(canonicalZoneKind("commerce", null)).toBe("C");
    expect(canonicalZoneKind("industriel", null)).toBe("I");
    expect(canonicalZoneKind("agricole", null)).toBe("A");
    expect(canonicalZoneKind("mixte", null)).toBe("MIXTE");
    expect(canonicalZoneKind("H", null)).toBe("H");
  });

  it("kind irrésolu ET code sans préfixe connu → null (teinte neutre, aucune invention)", () => {
    expect(canonicalZoneKind(null, "fallback:ville-x")).toBeNull();
    expect(canonicalZoneKind(null, null)).toBeNull();
    expect(canonicalZoneKind("n/d", "4052")).toBeNull();
  });
});

describe("zoneKindStyle / zoneKindColor", () => {
  it("chaque kind pointe un token catégoriel DS (aucune palette inventée)", () => {
    for (const style of Object.values(ZONE_KIND_STYLES)) {
      expect(style.token.startsWith("--st-semantic-data-category")).toBe(true);
    }
    expect(ZONE_KIND_NEUTRAL.token.startsWith("--st-semantic-")).toBe(true);
  });

  it("retourne le fallback sent-tech hors DOM (H jaune, C rouge, A vert)", () => {
    expect(zoneKindColor(null, "H-354", null)).toBe("#EDC948");
    expect(zoneKindColor(null, "C-186", null)).toBe("#E15759");
    expect(zoneKindColor(null, "A-118", null)).toBe("#59A14F");
    expect(zoneKindColor(null, "fallback:x", null)).toBe(ZONE_KIND_NEUTRAL.fallback);
  });

  it("zone au kind irrésolu → style neutre", () => {
    expect(zoneKindStyle(null, "4052")).toBe(ZONE_KIND_NEUTRAL);
  });
});

describe("decorateZonesWithKindColor", () => {
  function zonesFC(codes: string[]): GeoZoneFeatureCollection {
    return {
      type: "FeatureCollection",
      features: codes.map((code) => ({
        type: "Feature",
        geometry: null,
        properties: {
          code,
          citySlug: "salaberry-de-valleyfield",
          geometryStatus: "official",
          confidence: 1,
          source: "official-zone",
          lotCount: 0,
          lots: [],
        },
      })),
    };
  }

  it("décore chaque feature d'un kindColor résolu par kind", () => {
    const decorated = decorateZonesWithKindColor(zonesFC(["H-1", "C-2", "4052"]), new Set(), null);
    const colors = decorated.features.map((f) => f.properties.kindColor);
    expect(colors).toEqual(["#EDC948", "#E15759", ZONE_KIND_NEUTRAL.fallback]);
  });

  it("supporte les codes DUPLIQUÉS (C-186 ×2 à Salaberry) : chaque polygone décoré", () => {
    const decorated = decorateZonesWithKindColor(zonesFC(["C-186", "C-186"]), new Set(), null);
    expect(decorated.features).toHaveLength(2);
    expect(decorated.features[0].properties.kindColor).toBe("#E15759");
    expect(decorated.features[1].properties.kindColor).toBe("#E15759");
  });

  it("surligne en vert 4+ les zones du set highlight (filtre 4+/priorité actif)", () => {
    const decorated = decorateZonesWithKindColor(
      zonesFC(["H-1", "H-2"]),
      new Set(["H1"]), // forme comparable (tirets ignorés)
      null,
    );
    expect(decorated.features[0].properties.kindColor).toBe("#16a34a");
    expect(decorated.features[1].properties.kindColor).toBe("#EDC948");
  });

  it("ne mute pas les features d'origine", () => {
    const source = zonesFC(["H-1"]);
    decorateZonesWithKindColor(source, new Set(), null);
    expect(source.features[0].properties.kindColor).toBeUndefined();
  });
});

describe("zoneKindLegend", () => {
  it("liste uniquement les kinds présents, dédupliqués (profil Salaberry)", () => {
    const zones = [
      { kind: null, code: "A-118" },
      { kind: null, code: "H-354" },
      { kind: null, code: "H-159" },
      { kind: null, code: "C-186" },
      { kind: null, code: "CONS-2" },
      { kind: null, code: "REC-11" },
      { kind: null, code: "4052" },
    ];
    const legend = zoneKindLegend(zones, null);
    const labels = legend.map((entry) => entry.label);
    expect(labels).toContain("Habitation");
    expect(labels).toContain("Commercial");
    expect(labels).toContain("Agricole");
    // CONS et REC fusionnés en une seule entrée (même teinte, même libellé).
    expect(labels.filter((l) => l === "Conservation / récréation")).toHaveLength(1);
    // Kind irrésolu → entrée neutre unique en fin de liste.
    expect(labels[labels.length - 1]).toBe(ZONE_KIND_NEUTRAL.label);
    // Aucun kind absent (industriel/mixte non présents ici).
    expect(labels).not.toContain("Industriel");
    expect(labels).not.toContain("Mixte");
  });
});

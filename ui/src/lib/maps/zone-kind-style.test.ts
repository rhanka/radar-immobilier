/**
 * Tests de zone-kind-style — teinte des aplats de zone par kind (tokens DS).
 *
 * Reference data: Salaberry-de-Valleyfield zones have a real code while kind
 * and affectation can be absent. Styling resolves a family without changing
 * the zone identity carried by that code.
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
  it("should resolve the family from a zone code when kind and affectation are absent", () => {
    expect(canonicalZoneKind(null, "A-118")).toBe("A");
    expect(canonicalZoneKind(null, "H-354")).toBe("H");
    expect(canonicalZoneKind(null, "C-186")).toBe("C");
    expect(canonicalZoneKind(null, "I-31")).toBe("I");
    expect(canonicalZoneKind(null, "P-411")).toBe("P");
    expect(canonicalZoneKind(null, "U-4")).toBe("U");
    expect(canonicalZoneKind(null, "REC-11")).toBe("REC");
    expect(canonicalZoneKind(null, "CONS-2")).toBe("CONS");
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
    expect(canonicalZoneKind("unknown", "ZZZ-1")).toBeNull();
  });

  // ── Taxonomie geo réelle (bug Mont-Tremblant : zones blanches) ─────────────

  it("kind=CO + affectation=Conservation (Mont-Tremblant) → CONS, plus jamais blanc", () => {
    expect(canonicalZoneKind("CO", "CO-939", "Conservation")).toBe("CONS");
  });

  it("l'affectation PRIME sur le kind et le code (libellé le plus fiable)", () => {
    expect(canonicalZoneKind("residential", "H-1", "Conservation")).toBe("CONS");
    expect(canonicalZoneKind(null, "C-186", "Agricole")).toBe("A");
  });

  it("should prefer kind over the zone code", () => {
    expect(canonicalZoneKind("commerce", "H-1")).toBe("C");
  });

  it("résout chaque libellé d'affectation servi par geo vers une catégorie (mesure 2026-07)", () => {
    // Valeurs DISTINCTES mesurées sur qc-zonage-mont-tremblant (585 zones) +
    // échantillon de 80 collections qc-zonage-* : AUCUNE ne doit retomber en
    // « Type non déterminé » (c'était le bug : aplats blancs).
    const measured: Array<[string, string]> = [
      ["Conservation", "CONS"],
      ["Conservation et récréation", "CONS"],
      ["Conservation et récréation bassin versant", "CONS"],
      ["Conservation forestière", "CONS"],
      ["Corridor faunique", "CONS"],
      ["Corridor faunique bassin versant", "CONS"],
      ["CV - Conservation", "CONS"],
      ["D'écologie et de conservation", "CONS"],
      ["Récréative et espace vert-Conservation", "REC"],
      ["Récréative et espace vert-Protection et mise en valeur", "REC"],
      ["Récréative et espace vert-Site récréatif", "REC"],
      ["Récréotouristique", "REC"],
      ["Touristique", "REC"],
      ["ST - Touristique", "REC"],
      ["CV - Touristique", "REC"],
      ["VA - Touristique", "REC"],
      ["Villégiature", "H"],
      ["Villégiature paysagère", "H"],
      ["Villégiature paysagère bassin versant", "H"],
      ["Villégiature paysagère éco-corridor laurentien", "H"],
      ["Villégiature faunique", "H"],
      ["Villégiature faunique bassin versant", "H"],
      ["Habitation (faible densité)", "H"],
      ["Résidentielle-Zone urbaine", "H"],
      ["Résidentielle-Zone d'expansion résidentielle", "H"],
      ["CV - Résidentielle de faible densité", "H"],
      ["CV - Résidentielle de moyenne à forte densité", "H"],
      ["CV - Résidentielle de faible à moyenne densité", "H"],
      ["CV - Résidentielle de très faible densité", "H"],
      ["VA - Résidentielle de très faible densité", "H"],
      ["VA – Résidentielle de faible densité", "H"],
      ["Agricole", "A"],
      ["Agricole (type 1)", "A"],
      ["Agricole-Zone agricole viable", "A"],
      ["Agricole-Zone agricole dynamique", "A"],
      ["Agricole et/ou forestier", "A"],
      ["Agroforestière", "A"],
      ["Agroforestière bassin versant", "A"],
      ["Agro-forestier", "A"],
      ["Forestier", "A"],
      ["Forestière-Zone forestière et récréative", "A"],
      ["Forestière-Secteur de villégiature", "A"],
      ["Forestière-Zone forestière de production", "A"],
      ["Extraction", "I"],
      ["Industriel", "I"],
      ["Industrielle mixte", "I"],
      ["Industrielle-Parc industriel", "I"],
      ["Industrielle-Grande industrie", "I"],
      ["Industrielle-Secteur industriel mixte", "I"],
      ["CV - Industrielle", "I"],
      ["Commercial", "C"],
      ["Commerce et service-Artère commerciale-mixte", "C"],
      ["Commerce et service-Centralité locale", "C"],
      ["Commerce et service-Centre-ville traditionnel", "C"],
      ["CV - Commerciale artérielle", "C"],
      ["CV - Corridor commercial mixte", "C"],
      ["Public", "P"],
      ["Institutionnelle-Pôle institutionnel", "P"],
      ["CV - Publique et institutionelle", "P"],
      ["VA – Publique et institutionnelle", "P"],
      ["Utilité publique", "U"],
      ["Mixte", "MIXTE"],
      ["VA - Mixte", "MIXTE"],
      ["CV - Mixité de faible intensité", "MIXTE"],
      ["CV - Centralité urbaine", "MIXTE"],
    ];
    for (const [affectation, expected] of measured) {
      expect(canonicalZoneKind(null, null, affectation), affectation).toBe(expected);
    }
  });

  it("résout les codes kind 2-3 lettres servis par geo (mesure 2026-07)", () => {
    const measured: Array<[string, string]> = [
      ["CO", "CONS"],
      ["CR", "CONS"],
      ["CF", "CONS"],
      ["CFA", "CONS"],
      ["HA", "H"],
      ["Ra", "H"],
      ["Rc", "MIXTE"],
      ["Ra/ru", "H"],
      ["VP", "H"],
      ["VF", "H"],
      ["V", "H"],
      ["CM", "C"],
      ["IN", "I"],
      ["Ex", "I"],
      ["AG", "A"],
      ["AF", "A"],
      ["Af/b", "A"],
      ["RE", "REC"],
      ["Rec", "REC"],
      ["Rec/f", "REC"],
      ["TO", "REC"],
      ["Cons", "CONS"],
      ["M", "MIXTE"],
    ];
    for (const [kind, expected] of measured) {
      expect(canonicalZoneKind(kind, null), kind).toBe(expected);
    }
  });

  it("résout les kinds catégoriels anglais des villes du focus (delson/candiac/saint-constant)", () => {
    expect(canonicalZoneKind("residential", null)).toBe("H");
    expect(canonicalZoneKind("commercial", null)).toBe("C");
    expect(canonicalZoneKind("industrial", null)).toBe("I");
    expect(canonicalZoneKind("institutional", null)).toBe("P");
    expect(canonicalZoneKind("agricultural", null)).toBe("A");
    expect(canonicalZoneKind("mixed-use", null)).toBe("MIXTE");
    expect(canonicalZoneKind("public", null)).toBe("P");
    expect(canonicalZoneKind("conservation", null)).toBe("CONS");
    expect(canonicalZoneKind("forestry", null)).toBe("A");
  });

  it("should resolve sector-prefixed zone codes", () => {
    expect(canonicalZoneKind(null, "CO-939")).toBe("CONS");
    expect(canonicalZoneKind(null, "CV-RF-2")).toBeNull();
    expect(canonicalZoneKind(null, "ST-TO-1")).toBe("REC");
    expect(canonicalZoneKind(null, "VA-P-3")).toBe("P");
  });
});

describe("zoneKindStyle / zoneKindColor", () => {
  it("chaque kind pointe un token catégoriel DS (aucune palette inventée)", () => {
    for (const style of Object.values(ZONE_KIND_STYLES)) {
      expect(style.token.startsWith("--st-semantic-data-category")).toBe(true);
    }
    expect(ZONE_KIND_NEUTRAL.token.startsWith("--st-semantic-")).toBe(true);
  });

  it("should return token fallbacks for code-only zones outside the DOM", () => {
    expect(zoneKindColor(null, "H-354", null)).toBe("#EDC948");
    expect(zoneKindColor(null, "C-186", null)).toBe("#E15759");
    expect(zoneKindColor(null, "A-118", null)).toBe("#59A14F");
    expect(zoneKindColor(null, "fallback:x", null)).toBe(ZONE_KIND_NEUTRAL.fallback);
  });

  it("zone au kind irrésolu → style neutre", () => {
    expect(zoneKindStyle(null, "4052")).toBe(ZONE_KIND_NEUTRAL);
  });

  it("valeur vraiment inconnue → « Type non déterminé » GRIS CLAIR, pas blanc invisible", () => {
    expect(zoneKindStyle("unknown", "ZZZ-1")).toBe(ZONE_KIND_NEUTRAL);
    expect(ZONE_KIND_NEUTRAL.label).toBe("Type non déterminé");
    // Un aplat blanc se confond avec « pas de zonage » sur fond clair (bug
    // Mont-Tremblant) : le neutre doit être un gris clair discret.
    expect(ZONE_KIND_NEUTRAL.fallback.toLowerCase()).not.toBe("#ffffff");
  });

  it("teinte par affectation : kind=CO/affectation=Conservation → teinte Conservation", () => {
    expect(zoneKindStyle("CO", "CO-939", "Conservation")).toBe(ZONE_KIND_STYLES.CONS);
    expect(zoneKindColor("CO", "CO-939", null, "Conservation")).toBe(
      ZONE_KIND_STYLES.CONS.fallback,
    );
  });
});

describe("decorateZonesWithKindColor", () => {
  function zonesFC(
    specs: Array<{ code: string; kind?: string | null; affectation?: string | null }>,
  ): GeoZoneFeatureCollection {
    return {
      type: "FeatureCollection",
      features: specs.map(({ code, kind = null, affectation = null }) => ({
        type: "Feature",
        geometry: null,
        properties: {
          code,
          ...(kind !== null ? { kind } : {}),
          ...(affectation !== null ? { affectation } : {}),
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

  it("should decorate code-only features with their zoning family color", () => {
    const decorated = decorateZonesWithKindColor(
      zonesFC([
        { code: "H-1" },
        { code: "C-2" },
        { code: "4052" },
      ]),
      new Set(),
      null,
    );
    const colors = decorated.features.map((f) => f.properties.kindColor);
    expect(colors).toEqual(["#EDC948", "#E15759", ZONE_KIND_NEUTRAL.fallback]);
  });

  it("supporte les codes DUPLIQUÉS (C-186 ×2 à Salaberry) : chaque polygone décoré", () => {
    const decorated = decorateZonesWithKindColor(
      zonesFC([
        { code: "C-186", kind: "commerce" },
        { code: "C-186", kind: "commerce" },
      ]),
      new Set(),
      null,
    );
    expect(decorated.features).toHaveLength(2);
    expect(decorated.features[0].properties.kindColor).toBe("#E15759");
    expect(decorated.features[1].properties.kindColor).toBe("#E15759");
  });

  it("surligne en vert 4+ les zones du set highlight (filtre 4+/priorité actif)", () => {
    const decorated = decorateZonesWithKindColor(
      zonesFC([
        { code: "H-1", kind: "habitation" },
        { code: "H-2", kind: "habitation" },
      ]),
      new Set(["H1"]), // forme comparable (tirets ignorés)
      null,
    );
    expect(decorated.features[0].properties.kindColor).toBe("#16a34a");
    expect(decorated.features[1].properties.kindColor).toBe("#EDC948");
  });

  it("ne mute pas les features d'origine", () => {
    const source = zonesFC([{ code: "H-1", kind: "habitation" }]);
    decorateZonesWithKindColor(source, new Set(), null);
    expect(source.features[0].properties.kindColor).toBeUndefined();
  });
});

describe("zoneKindLegend", () => {
  it("lists conservation and recreation with distinct labels and colors", () => {
    const zones = [
      { kind: "agricole", code: "A-118" },
      { kind: null, code: "H-354" },
      { kind: null, code: "H-159" },
      { kind: null, code: "C-186" },
      { kind: "Conservation", code: "CONS-2" },
      { kind: "Récréation", code: "REC-11" },
      { kind: null, code: "4052" },
    ];
    const legend = zoneKindLegend(zones, null);
    const labels = legend.map((entry) => entry.label);
    expect(labels).toContain("Habitation");
    expect(labels).toContain("Commercial");
    expect(labels).toContain("Agricole");
    expect(labels.filter((label) => label === "Conservation")).toHaveLength(1);
    expect(labels.filter((label) => label === "Récréation / tourisme")).toHaveLength(1);
    expect(ZONE_KIND_STYLES.CONS.token).not.toBe(ZONE_KIND_STYLES.REC.token);
    expect(ZONE_KIND_STYLES.CONS.fallback).not.toBe(ZONE_KIND_STYLES.REC.fallback);
    // Directive owner : une zone sans famille source n'ajoute PLUS d'entrée
    // « Type non déterminé » (aucune catégorie inventée en légende).
    expect(labels).not.toContain(ZONE_KIND_NEUTRAL.label);
    // Aucun kind absent (industriel/mixte non présents ici).
    expect(labels).not.toContain("Industriel");
    expect(labels).not.toContain("Mixte");
  });
});

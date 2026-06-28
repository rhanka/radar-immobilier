import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
import type { GeoZoneFeature, GeoZonesResponse } from "./geo-zones-client.js";
import type { LotFeatureCollection } from "./lots-client.js";
import {
  decorateLotsWithSignalProjection,
  extractSignalLotRefs,
  extractSignalZoneRefs,
  extractSignalZoneRefsDetailed,
  fallbackZoneCode,
  mergeDesignatedZones,
  normalizeZoneCodeRef,
  normalizeLotNoRef,
  opacityForSelectionKey,
  withCityFallbackZone,
} from "./signaux-map-geo.js";
import {
  DIMMED_SELECTION_OPACITY,
  FULL_SELECTION_OPACITY,
  createSelectionBucketState,
  makeKey,
} from "./selection-bucket.js";

const CITY_SLUG = "salaberry-de-valleyfield";

function polygon(): GeoJsonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [-74.1, 45.25],
        [-74.09, 45.25],
        [-74.09, 45.26],
        [-74.1, 45.26],
        [-74.1, 45.25],
      ],
    ],
  };
}

function emptyZonesResponse(): GeoZonesResponse {
  return {
    ok: true,
    citySlug: CITY_SLUG,
    source: "none",
    resolutionStatus: "missing",
    geometryStatus: "missing",
    zoneCount: 0,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}

function zone(code: string, lots: string[]): GeoZoneFeature {
  return {
    type: "Feature",
    geometry: polygon(),
    properties: {
      code,
      citySlug: CITY_SLUG,
      geometryStatus: "official",
      confidence: 1,
      source: "official-zone",
      lotCount: lots.length,
      lots: lots.map((noLot) => ({ citySlug: CITY_SLUG, noLot })),
      label: `Zone ${code}`,
    },
  };
}

function lots(): LotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: ["4 516 943", "4 516 944", "4 516 945"].map((noLot) => ({
      type: "Feature",
      geometry: polygon(),
      properties: { noLot, citySlug: CITY_SLUG },
    })),
  };
}

function signal(id: string, props: Record<string, unknown>): GraphSignalNode {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug: CITY_SLUG,
    sourceRef: null,
    createdAt: null,
    props,
  };
}

describe("withCityFallbackZone", () => {
  it("creates an explicit fallback:<citySlug> zone when the API has no zones", () => {
    const result = withCityFallbackZone(emptyZonesResponse(), {
      citySlug: CITY_SLUG,
      cityName: "Salaberry-de-Valleyfield",
      geometry: polygon(),
    });

    expect(result.created).toBe(true);
    expect(result.response.zoneCount).toBe(0);
    expect(result.response.resolutionStatus).toBe("fallback");
    expect(result.response.featureCollection.features[0].properties).toMatchObject({
      code: fallbackZoneCode(CITY_SLUG),
      geometryStatus: "missing",
      label: "Fallback ville - Salaberry-de-Valleyfield",
    });
  });

  it("keeps official zones unchanged", () => {
    const response: GeoZonesResponse = {
      ...emptyZonesResponse(),
      source: "official",
      resolutionStatus: "official",
      geometryStatus: "official",
      zoneCount: 1,
      featureCollection: { type: "FeatureCollection", features: [zone("H-609", [])] },
    };

    const result = withCityFallbackZone(response, {
      citySlug: CITY_SLUG,
      cityName: "Salaberry-de-Valleyfield",
      geometry: polygon(),
    });

    expect(result.created).toBe(false);
    expect(result.response).toBe(response);
  });
});

describe("opacityForSelectionKey", () => {
  it("uses the layer default while the selection bucket is empty", () => {
    const key = makeKey("zone", `${CITY_SLUG}/H-609`);

    expect(opacityForSelectionKey(createSelectionBucketState(), key, 0.42)).toBe(0.42);
  });

  it("keeps selected entities full color and unselected entities at 50 percent", () => {
    const selectedKey = makeKey("zone", `${CITY_SLUG}/H-609`);
    const otherKey = makeKey("lot", `${CITY_SLUG}/4 516 943`);
    const state = createSelectionBucketState({ selectedKeys: [selectedKey] });

    expect(opacityForSelectionKey(state, selectedKey, 0.42)).toBe(FULL_SELECTION_OPACITY);
    expect(opacityForSelectionKey(state, otherKey, 0.42)).toBe(DIMMED_SELECTION_OPACITY);
  });
});

describe("normalizeZoneCodeRef — miroir client de extract-refs serveur", () => {
  it("passe en majuscules", () => {
    expect(normalizeZoneCodeRef("h-431")).toBe("H-431");
  });

  it("supprime les espaces", () => {
    expect(normalizeZoneCodeRef("H 431")).toBe("H431");
    expect(normalizeZoneCodeRef("H34 -327")).toBe("H34-327");
  });

  it("remplace les tirets demi-cadratins par des tirets ASCII", () => {
    expect(normalizeZoneCodeRef("H–431")).toBe("H-431");
    expect(normalizeZoneCodeRef("H—431")).toBe("H-431");
  });

  it("supprime le suffixe secteur entre parenthèses", () => {
    expect(normalizeZoneCodeRef("H34-327 (VLO)")).toBe("H34-327");
    expect(normalizeZoneCodeRef("C-512 (SAT)")).toBe("C-512");
  });

  it("code déjà normalisé reste identique", () => {
    expect(normalizeZoneCodeRef("H-431")).toBe("H-431");
    expect(normalizeZoneCodeRef("RU1302")).toBe("RU1302");
  });
});

describe("normalizeLotNoRef — suppression espaces/tirets", () => {
  it("supprime les espaces dans un noLot cadastral", () => {
    expect(normalizeLotNoRef("4 516 943")).toBe("4516943");
  });

  it("lot déjà compact reste identique", () => {
    expect(normalizeLotNoRef("4516943")).toBe("4516943");
  });
});

describe("extractSignalZoneRefs — normalisation à l'extraction", () => {
  it("normalise les codes de zone extraits (casse, espaces, tirets unicode)", () => {
    const node = signal("sig-1", { zone_ref: "h-431" });
    expect(extractSignalZoneRefs(node)).toContain("H-431");
  });

  it("normalise le code avec suffixe secteur", () => {
    const node = signal("sig-1", { zone_ref: "H34-327 (VLO)" });
    expect(extractSignalZoneRefs(node)).toContain("H34-327");
  });

  it("déduplique les codes après normalisation (h-431 et H-431 → un seul H-431)", () => {
    const node = signal("sig-1", { zone_ref: "h-431", zoneRef: "H-431" });
    const refs = extractSignalZoneRefs(node);
    expect(refs.filter((r) => r === "H-431").length).toBe(1);
  });
});

describe("extractSignalZoneRefsDetailed — provenance structuré vs inféré", () => {
  it("structuré seul : source 'structured', confiance 1, aucun bruit du label", () => {
    const node = signal("sig-struct", { zone_ref: "C-18" });
    expect(extractSignalZoneRefsDetailed(node)).toEqual([
      { code: "C-18", source: "structured", confidence: 1 },
    ]);
  });

  it("citation seule (Rosemère « zone C-18 ») : code inféré listable", () => {
    const node = signal("rezonage-lot-3005325", {
      citation: "rezonage du lot 3005325 vers la zone C-18 (pôle régional)",
    });
    expect(extractSignalZoneRefsDetailed(node)).toContainEqual({
      code: "C-18",
      source: "inferred",
      confidence: 0.85,
    });
    expect(extractSignalZoneRefs(node)).toContain("C-18");
  });

  it("label seul (« H-59 ») : code inféré du format à tiret", () => {
    const node = signal("Rezonage H-59 secteur ouest", {});
    expect(extractSignalZoneRefsDetailed(node)).toContainEqual({
      code: "H-59",
      source: "inferred",
      confidence: 0.65,
    });
  });

  it("format collé sans tiret (St-Frédéric « Rf51 ») : code inféré compact", () => {
    const node = signal("Densification Rf51 prevue", {});
    expect(extractSignalZoneRefsDetailed(node)).toContainEqual({
      code: "RF51",
      source: "inferred",
      confidence: 0.5,
    });
  });

  it("mixte : structuré I93 conservé + Rf51 cité au label inféré (cas A-SF2)", () => {
    const node = signal("Rezonage Rf51 densification", { zone_ref: "I93" });
    const detailed = extractSignalZoneRefsDetailed(node);
    expect(detailed).toContainEqual({ code: "I93", source: "structured", confidence: 1 });
    expect(detailed).toContainEqual({ code: "RF51", source: "inferred", confidence: 0.5 });
  });

  it("rien : aucun code → tableau vide (anti-invention)", () => {
    const node = signal("sig-empty", { description: "aucune zone citée dans ce texte" });
    expect(extractSignalZoneRefsDetailed(node)).toEqual([]);
    expect(extractSignalZoneRefs(node)).toEqual([]);
  });

  it("anti-écrasement : un code structuré aussi cité reste 'structured'", () => {
    const node = signal("Rezonage zone C-18 confirmee", { zone_ref: "C-18" });
    expect(extractSignalZoneRefsDetailed(node)).toEqual([
      { code: "C-18", source: "structured", confidence: 1 },
    ]);
  });

  it("dédoublonnage : un même code cité deux fois → une seule entrée inférée", () => {
    const node = signal("sig-dup", {
      citation: "la zone C-18 est modifiée ; voir aussi la zone C-18 au plan",
    });
    const detailed = extractSignalZoneRefsDetailed(node);
    expect(detailed.filter((z) => z.code === "C-18")).toHaveLength(1);
    expect(detailed[0]).toEqual({ code: "C-18", source: "inferred", confidence: 0.85 });
  });

  it("garde-fou règlement : Z-94/Z-84 de concordance ne sont PAS pris pour des zones", () => {
    const node = signal("sig-concordance", {
      citation: "règlement de concordance 2009-Z-84 modifiant le règlement Z-94",
    });
    const refs = extractSignalZoneRefs(node);
    expect(refs).not.toContain("Z-94");
    expect(refs).not.toContain("Z-84");
  });
});

describe("extractSignalLotRefs — double forme brute + compacte", () => {
  it("retourne la forme brute ET la forme compacte pour couvrir les deux formats API", () => {
    const node = signal("sig-1", { noLot: "4 516 944" });
    const refs = extractSignalLotRefs(node);
    expect(refs).toContain("4 516 944");
    expect(refs).toContain("4516944");
  });

  it("le lot compact en entrée produit une seule valeur", () => {
    const node = signal("sig-1", { noLot: "4516944" });
    const refs = extractSignalLotRefs(node);
    expect(refs).toContain("4516944");
  });
});

describe("mergeDesignatedZones — zones désignées par signal sans polygone", () => {
  it("ajoute une feature 'désignée' pour un code de zone absent des zones API", () => {
    // Cas St-Frédéric : signal désigne A16 (rezonage futur), inexistant dans le cadastre OGC.
    const apiZones = [zone("A-19", []), zone("I-90", [])];
    const nodes = [
      signal("sig-a16", { zone_ref: "A16" }),
      signal("sig-i93", { properties: { zone_ref: "I93" } }),
    ];

    const merged = mergeDesignatedZones(apiZones, nodes, CITY_SLUG);
    const codes = merged.map((z) => z.properties.code);

    expect(codes).toContain("A-19");
    expect(codes).toContain("I-90");
    expect(codes).toContain("A16");
    expect(codes).toContain("I93");

    const a16 = merged.find((z) => z.properties.code === "A16")!;
    expect(a16.geometry).toBeNull();
    expect(a16.properties.geometryStatus).toBe("missing");
    expect(a16.properties.source).toBe("signal-designated");
    expect(a16.properties.citySlug).toBe(CITY_SLUG);
  });

  it("ne duplique pas une zone déjà présente (match par forme normalisée, tiret ignoré)", () => {
    // signal désigne "A16", l'API renvoie "A-16" (même zone, tiret différent) → pas de doublon.
    const apiZones = [zone("A-16", [])];
    const nodes = [signal("sig-a16", { zone_ref: "A16" })];

    const merged = mergeDesignatedZones(apiZones, nodes, CITY_SLUG);

    expect(merged).toHaveLength(1);
    expect(merged[0].properties.code).toBe("A-16");
    expect(merged[0].properties.source).toBe("official-zone");
  });

  it("retourne les zones API inchangées quand aucun signal ne désigne de zone hors-couche", () => {
    const apiZones = [zone("H-609", [])];
    const nodes = [signal("sig-h609", { zone_ref: "H-609" })];

    const merged = mergeDesignatedZones(apiZones, nodes, CITY_SLUG);

    expect(merged).toHaveLength(1);
    expect(merged[0].properties.source).toBe("official-zone");
  });

  it("déduplique plusieurs signaux désignant le même code hors-couche", () => {
    const merged = mergeDesignatedZones(
      [],
      [
        signal("sig-1", { zone_ref: "A16" }),
        signal("sig-2", { zone_ref: "A16" }),
      ],
      CITY_SLUG,
    );

    expect(merged.filter((z) => z.properties.code === "A16")).toHaveLength(1);
  });
});

describe("decorateLotsWithSignalProjection", () => {
  it("marks direct lot relations when a signal carries a structured lot ref", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [signal("sig-1", { targets_lot: ["4516944"] })],
    );

    expect(decorated.features[1].properties).toMatchObject({
      noLot: "4 516 944",
      signalProjection: "direct",
    });
  });

  it("inherits zone-level signal state to linked lots when no direct lot ref exists", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [signal("sig-1", { zone_ref: "H-609" })],
    );

    expect(decorated.features.map((feature) => feature.properties.signalProjection ?? "none"))
      .toEqual(["inherited", "inherited", "none"]);
  });

  it("keeps direct lot evidence stronger than inherited zone context", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [
        signal("sig-zone", { zone_ref: "H-609" }),
        signal("sig-lot", { noLot: "4 516 943" }),
      ],
    );

    expect(decorated.features[0].properties.signalProjection).toBe("direct");
    expect(decorated.features[1].properties.signalProjection).toBe("inherited");
  });

  it("reads lot and zone refs from nested graph properties", () => {
    const decorated = decorateLotsWithSignalProjection(
      lots(),
      [zone("H-609", ["4 516 943", "4 516 944"])],
      [
        signal("sig-zone", { properties: { zone_ref: "H-609" } }),
        signal("sig-lot", { properties: { targets_lot: ["4516945"] } }),
      ],
    );

    expect(decorated.features.map((feature) => feature.properties.signalProjection ?? "none"))
      .toEqual(["inherited", "inherited", "direct"]);
  });
});

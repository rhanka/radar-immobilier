/**
 * Tests de l'enrichissement lots↔zones (jointure en mémoire).
 * Formes couvertes : zonage OGC live (zone_code + kind anglais), store local
 * (zoneCode), jointure par code, par centroïde, zone introuvable, tod/priorite,
 * superficieM2 calculée.
 */
import { describe, expect, it } from "vitest";
import {
  buildZoneIndex,
  enrichLotFeatures,
  lotCentroid,
  zoneReglementProvenance,
  zoneUsageDominant,
  type EnrichFeature,
} from "./lot-zone-enrichment.js";

// ─── Fixtures géométriques ────────────────────────────────────────────────────

/** Carré [minX,minY]-[maxX,maxY] en Polygon GeoJSON. */
function square(minX: number, minY: number, maxX: number, maxY: number) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  };
}

/** Zonage type OGC live (delson/candiac/saint-constant). */
const LIVE_ZONAGE_FC = {
  features: [
    {
      type: "Feature",
      geometry: square(-73.6, 45.3, -73.5, 45.4),
      properties: {
        zone_code: "M-209",
        prefix: "M",
        kind: "mixed-use",
        n_lots: 12,
        source: "geopdf-esri",
        confidence: "contour-auto",
      },
    },
    {
      type: "Feature",
      geometry: square(-73.8, 45.3, -73.7, 45.4),
      properties: {
        zone_code: "H-241",
        prefix: "H",
        kind: "residential",
        n_lots: 39,
      },
    },
    {
      type: "Feature",
      geometry: square(-73.9, 45.5, -73.85, 45.55),
      properties: {
        zone_code: "P-307",
        prefix: "P",
        kind: "institutional",
        URL_GRILLE: "https://exemple.qc.ca/grilles/P-307.pdf",
      },
    },
  ] as EnrichFeature[],
};

/** Zonage type store local PG (geo-features.ts). */
const LOCAL_ZONAGE_FC = {
  features: [
    {
      type: "Feature",
      geometry: square(-72.6, 46.3, -72.5, 46.4),
      properties: {
        featureKind: "zone",
        zoneVersionId: "zv-1",
        zoneCode: "H-101",
        zoneUsage: "zonage", // kind PG non-canonique → repli préfixe
        citySlug: "exempleville",
      },
    },
  ] as EnrichFeature[],
};

// ─── buildZoneIndex ───────────────────────────────────────────────────────────

describe("buildZoneIndex", () => {
  it("indexe le zonage OGC live : code normalisé, kind anglais → canonique, URL_GRILLE", () => {
    const index = buildZoneIndex(LIVE_ZONAGE_FC);
    expect(index.size).toBe(3);

    const mixte = index.byCodeNorm.get("M-209")!;
    expect(mixte.kind).toBe("MIXTE");
    expect(mixte.densiteLogHa).toBeNull(); // pas de densité live → null honnête
    expect(mixte.usages).toEqual([]);

    const h = index.byCodeNorm.get("H-241")!;
    expect(h.kind).toBe("H");

    const p = index.byCodeNorm.get("P-307")!;
    expect(p.kind).toBe("P");
    expect(p.grillePdfUrl).toBe("https://exemple.qc.ca/grilles/P-307.pdf");
  });

  it("indexe le zonage du store local (zoneCode) avec kind par préfixe", () => {
    const index = buildZoneIndex(LOCAL_ZONAGE_FC);
    expect(index.size).toBe(1);
    const zone = index.byCodeNorm.get("H-101")!;
    expect(zone.kind).toBe("H"); // "zonage" (PG) inconnu → préfixe H- → H
    expect(zone.bbox).toEqual([-72.6, 46.3, -72.5, 46.4]);
  });

  it("ignore les zones sans code exploitable", () => {
    const index = buildZoneIndex({
      features: [
        { type: "Feature", geometry: null, properties: { kind: "residential" } },
      ],
    });
    expect(index.size).toBe(0);
  });

  it("lit une densité réelle quand la source zonage la porte", () => {
    const index = buildZoneIndex({
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: { zone_code: "H-500", densite_log_ha: 65 },
        },
      ],
    });
    expect(index.byCodeNorm.get("H-500")!.densiteLogHa).toBe(65);
  });

  it("lit la provenance du règlement (zone de norme) quand la source la porte", () => {
    const index = buildZoneIndex({
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: {
            zone_code: "H-600",
            reglement_numero: "2008-102",
            reglement_millesime: 2008,
            reglement_page_source: "12",
            reglement_url: "https://ville.qc.ca/reglements/2008-102.pdf",
          },
        },
      ],
    });
    const zone = index.byCodeNorm.get("H-600")!;
    expect(zone.reglementNumero).toBe("2008-102");
    expect(zone.reglementMillesime).toBe(2008);
    expect(zone.reglementPageSource).toBe("12");
    expect(zone.reglementUrl).toBe("https://ville.qc.ca/reglements/2008-102.pdf");
  });

  it("provenance du règlement : chaque champ null quand la source ne le porte pas", () => {
    const index = buildZoneIndex({
      features: [
        { type: "Feature", geometry: null, properties: { zone_code: "H-700" } },
      ],
    });
    const zone = index.byCodeNorm.get("H-700")!;
    expect(zone.reglementNumero).toBeNull();
    expect(zone.reglementMillesime).toBeNull();
    expect(zone.reglementPageSource).toBeNull();
    expect(zone.reglementUrl).toBeNull();
  });

  it("lit l'usage dominant + sa source quand la source les porte", () => {
    const index = buildZoneIndex({
      features: [
        {
          type: "Feature",
          geometry: null,
          properties: {
            zone_code: "H-800",
            usage_dominant: "residentiel",
            usage_dominant_source: "zone-nomenclature",
          },
        },
      ],
    });
    const zone = index.byCodeNorm.get("H-800")!;
    expect(zone.usageDominant).toBe("residentiel");
    expect(zone.usageDominantSource).toBe("zone-nomenclature");
  });

  it("usage dominant absent → null (aucune classification inventée)", () => {
    const index = buildZoneIndex({
      features: [
        { type: "Feature", geometry: null, properties: { zone_code: "H-810" } },
      ],
    });
    const zone = index.byCodeNorm.get("H-810")!;
    expect(zone.usageDominant).toBeNull();
    expect(zone.usageDominantSource).toBeNull();
  });
});

// ─── zoneUsageDominant (lecteur direct) ───────────────────────────────────────

describe("zoneUsageDominant", () => {
  it("lit usage_dominant + usage_dominant_source (passthrough verbatim)", () => {
    expect(
      zoneUsageDominant({
        usage_dominant: "agricole",
        usage_dominant_source: "zone-nomenclature",
      }),
    ).toEqual({ value: "agricole", source: "zone-nomenclature" });
  });

  it("valeur servie sans source → source null", () => {
    expect(zoneUsageDominant({ usage_dominant: "commercial" })).toEqual({
      value: "commercial",
      source: null,
    });
  });

  it("aucune clé → value/source null (anti-invention)", () => {
    expect(zoneUsageDominant({ zone_code: "H-9" })).toEqual({
      value: null,
      source: null,
    });
  });
});

// ─── zoneReglementProvenance (lecteur direct) ─────────────────────────────────

describe("zoneReglementProvenance", () => {
  it("lit les clés snake_case et camelCase (numéro sans millésime possible)", () => {
    expect(
      zoneReglementProvenance({
        reglementNumero: "1926-26",
        reglement_url: "https://x/1926-26.pdf",
      }),
    ).toEqual({
      numero: "1926-26",
      millesime: null,
      pageSource: null,
      url: "https://x/1926-26.pdf",
    });
  });

  it("rend la page source verbatim (nombre → chaîne)", () => {
    expect(zoneReglementProvenance({ reglement_page_source: 42 }).pageSource).toBe(
      "42",
    );
  });

  it("aucune clé de provenance → tout null (anti-invention)", () => {
    expect(zoneReglementProvenance({ zone_code: "H-9" })).toEqual({
      numero: null,
      millesime: null,
      pageSource: null,
      url: null,
    });
  });
});

// ─── lotCentroid ──────────────────────────────────────────────────────────────

describe("lotCentroid", () => {
  it("centroïde d'un carré = son centre", () => {
    const c = lotCentroid(square(0, 0, 2, 2))!;
    expect(c[0]).toBeCloseTo(1, 9);
    expect(c[1]).toBeCloseTo(1, 9);
  });

  it("géométrie non polygonale → null", () => {
    expect(lotCentroid({ type: "Point", coordinates: [1, 1] })).toBeNull();
    expect(lotCentroid(null)).toBeNull();
  });
});

// ─── enrichLotFeatures ────────────────────────────────────────────────────────

/** Lot live type qc-lots-* (aucun attribut de zone). */
function liveLot(
  noLot: string,
  geometry: { type: string; coordinates?: unknown } | null,
  extra: Record<string, unknown> = {},
): EnrichFeature {
  return {
    type: "Feature",
    geometry,
    properties: {
      NO_LOT: noLot,
      noLot,
      geoId: `ca/qc/lot/${noLot}`,
      name: noLot,
      code: noLot,
      level: "locality",
      country: "CA",
      ...extra,
    },
  };
}

describe("enrichLotFeatures — jointure par centroïde (cas live : lot sans code de zone)", () => {
  const index = buildZoneIndex(LIVE_ZONAGE_FC);

  it("lot dans la zone MIXTE → zone jointe + multifamilial4plus=true (heuristique)", () => {
    // Lot au centre de M-209 ([-73.6..-73.5] × [45.3..45.4])
    const lot = liveLot("1 000 001", square(-73.556, 45.349, -73.555, 45.35));
    const { features, stats } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;

    expect(stats.joinedByCentroid).toBe(1);
    expect(props["zoneCode"]).toBe("M-209");
    expect(props["zoneJoin"]).toBe("centroid");
    expect(props["zone"]).toEqual({
      code: "M-209",
      kind: "MIXTE",
      densiteLogHa: null,
      usages: [],
      grillePdfUrl: null,
      reglementNumero: null,
      reglementMillesime: null,
      reglementPageSource: null,
      reglementUrl: null,
      usageDominant: null,
      usageDominantSource: null,
    });
    expect(props["multifamilial4plus"]).toBe(true);
    expect(props["multifamilial4plusSource"]).toBe("heuristique");
    // tod absent de la source → ni tod ni priorite (anti-invention)
    expect("tod" in props).toBe(false);
    expect("priorite" in props).toBe(false);
    // Propriétés brutes conservées
    expect(props["NO_LOT"]).toBe("1 000 001");
  });

  it("lot dans la zone H (sans grille) → multifamilial4plus=false, heuristique", () => {
    const lot = liveLot("1 000 002", square(-73.756, 45.349, -73.755, 45.35));
    const { features } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(props["zoneCode"]).toBe("H-241");
    expect(props["multifamilial4plus"]).toBe(false);
    expect(props["multifamilial4plusSource"]).toBe("heuristique");
  });

  it("lot hors de toute zone → AUCUN champ zone/flag ajouté", () => {
    const lot = liveLot("1 000 003", square(-70.001, 44.001, -70.0, 44.002));
    const { features, stats } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(stats.unjoined).toBe(1);
    expect("zone" in props).toBe(false);
    expect("zoneCode" in props).toBe(false);
    expect("multifamilial4plus" in props).toBe(false);
    expect("priorite" in props).toBe(false);
  });
});

describe("enrichLotFeatures — jointure par code explicite", () => {
  const index = buildZoneIndex(LIVE_ZONAGE_FC);

  it("lot portant zone_code → lookup direct, zoneJoin=code (prioritaire sur le spatial)", () => {
    // Géométrie DANS M-209 mais code explicite H-241 : le code prime.
    const lot = liveLot("2 000 001", square(-73.556, 45.349, -73.555, 45.35), {
      zone_code: "h–241 ", // tiret cadratin + casse + espace → normalizeZoneCode
    });
    const { features, stats } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(stats.joinedByCode).toBe(1);
    expect(props["zoneJoin"]).toBe("code");
    expect(props["zoneCode"]).toBe("H-241");
  });
});

describe("enrichLotFeatures — provenance du règlement propagée dans zone{...}", () => {
  const index = buildZoneIndex({
    features: [
      {
        type: "Feature",
        geometry: square(-73.6, 45.3, -73.5, 45.4),
        properties: {
          zone_code: "H-241",
          kind: "residential",
          reglement_numero: "2008-102",
          reglement_millesime: 2008,
          reglement_url: "https://ville.qc.ca/reglements/2008-102.pdf",
        },
      },
    ] as EnrichFeature[],
  });

  it("le payload zone lot porte la provenance réelle (numéro, millésime, url)", () => {
    const lot = liveLot("4 000 001", square(-73.556, 45.349, -73.555, 45.35));
    const { features } = enrichLotFeatures([lot], index);
    const zone = features[0]!.properties!["zone"] as Record<string, unknown>;
    expect(zone["reglementNumero"]).toBe("2008-102");
    expect(zone["reglementMillesime"]).toBe(2008);
    expect(zone["reglementPageSource"]).toBeNull();
    expect(zone["reglementUrl"]).toBe(
      "https://ville.qc.ca/reglements/2008-102.pdf",
    );
  });
});

describe("enrichLotFeatures — usage dominant propagé dans zone{...}", () => {
  const index = buildZoneIndex({
    features: [
      {
        type: "Feature",
        geometry: square(-73.6, 45.3, -73.5, 45.4),
        properties: {
          zone_code: "H-241",
          kind: "residential",
          usage_dominant: "residentiel",
          usage_dominant_source: "zone-nomenclature",
        },
      },
    ] as EnrichFeature[],
  });

  it("le payload zone lot porte l'usage dominant réel + sa source", () => {
    const lot = liveLot("5 000 001", square(-73.556, 45.349, -73.555, 45.35));
    const { features } = enrichLotFeatures([lot], index);
    const zone = features[0]!.properties!["zone"] as Record<string, unknown>;
    expect(zone["usageDominant"]).toBe("residentiel");
    expect(zone["usageDominantSource"]).toBe("zone-nomenclature");
  });

  it("usage dominant absent de la source → null dans le payload (jamais inventé)", () => {
    const bareIndex = buildZoneIndex({
      features: [
        {
          type: "Feature",
          geometry: square(-73.6, 45.3, -73.5, 45.4),
          properties: { zone_code: "H-241", kind: "residential" },
        },
      ] as EnrichFeature[],
    });
    const lot = liveLot("5 000 002", square(-73.556, 45.349, -73.555, 45.35));
    const { features } = enrichLotFeatures([lot], bareIndex);
    const zone = features[0]!.properties!["zone"] as Record<string, unknown>;
    expect(zone["usageDominant"]).toBeNull();
    expect(zone["usageDominantSource"]).toBeNull();
  });
});

describe("enrichLotFeatures — tod / priorite (jamais fabriqués)", () => {
  const index = buildZoneIndex(LIVE_ZONAGE_FC);

  it("tod=true porté par la source + zone MIXTE → priorite=true", () => {
    const lot = liveLot("3 000 001", square(-73.556, 45.349, -73.555, 45.35), {
      tod: true,
    });
    const { features } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(props["tod"]).toBe(true);
    expect(props["multifamilial4plus"]).toBe(true);
    expect(props["priorite"]).toBe(true);
  });

  it("tod=true + zone H (4+ false) → priorite=false (présent car les deux existent)", () => {
    const lot = liveLot("3 000 002", square(-73.756, 45.349, -73.755, 45.35), {
      in_tod: "true", // variante snake_case string
    });
    const { features } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(props["tod"]).toBe(true);
    expect(props["priorite"]).toBe(false);
  });

  it("tod porté mais zone introuvable → tod transmis, priorite absent", () => {
    const lot = liveLot("3 000 003", square(-70.001, 44.001, -70.0, 44.002), {
      tod: true,
    });
    const { features } = enrichLotFeatures([lot], index);
    const props = features[0]!.properties!;
    expect(props["tod"]).toBe(true);
    expect("priorite" in props).toBe(false);
  });
});

describe("enrichLotFeatures — superficieM2 et index absent", () => {
  it("superficieM2 calculée depuis la géométrie publique quand absente de la source", () => {
    // Carré ~100m × ~111m à lat 45.35 (0.001° lat ≈ 111.3 m)
    const lot = liveLot("4 000 001", square(-73.556, 45.349, -73.5547, 45.35));
    const { features } = enrichLotFeatures([lot], null);
    const props = features[0]!.properties!;
    expect(typeof props["superficieM2"]).toBe("number");
    expect(props["superficieM2"] as number).toBeGreaterThan(5000);
    expect(props["superficieM2"] as number).toBeLessThan(20000);
  });

  it("superficie de la source conservée quand présente", () => {
    const lot = liveLot("4 000 002", square(0, 0, 1, 1), {
      superficie_m2_calculee: 432.1,
    });
    const { features } = enrichLotFeatures([lot], null);
    expect(features[0]!.properties!["superficieM2"]).toBe(432.1);
  });

  it("index null → aucun champ zone, pas de crash", () => {
    const lot = liveLot("4 000 003", square(0, 0, 1, 1));
    const { features, stats } = enrichLotFeatures([lot], null);
    expect(stats.unjoined).toBe(1);
    expect("zone" in features[0]!.properties!).toBe(false);
  });
});

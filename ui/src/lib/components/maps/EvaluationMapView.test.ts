/**
 * Tests for EvaluationMapView drilldown lots (WP B slice-2).
 *
 * Pattern : test helpers + client, no Svelte component render
 * (no @testing-library/svelte in devDeps — tracked as follow-up).
 *
 * Coverage :
 *   1. lots-client : resolveLotsUrl, fetchLots (mock fetch)
 *   2. SVG projection helpers (ported from EvaluationMapView script)
 *   3. Drilldown state invariants (aucune PII)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLots, resolveLotsUrl, type LotFeature } from "$lib/maps/lots-client.js";

// ── Fixtures réalistes (lots MRNF, aucune PII) ────────────────────────────────

function makeLotFeature(noLot: string, citySlug: string): LotFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-74.12, 45.27],
          [-74.115, 45.27],
          [-74.115, 45.275],
          [-74.12, 45.275],
          [-74.12, 45.27],
        ],
      ],
    },
    properties: { noLot, citySlug },
  };
}

const VALLEYFIELD_FC = {
  type: "FeatureCollection" as const,
  features: [
    makeLotFeature("4 516 943", "salaberry-de-valleyfield"),
    makeLotFeature("4 516 944", "salaberry-de-valleyfield"),
    makeLotFeature("4 516 945", "salaberry-de-valleyfield"),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. Client lots ────────────────────────────────────────────────────────────

describe("EvaluationMapView drilldown — lots-client integration", () => {
  it("fetchLots retourne les lots d'une ville avec source", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    expect(res.ok).toBe(true);
    expect(res.featureCollection.features).toHaveLength(3);
  });

  it("fetchLots retourne ok=false avec featureCollection vide quand ville sans source", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          ok: false,
          citySlug: "unknown",
          source: "none",
          reason: "Ville inconnue",
          featureCollection: { type: "FeatureCollection", features: [] },
        }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("unknown", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.featureCollection.features).toHaveLength(0);
    expect(res.reason).toBeTruthy();
  });

  it("fetchLots lève une erreur sur HTTP 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchLots("salaberry-de-valleyfield", { baseUrl: "" })).rejects.toThrow(
      "lots HTTP 500",
    );
  });

  it("resolveLotsUrl construit l'URL correcte avec limit", () => {
    const url = resolveLotsUrl("salaberry-de-valleyfield", { baseUrl: "http://api:3000", limit: 100 });
    expect(url).toBe("http://api:3000/api/geo/salaberry-de-valleyfield/lots?limit=100");
  });

  it("resolveLotsUrl construit l'URL sans baseUrl", () => {
    expect(resolveLotsUrl("beauharnois", { baseUrl: "" })).toBe("/api/geo/beauharnois/lots");
  });
});

// ── 2. Projection SVG équirectangulaire (même formule que le composant) ───────

// Réplication des helpers purs du composant pour les tester en isolation.
interface SvgBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

function projX(lon: number, bbox: SvgBbox, svgW: number): number {
  return ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * svgW;
}

function projY(lat: number, bbox: SvgBbox, svgH: number): number {
  return ((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * svgH;
}

function computeLotsBbox(features: LotFeature[]): SvgBbox {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const f of features) {
    if (!f.geometry || f.geometry.type !== "Polygon") continue;
    const rings = f.geometry.coordinates as number[][][];
    for (const ring of rings) {
      for (const pt of ring) {
        const lon = pt[0];
        const lat = pt[1];
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  if (!isFinite(minLon)) {
    return { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
  }
  const padLon = (maxLon - minLon) * 0.08 + 0.001;
  const padLat = (maxLat - minLat) * 0.08 + 0.001;
  return { minLon: minLon - padLon, minLat: minLat - padLat, maxLon: maxLon + padLon, maxLat: maxLat + padLat };
}

describe("EvaluationMapView drilldown — SVG projection helpers", () => {
  const SVG_W = 640;
  const SVG_H = 400;

  it("computeLotsBbox retourne un fallback pour FeatureCollection vide", () => {
    const bbox = computeLotsBbox([]);
    expect(bbox.minLon).toBeLessThan(-74);
    expect(bbox.maxLon).toBeGreaterThan(-74);
  });

  it("computeLotsBbox couvre les coordonnées des lots", () => {
    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
    expect(bbox.minLon).toBeLessThan(-74.12);
    expect(bbox.maxLon).toBeGreaterThan(-74.115);
    expect(bbox.minLat).toBeLessThan(45.27);
    expect(bbox.maxLat).toBeGreaterThan(45.275);
  });

  it("projX → x dans [0, SVG_W] pour des coords dans la bbox", () => {
    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
    const x = projX(-74.117, bbox, SVG_W);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(SVG_W);
  });

  it("projY → y dans [0, SVG_H] pour des coords dans la bbox (Y inversé)", () => {
    const bbox = computeLotsBbox(VALLEYFIELD_FC.features);
    const y = projY(45.272, bbox, SVG_H);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(SVG_H);
  });

  it("projX coin gauche ≈ 0, coin droit ≈ SVG_W", () => {
    const bbox: SvgBbox = { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
    expect(projX(-74.2, bbox, SVG_W)).toBeCloseTo(0, 0);
    expect(projX(-73.4, bbox, SVG_W)).toBeCloseTo(SVG_W, 0);
  });

  it("projY coin haut ≈ 0 (lat maxLat), coin bas ≈ SVG_H (lat minLat)", () => {
    const bbox: SvgBbox = { minLon: -74.2, minLat: 45.2, maxLon: -73.4, maxLat: 45.6 };
    expect(projY(45.6, bbox, SVG_H)).toBeCloseTo(0, 0);
    expect(projY(45.2, bbox, SVG_H)).toBeCloseTo(SVG_H, 0);
  });
});

// ── 3. Anti-PII : properties des lots ────────────────────────────────────────

describe("EvaluationMapView drilldown — anti-PII (Loi 25)", () => {
  it("les properties de chaque lot ne contiennent que noLot et citySlug", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    for (const f of res.featureCollection.features) {
      const keys = Object.keys(f.properties);
      for (const k of keys) {
        expect(["noLot", "citySlug"]).toContain(k);
      }
      // noLot doit être une chaîne non vide
      expect(typeof f.properties.noLot).toBe("string");
      expect(f.properties.noLot.length).toBeGreaterThan(0);
    }
  });

  it("lots MRNF n'ont pas de champ owner, nom, adresse, évaluation foncière", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    for (const f of res.featureCollection.features) {
      expect(f.properties).not.toHaveProperty("owner");
      expect(f.properties).not.toHaveProperty("name");
      expect(f.properties).not.toHaveProperty("address");
      expect(f.properties).not.toHaveProperty("evaluation");
      expect(f.properties).not.toHaveProperty("valeur");
    }
  });
});

// ── 4. État vide (ville sans source lots) ─────────────────────────────────────

describe("EvaluationMapView drilldown — état vide honnête", () => {
  it("featureCollection vide quand ok=false (no source)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          ok: false,
          citySlug: "no-source-city",
          source: "none",
          reason: "Pas de source lots pour cette ville",
          featureCollection: { type: "FeatureCollection", features: [] },
        }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("no-source-city", { baseUrl: "" });
    expect(res.featureCollection.features).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/source/i);
  });

  it("polygonFeatures filtre les features sans geometry Polygon", () => {
    const features: LotFeature[] = [
      { type: "Feature", geometry: null, properties: { noLot: "A", citySlug: "x" } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { noLot: "B", citySlug: "x" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { noLot: "C", citySlug: "x" } },
    ];
    const polygons = features.filter((f) => f.geometry && f.geometry.type === "Polygon");
    expect(polygons).toHaveLength(1);
    expect(polygons[0].properties.noLot).toBe("B");
  });
});

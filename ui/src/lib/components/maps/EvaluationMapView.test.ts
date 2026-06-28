/**
 * Tests for EvaluationMapView — zonage relié aux lots cadastraux (WP B slice-2).
 *
 * Pattern : test helpers + clients, no Svelte component render
 * (no @testing-library/svelte in devDeps — tracked as follow-up).
 *
 * Coverage :
 *   1. lots-client : resolveLotsUrl, fetchLots (mock fetch)
 *   2. signal-detail-client : fetchSignalDetail (mock fetch) — zonage events
 *   3. Panneau zonage + lots : rendu des données combinées (mock fetch both)
 *   4. SVG projection helpers (ported from EvaluationMapView script)
 *   5. Anti-PII (Loi 25)
 *   6. État vide (ville sans source lots / sans zonage)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLots, resolveLotsUrl, type LotFeature } from "$lib/maps/lots-client.js";
import {
  fetchSignalDetail,
  resolveSignalDetailUrl,
  type DesignationEventDetail,
  type SignalDetailResponse,
  type SignalEvidence,
} from "$lib/signals/signal-detail-client.js";

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

// ── Fixtures réalistes (changements de zonage) ────────────────────────────────

function legacyEvidence(sourceRef: string): SignalEvidence {
  return {
    description: null,
    citation: null,
    excerpt: null,
    sourceUrl: null,
    documentUrl: null,
    rawRef: sourceRef,
    rawObjectKey: sourceRef,
    sourceRef,
    documentDate: null,
    page: null,
    bbox: null,
    refs: [
      {
        docSha: null,
        citation: null,
        excerpt: null,
        sourceUrl: null,
        documentUrl: null,
        rawRef: sourceRef,
        rawObjectKey: sourceRef,
        page: null,
        bbox: null,
      },
    ],
    completeness: {
      hasDescription: false,
      hasCitationExcerpt: false,
      hasPdfLink: true,
      hasDocumentDate: false,
      hasPage: false,
      hasBbox: false,
      missing: ["description", "citation", "documentDate", "page", "bbox"],
    },
  };
}

const MOCK_ZONAGE_EVENTS: DesignationEventDetail[] = [
  {
    label: "Avis de motion règlement de zonage 1926-26+1927-26 (zone H-431)",
    reglementNumbers: ["1926-26", "1927-26"],
    zoneRefs: ["H-431"],
    sourceRef: "raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt",
    dateObserved: "2026-05-19T12:00:00.000Z",
    evidence: legacyEvidence("raw/proces-verbaux-saint-constant/2026/05/19/abc123.txt"),
  },
  {
    label: "Avis d'approbation règlement zonage résidentiel 1928-10 (zone H-521)",
    reglementNumbers: ["1928-10"],
    zoneRefs: ["H-521"],
    sourceRef: "raw/proces-verbaux-saint-constant/2026/05/22/def456.txt",
    dateObserved: "2026-05-22T14:00:00.000Z",
    evidence: legacyEvidence("raw/proces-verbaux-saint-constant/2026/05/22/def456.txt"),
  },
];

const MOCK_DETAIL_VALLEYFIELD: SignalDetailResponse = {
  ok: true,
  citySlug: "salaberry-de-valleyfield",
  events: MOCK_ZONAGE_EVENTS,
};

const MOCK_DETAIL_EMPTY: SignalDetailResponse = {
  ok: true,
  citySlug: "delson",
  events: [],
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
    expect(url).toBe("http://api:3000/api/geo/collections/qc-lots-salaberry-de-valleyfield/items?limit=100");
  });

  it("resolveLotsUrl construit l'URL sans baseUrl", () => {
    expect(resolveLotsUrl("beauharnois", { baseUrl: "" })).toBe("/api/geo/collections/qc-lots-beauharnois/items");
  });
});

// ── 2. Client signal-detail (zonage) ─────────────────────────────────────────

describe("EvaluationMapView — signal-detail-client (changements de zonage)", () => {
  it("fetchSignalDetail retourne les événements de zonage d'une ville", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 }),
    );
    const res = await fetchSignalDetail("salaberry-de-valleyfield", "");
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(2);
    expect(res.events[0]!.reglementNumbers).toContain("1926-26");
    expect(res.events[0]!.zoneRefs).toContain("H-431");
  });

  it("fetchSignalDetail retourne events vide pour ville sans état projet", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_DETAIL_EMPTY), { status: 200 }),
    );
    const res = await fetchSignalDetail("delson", "");
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(0);
  });

  it("fetchSignalDetail lève sur HTTP 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchSignalDetail("salaberry-de-valleyfield", "")).rejects.toThrow(
      "signals/detail HTTP 500",
    );
  });

  it("resolveSignalDetailUrl construit l'URL correcte", () => {
    expect(resolveSignalDetailUrl("saint-constant", "")).toBe(
      "/api/signals/saint-constant/detail",
    );
    expect(resolveSignalDetailUrl("saint-constant", "http://api:3000")).toBe(
      "http://api:3000/api/signals/saint-constant/detail",
    );
  });
});

// ── 3. Panneau zonage + lots : rendu combiné ──────────────────────────────────

describe("EvaluationMapView — panneau zonage+lots (rendu combiné)", () => {
  it("charge lots ET zonage en parallèle pour la même ville", async () => {
    let lotsCallCount = 0;
    let zonageCallCount = 0;

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        lotsCallCount++;
        return new Response(
          JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
          { status: 200 },
        );
      }
      if (url.includes("/api/signals/")) {
        zonageCallCount++;
        return new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("salaberry-de-valleyfield", { baseUrl: "" }),
      fetchSignalDetail("salaberry-de-valleyfield", ""),
    ]);

    expect(lotsCallCount).toBe(1);
    expect(zonageCallCount).toBe(1);
    expect(lotsRes.featureCollection.features).toHaveLength(3);
    expect(zonageRes.events).toHaveLength(2);
  });

  it("les lots chargés sont bien des Polygon (pas de Point ni null)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
        { status: 200 },
      ),
    );
    const res = await fetchLots("salaberry-de-valleyfield", { baseUrl: "" });
    const polygonFeatures = res.featureCollection.features.filter(
      (f) => f.geometry && f.geometry.type === "Polygon",
    );
    expect(polygonFeatures.length).toBe(res.featureCollection.features.length);
    expect(polygonFeatures.length).toBeGreaterThan(0);
  });

  it("le lien zonage→lots : zoneRefs du signal associées aux lots de la ville", async () => {
    // Test du lien conceptuel : même citySlug → même ville → lots + zoneRefs liés
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        return new Response(
          JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("salaberry-de-valleyfield", { baseUrl: "" }),
      fetchSignalDetail("salaberry-de-valleyfield", ""),
    ]);

    // Les lots ont tous le même citySlug que les events de zonage
    const citySlug = "salaberry-de-valleyfield";
    for (const f of lotsRes.featureCollection.features) {
      expect(f.properties.citySlug).toBe(citySlug);
    }
    expect(zonageRes.citySlug).toBe(citySlug);

    // Les zoneRefs du signal existent bien
    const allZoneRefs = zonageRes.events.flatMap((e) => e.zoneRefs);
    expect(allZoneRefs).toContain("H-431");
    expect(allZoneRefs).toContain("H-521");
  });

  it("résumé : compte correct de changements de zonage et lots", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        return new Response(
          JSON.stringify({ ok: true, citySlug: "salaberry-de-valleyfield", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("salaberry-de-valleyfield", { baseUrl: "" }),
      fetchSignalDetail("salaberry-de-valleyfield", ""),
    ]);

    const nZonage = zonageRes.events.length;
    const nLots = lotsRes.featureCollection.features.filter(
      (f) => f.geometry && f.geometry.type === "Polygon",
    ).length;

    // Résumé attendu : "<N> changements de zonage · <M> lots chargés"
    const summary = [
      nZonage > 0 ? `${nZonage} changement${nZonage !== 1 ? "s" : ""} de zonage` : null,
      nLots > 0 ? `${nLots} lot${nLots !== 1 ? "s" : ""} chargé${nLots !== 1 ? "s" : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    expect(summary).toBe("2 changements de zonage · 3 lots chargés");
  });

  it("état vide honnête : aucun zonage + lots chargés → résumé sans zonage", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        return new Response(
          JSON.stringify({ ok: true, citySlug: "delson", source: "donnees-quebec", featureCollection: VALLEYFIELD_FC }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(MOCK_DETAIL_EMPTY), { status: 200 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("delson", { baseUrl: "" }),
      fetchSignalDetail("delson", ""),
    ]);

    expect(zonageRes.events).toHaveLength(0);
    expect(lotsRes.featureCollection.features).toHaveLength(3);

    const nZonage = zonageRes.events.length;
    const nLots = lotsRes.featureCollection.features.filter(
      (f) => f.geometry && f.geometry.type === "Polygon",
    ).length;

    const parts: string[] = [];
    if (nZonage > 0) parts.push(`${nZonage} changements de zonage`);
    if (nLots > 0) parts.push(`${nLots} lots chargés`);
    const summary = parts.join(" · ");

    expect(summary).toBe("3 lots chargés");
    expect(summary).not.toContain("zonage");
  });

  it("état vide honnête : aucun lot + zonage disponible", async () => {
    const emptyLotsFC = { type: "FeatureCollection" as const, features: [] };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        return new Response(
          JSON.stringify({ ok: false, citySlug: "saint-damase", source: "none", reason: "Pas de source", featureCollection: emptyLotsFC }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("saint-damase", { baseUrl: "" }),
      fetchSignalDetail("saint-damase", ""),
    ]);

    expect(lotsRes.ok).toBe(false);
    expect(lotsRes.featureCollection.features).toHaveLength(0);
    expect(zonageRes.events).toHaveLength(2);

    // Résumé : uniquement le zonage
    const nZonage = zonageRes.events.length;
    const nLots = lotsRes.featureCollection.features.filter(
      (f) => f.geometry && f.geometry.type === "Polygon",
    ).length;
    const parts: string[] = [];
    if (nZonage > 0) parts.push(`${nZonage} changements de zonage`);
    if (nLots > 0) parts.push(`${nLots} lots chargés`);
    expect(parts.join(" · ")).toBe("2 changements de zonage");
  });
});

// ── 4. Projection SVG équirectangulaire (même formule que le composant) ───────

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

// ── 5. Anti-PII : properties des lots ────────────────────────────────────────

describe("EvaluationMapView drilldown — anti-PII (Loi 25)", () => {
  it("les properties de chaque lot ne contiennent que des champs publics non-PII", async () => {
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
        // Champs publics autorisés : identifiants + score de potentiel dérivé (public, Loi 25 OK).
        expect([
          "noLot",
          "citySlug",
          "potentialScore",
          "potentialScoreStatus",
          "potentialScoreSource",
          "potentialScoreReason",
        ]).toContain(k);
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

  it("les changements de zonage ne contiennent aucun nom de personne ou adresse", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_DETAIL_VALLEYFIELD), { status: 200 }),
    );
    const res = await fetchSignalDetail("salaberry-de-valleyfield", "");
    for (const event of res.events) {
      // Les champs présents ne contiennent que des données réglementaires publiques
      const keys = Object.keys(event);
      for (const k of keys) {
        expect(["label", "reglementNumbers", "zoneRefs", "sourceRef", "dateObserved", "evidence"]).toContain(k);
      }
    }
  });
});

// ── 6. État vide honnête ──────────────────────────────────────────────────────

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
    expect(polygons[0]!.properties.noLot).toBe("B");
  });

  it("events vide pour une ville sans état projet (état vide honnête — pas d'erreur)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_DETAIL_EMPTY), { status: 200 }),
    );
    const res = await fetchSignalDetail("delson", "");
    expect(res.ok).toBe(true);
    expect(res.events).toHaveLength(0);
    // Pas de throw — état vide honnête
  });

  it("double vide : aucun lot + aucun zonage → résumé vide (pas de contenu inventé)", async () => {
    const emptyLotsFC = { type: "FeatureCollection" as const, features: [] };
    const emptyDetail: SignalDetailResponse = { ok: true, citySlug: "unknown-city", events: [] };

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/geo/")) {
        return new Response(
          JSON.stringify({ ok: false, citySlug: "unknown-city", source: "none", reason: "Pas de source", featureCollection: emptyLotsFC }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(emptyDetail), { status: 200 });
    });

    const [lotsRes, zonageRes] = await Promise.all([
      fetchLots("unknown-city", { baseUrl: "" }),
      fetchSignalDetail("unknown-city", ""),
    ]);

    const nZonage = zonageRes.events.length;
    const nLots = lotsRes.featureCollection.features.filter(
      (f) => f.geometry && f.geometry.type === "Polygon",
    ).length;

    expect(nZonage).toBe(0);
    expect(nLots).toBe(0);

    // Résumé vide
    const parts: string[] = [];
    if (nZonage > 0) parts.push(`${nZonage} changements de zonage`);
    if (nLots > 0) parts.push(`${nLots} lots chargés`);
    expect(parts).toHaveLength(0);
  });
});

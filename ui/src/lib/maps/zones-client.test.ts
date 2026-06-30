import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchZones,
  zonesCollectionId,
  resolveZonesUrl,
  matchZonesToSignal,
  type ZonesResponse,
  type ZoneFeature,
} from "./zones-client.js";
import { extractSignalZoneRefs } from "./signaux-map-geo.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeZonePolygon(props: Record<string, unknown>): unknown {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-73.6, 45.35],
          [-73.59, 45.35],
          [-73.59, 45.36],
          [-73.6, 45.36],
          [-73.6, 45.35],
        ],
      ],
    },
    properties: props,
  };
}

// FeatureCollection OGC réaliste — 3 zones, champs de code volontairement
// hétérogènes pour valider le matching de propriété FLEXIBLE.
const MOCK_OGC_ZONES_OK = {
  type: "FeatureCollection",
  features: [
    makeZonePolygon({ code: "H-431", kind: "habitation", usages: ["residentiel"] }),
    makeZonePolygon({ ZONE: "C-18", type: "commerce", usage: "commerce, bureau" }),
    makeZonePolygon({ code_affiche: "A-16", categorie: "agricole" }),
  ],
  numberMatched: 312,
  numberReturned: 3,
};

const MOCK_LEGACY_ZONES_OK: ZonesResponse = {
  ok: true,
  citySlug: "saint-frederic",
  source: "donnees-quebec",
  featureCollection: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { code: "I-93", citySlug: "saint-frederic" },
      },
    ],
  },
};

function makeSignalNode(props: Record<string, unknown>): GraphSignalNode {
  return {
    id: "gn-test-0",
    type: "Signal",
    label: "gn-test-0",
    citySlug: "longueuil",
    sourceRef: null,
    createdAt: null,
    props,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── zonesCollectionId / resolveZonesUrl ──────────────────────────────────────

describe("zonesCollectionId", () => {
  it("maps a city slug to the OGC zonage collection id", () => {
    expect(zonesCollectionId("saint-eustache")).toBe("qc-zonage-saint-eustache");
  });
});

describe("resolveZonesUrl", () => {
  it("returns path when no baseUrl", () => {
    expect(resolveZonesUrl("longueuil", { baseUrl: "" })).toBe(
      "/api/geo/collections/qc-zonage-longueuil/items",
    );
  });

  it("appends baseUrl stripping trailing slash", () => {
    expect(resolveZonesUrl("longueuil", { baseUrl: "http://localhost:3000/" })).toBe(
      "http://localhost:3000/api/geo/collections/qc-zonage-longueuil/items",
    );
  });

  it("includes limit query param when provided", () => {
    expect(resolveZonesUrl("beauharnois", { baseUrl: "", limit: 50 })).toContain("limit=50");
  });

  it("includes bbox query param when provided", () => {
    const url = resolveZonesUrl("saint-constant", {
      baseUrl: "",
      bbox: [-73.6, 45.35, -73.52, 45.4],
    });
    expect(url).toContain("bbox=-73.6%2C45.35%2C-73.52%2C45.4");
  });
});

// ── fetchZones ───────────────────────────────────────────────────────────────

describe("fetchZones", () => {
  it("returns normalized FeatureCollection on OGC HTTP 200 (flexible code fields)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_OGC_ZONES_OK), { status: 200 }),
    );
    const res = await fetchZones("longueuil", { baseUrl: "", limit: 3 });
    expect(res.ok).toBe(true);
    expect(res.citySlug).toBe("longueuil");
    expect(res.collectionId).toBe("qc-zonage-longueuil");
    expect(res.numberMatched).toBe(312);
    expect(res.numberReturned).toBe(3);
    expect(res.featureCollection.features).toHaveLength(3);

    const codes = res.featureCollection.features.map((f) => f.properties.code);
    expect(codes).toEqual(["H-431", "C-18", "A-16"]);

    // kind / usages normalisés depuis candidats multiples.
    const h431 = res.featureCollection.features[0]!;
    expect(h431.properties.kind).toBe("habitation");
    expect(h431.properties.usages).toEqual(["residentiel"]);
    expect(h431.properties.citySlug).toBe("longueuil");

    const c18 = res.featureCollection.features[1]!;
    expect(c18.properties.code).toBe("C-18");
    expect(c18.properties.kind).toBe("commerce"); // depuis `type`
    expect(c18.properties.usages).toEqual(["commerce", "bureau"]); // csv → array

    const a16 = res.featureCollection.features[2]!;
    expect(a16.properties.code).toBe("A-16"); // depuis `code_affiche`
    expect(a16.properties.kind).toBe("agricole"); // depuis `categorie`
  });

  it("drops features without any resolvable code (no false zone)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            makeZonePolygon({ label: "zone sans code" }),
            makeZonePolygon({ code: "H-12" }),
          ],
        }),
        { status: 200 },
      ),
    );
    const res = await fetchZones("longueuil", { baseUrl: "" });
    expect(res.featureCollection.features).toHaveLength(1);
    expect(res.featureCollection.features[0]!.properties.code).toBe("H-12");
  });

  it("returns ok=false with empty featureCollection on HTTP 404 (collection not served yet)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "collection_not_found" }), { status: 404 }),
    );
    const res = await fetchZones("longueuil", { baseUrl: "" });
    expect(res.ok).toBe(false);
    expect(res.source).toBe("none");
    expect(res.collectionId).toBe("qc-zonage-longueuil");
    expect(res.featureCollection.features).toHaveLength(0);
    // Pas de faux compteur.
    expect(res.numberMatched).toBe(0);
    expect(res.reason).toContain("Collection zonage non configurée");
  });

  it("accepts a legacy ZonesResponse body (mock symmetry with lots-client)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_LEGACY_ZONES_OK), { status: 200 }),
    );
    const res = await fetchZones("saint-frederic", { baseUrl: "" });
    expect(res.ok).toBe(true);
    expect(res.featureCollection.features).toHaveLength(1);
    expect(res.featureCollection.features[0]!.properties.code).toBe("I-93");
    expect(res.numberMatched).toBe(1);
  });

  it("throws on HTTP 500", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchZones("longueuil", { baseUrl: "" })).rejects.toThrow("zones HTTP 500");
  });
});

// ── matchZonesToSignal (JOIN pur) ────────────────────────────────────────────

describe("matchZonesToSignal", () => {
  const zones: ZoneFeature[] = [
    { type: "Feature", geometry: null, properties: { code: "H-431" } },
    { type: "Feature", geometry: null, properties: { code: "C-18" } },
    { type: "Feature", geometry: null, properties: { code: "A-16" } },
  ];

  it("matches a structured zone_ref cited by a signal (exact code)", () => {
    const node = makeSignalNode({ zone_ref: "H-431" });
    const refs = extractSignalZoneRefs(node);
    const matched = matchZonesToSignal(refs, zones);
    expect(matched.map((z) => z.properties.code)).toEqual(["H-431"]);
  });

  it("matches across dash/space/case differences (A16 cited ↔ A-16 zone)", () => {
    // Le signal cite "A16" (sans tiret), la zone est "A-16" : doit matcher.
    const node = makeSignalNode({ zone: "a16" });
    const refs = extractSignalZoneRefs(node);
    const matched = matchZonesToSignal(refs, zones);
    expect(matched.map((z) => z.properties.code)).toEqual(["A-16"]);
  });

  it("matches multiple cited codes and ignores non-cited zones", () => {
    const node = makeSignalNode({ zone_refs: "H-431, C-18" });
    const refs = extractSignalZoneRefs(node);
    const matched = matchZonesToSignal(refs, zones);
    expect(matched.map((z) => z.properties.code).sort()).toEqual(["C-18", "H-431"]);
  });

  it("returns [] when the signal cites no zone (anti-false-match)", () => {
    const node = makeSignalNode({ label: "avis de motion sans zone" });
    const refs = extractSignalZoneRefs(node);
    expect(refs).toHaveLength(0);
    expect(matchZonesToSignal(refs, zones)).toEqual([]);
  });

  it("returns [] for an empty cited code and never matches an empty zone code", () => {
    expect(matchZonesToSignal([""], zones)).toEqual([]);
    const zonesWithEmpty: ZoneFeature[] = [
      ...zones,
      { type: "Feature", geometry: null, properties: { code: "  " } },
    ];
    // Un code cité vide ne doit jamais s'apparier à une zone (même code vide).
    expect(matchZonesToSignal([""], zonesWithEmpty)).toEqual([]);
  });

  it("does not match a cited code absent from the zone layer", () => {
    const node = makeSignalNode({ zone_ref: "Z-999" });
    const refs = extractSignalZoneRefs(node);
    expect(matchZonesToSignal(refs, zones)).toEqual([]);
  });

  it("end-to-end: fetched zones joined to an inferred signal ref", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_OGC_ZONES_OK), { status: 200 }),
    );
    const res = await fetchZones("longueuil", { baseUrl: "" });
    // Signal cite la zone via un champ structuré normalisable "C 18" (espace).
    const node = makeSignalNode({ target_zone: "C 18" });
    const refs = extractSignalZoneRefs(node);
    const matched = matchZonesToSignal(refs, res.featureCollection.features);
    expect(matched.map((z) => z.properties.code)).toEqual(["C-18"]);
  });
});

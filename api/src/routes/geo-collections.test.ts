/**
 * Tests de GET /api/geo/collections/:id/items — priorité store local + fallback proxy.
 * fetchImpl et localResolver mockés — aucun appel réseau réel, aucun Postgres.
 */
import { describe, expect, it } from "vitest";
import {
  geoCollectionsRoute,
  parseCollectionId,
  type LocalCollectionResolver,
} from "./geo-collections.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────
const LOCAL_FC = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: { type: "Point", coordinates: [-73.6, 45.6] },
      properties: { featureKind: "zone", zoneCode: "H-101", citySlug: "delson" },
    },
  ],
};

const GEO_OGC_FC = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.8, 45.65] },
      properties: { ZONE: "C-18" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-73.81, 45.66] },
      properties: { ZONE: "H-431" },
    },
  ],
};

function makeOkFetch(body: unknown = GEO_OGC_FC): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeFailFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch;
}

function makeThrowFetch(): typeof fetch {
  return (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
}

const emptyLocal: LocalCollectionResolver = async () => null;

// ─── parseCollectionId ─────────────────────────────────────────────────────
describe("parseCollectionId", () => {
  it("parse qc-zonage-<city> et qc-lots-<city>", () => {
    expect(parseCollectionId("qc-zonage-rosemere")).toEqual({
      collectionId: "qc-zonage-rosemere",
      kind: "zonage",
      citySlug: "rosemere",
    });
    expect(parseCollectionId("qc-lots-delson")).toEqual({
      collectionId: "qc-lots-delson",
      kind: "lots",
      citySlug: "delson",
    });
  });

  it("parse qc-zoning-events-<slug> (couche geo-only events), geo-slug double-tiret inclus", () => {
    expect(parseCollectionId("qc-zoning-events-longueuil")).toEqual({
      collectionId: "qc-zoning-events-longueuil",
      kind: "zoning-events",
      citySlug: "longueuil",
    });
    // geo-slug à double-tiret (ex. alias radar↔geo) → slug conservé verbatim.
    expect(parseCollectionId("qc-zoning-events-saint-isidore--roussillon")).toEqual({
      collectionId: "qc-zoning-events-saint-isidore--roussillon",
      kind: "zoning-events",
      citySlug: "saint-isidore--roussillon",
    });
  });

  it("rejette les collections hors préfixe (anti-SSRF)", () => {
    expect(parseCollectionId("foo-bar")).toBeNull();
    expect(parseCollectionId("qc-zonage-")).toBeNull();
    expect(parseCollectionId("qc-zoning-events-")).toBeNull();
  });
});

// ─── Zoning-events (couche geo-only → proxy direct, sans store PG ni enrichissement) ──
describe("zoning-events (proxy geo-api direct)", () => {
  it("qc-zoning-events : saute le store local et proxie la geo-api", async () => {
    const { fn, calls } = makeOkFetch();
    const localResolver: LocalCollectionResolver = async () => null; // couche geo-only
    const app = geoCollectionsRoute({ localResolver, fetchImpl: fn });

    const res = await app.request(
      "/api/geo/collections/qc-zoning-events-longueuil/items?limit=200",
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1); // proxifié vers la geo-api (aucun store local)
    expect(String(calls[0])).toContain("/collections/qc-zoning-events-longueuil/items");
  });
});

// ─── Store local prioritaire (lots + zonage sous `pg`) ───────────────────────
describe("store local prioritaire (lots + zonage sous pg)", () => {
  it("lots : sert les features locales et n'appelle PAS le proxy", async () => {
    const { fn, calls } = makeOkFetch();
    const localResolver: LocalCollectionResolver = async () => LOCAL_FC;
    const app = geoCollectionsRoute({ localResolver, fetchImpl: fn });

    const res = await app.request("/api/geo/collections/qc-lots-delson/items?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      features: unknown[];
      numberReturned: number;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.numberReturned).toBe(1);
    expect(calls).toHaveLength(0); // aucun proxy
  });

  it("zonage sous GEO_ZONES_SOURCE=pg : store local prioritaire, aucun live geo", async () => {
    const { fn, calls } = makeOkFetch();
    const localResolver: LocalCollectionResolver = async () => LOCAL_FC;
    const app = geoCollectionsRoute({ localResolver, fetchImpl: fn, zonesSource: "pg" });

    const res = await app.request("/api/geo/collections/qc-zonage-delson/items?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: unknown[] };
    expect(body.features).toHaveLength(1);
    expect(calls).toHaveLength(0); // pg → store local, jamais le live geo
  });
});

// ─── Zonage live-first (GEO_ZONES_SOURCE=live, défaut) ────────────────────────
describe("zonage live-first (GEO_ZONES_SOURCE=live, défaut)", () => {
  it("sert le LIVE GEO en priorité même quand le PG store-local a des zones (fraîcheur Sutton)", async () => {
    // PG store-local = cohorte PÉRIMÉE (P-1 arcgis) ; live geo = cohorte à jour.
    const stalePg = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point", coordinates: [-72.6, 45.1] },
          properties: { featureKind: "zone", zoneCode: "P-1", citySlug: "sutton" },
        },
      ],
    };
    const liveGeo = {
      type: "FeatureCollection",
      numberMatched: 2,
      numberReturned: 2,
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-72.61, 45.11] },
          properties: { zone_code: "RUR-3", reglement_millesime: 2018, reglement_numero: "2018-45" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-72.62, 45.12] },
          properties: { zone_code: "CONS-1" },
        },
      ],
    };
    const localResolver: LocalCollectionResolver = async () => stalePg;
    const { fn, calls } = makeOkFetch(liveGeo);
    const app = geoCollectionsRoute({
      localResolver,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    const res = await app.request("/api/geo/collections/qc-zonage-sutton/items?limit=3000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    // Live geo servi (2 zones RUR/CONS) ; le PG périmé n'est JAMAIS rendu.
    expect(body.features).toHaveLength(2);
    expect(body.features.map((f) => f.properties["zone_code"])).toEqual(["RUR-3", "CONS-1"]);
    expect(JSON.stringify(body)).not.toContain("P-1");
    // Le live geo a bien été appelé (priorité), pas seulement en fallback.
    expect(calls.some((u) => u.includes("/collections/qc-zonage-sutton/items"))).toBe(true);
  });

  it("fallback PG store-local quand le live geo répond 404", async () => {
    const localResolver: LocalCollectionResolver = async () => LOCAL_FC;
    const app = geoCollectionsRoute({
      localResolver,
      fetchImpl: makeFailFetch(404),
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-zonage-delson/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: unknown[] };
    expect(body.features).toHaveLength(1); // PG servi en repli propre
  });

  it("fallback PG store-local quand le live geo est injoignable (réseau)", async () => {
    const localResolver: LocalCollectionResolver = async () => LOCAL_FC;
    const app = geoCollectionsRoute({
      localResolver,
      fetchImpl: makeThrowFetch(),
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-zonage-delson/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: unknown[] };
    expect(body.features).toHaveLength(1);
  });

  it("live geo 404 ET PG vide → 404 honnête (collection réellement absente)", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeFailFetch(404),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-inconnue/items");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("collection_not_found");
  });

  it("met en cache le zonage live : 2 requêtes identiques → 1 seul fetch geo", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    await app.request("/api/geo/collections/qc-zonage-delson/items?limit=3000");
    await app.request("/api/geo/collections/qc-zonage-delson/items?limit=3000");
    expect(calls.filter((u) => u.includes("qc-zonage-delson"))).toHaveLength(1);
  });
});

// ─── Fallback proxy ──────────────────────────────────────────────────────────
describe("fallback proxy geo (collection absente du store local)", () => {
  it("proxifie vers l'API geo et renvoie la FeatureCollection OGC telle quelle", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    const res = await app.request(
      "/api/geo/collections/qc-zonage-rosemere/items?limit=1&bbox=-74,45,-73,46",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; features: unknown[] };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(2);

    expect(calls).toHaveLength(1);
    const url = calls[0]!;
    expect(url).toContain("https://geo.example/collections/qc-zonage-rosemere/items");
    expect(url).toContain("limit=1");
    expect(url).toContain("bbox=-74%2C45%2C-73%2C46");
    expect(url).toContain("f=json");
  });

  it("proxifie aussi qc-lots-*", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-lots-rosemere/items");
    expect(res.status).toBe(200);
    expect(calls[0]).toContain("/collections/qc-lots-rosemere/items");
  });
});

describe("provenance passthrough — additivité stricte (contrat §9.4)", () => {
  const statuses = [
    "historical-verified",
    "legacy-traceable",
    "candidate-needs-human-confirmation",
    "orphan",
  ] as const;

  /** Provenance v1 CONFORME pour un statut de géométrie donné. */
  function provenanceFor(status: (typeof statuses)[number]) {
    const isHistorical = status === "historical-verified";
    return {
      contract: "immo-zone-lot-provenance/v1",
      assessed_at: "2026-07-22T14:00:00Z",
      lot_assignment_evidence: {
        state: "recorded",
        selected_zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-12" },
        assignment_method: "area-majority",
        dominant_fraction: 0.9,
        multi_zone: false,
        zone_codes: ["H-12"],
        evidence_snapshot: "2026-06-21",
        evidence_id: "lot-zone-ev-7d21",
        reason_codes: [],
      },
      zone_geometry_provenance: {
        status,
        zone: { collection: "qc-zonage-delson", feature_ref: null, code: "H-12" },
        public_source: isHistorical
          ? {
              url: "https://donnees.example.org/zonage.geojson",
              type: "geojson-officiel",
              method: "natif",
              retrieved_at: "2026-06-21T09:00:00Z",
              sha256: null,
            }
          : null,
        verified_at: isHistorical ? "2026-07-22T13:50:00Z" : null,
        evidence_id: isHistorical ? "geom-ev-a02e" : null,
        reason_codes: status === "orphan" ? ["source-identity-unlinked"] : status === "candidate-needs-human-confirmation" ? ["needs-human-confirmation"] : [],
      },
      acquisition_v2_readiness: { state: "not-ready", checked_at: "2026-07-22T14:00:00Z", unmet_requirement_codes: ["missing-content-sha256"] },
    };
  }

  /** Champs PRÉEXISTANTS (jointure) + proof — la donnée que le contrat protège. */
  function baseProperties(index: number) {
    return {
      NO_LOT: `700000${index}`,
      zone_code: "H-12",
      code_zone: "H-12",
      zone_codes: ["H-12"],
      dominant_fraction: 0.9,
      multi_zone: false,
      assignment_method: "area-majority",
      norms: { hauteur: "12 m", densite: null },
      adresse: null,
      proof: {
        schema_version: "1.0",
        status: index % 2 ? "partial" : "complete",
        sources: {
          geometry: { status: "available", artifact_uri: "https://geo.example/lots.geojson", upstream_uri: null },
          regulation: { status: "unavailable", artifact_uri: null, upstream_uri: null },
        },
        zone: null,
        gaps: ["regulation_source_unavailable"],
      },
    };
  }

  /** BASELINE : projection préexistante (proof, JAMAIS de provenance). */
  function baselineLots() {
    return {
      type: "FeatureCollection",
      features: statuses.map((_status, index) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.5 + index / 100, 45.4] },
        properties: baseProperties(index),
      })),
    };
  }

  /** ENRICHI : baseline + l'enveloppe de provenance additive. */
  function auditedLots() {
    return {
      type: "FeatureCollection",
      features: statuses.map((status, index) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.5 + index / 100, 45.4] },
        properties: { ...baseProperties(index), immo_zone_lot_provenance: provenanceFor(status) },
      })),
    };
  }

  const emptyZones = { type: "FeatureCollection", features: [] };

  async function serve(body: unknown) {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeCollectionsFetch({ lots: { status: 200, body }, zonage: { status: 200, body: emptyZones } }).fn,
    });
    const res = await app.request("/api/geo/collections/qc-lots-delson/items");
    return (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
  }

  it("porte les 4 statuts de provenance sans jamais toucher le rattachement enregistré", async () => {
    const auditedBody = await serve(auditedLots());
    expect(auditedBody.features).toHaveLength(4);
    expect(
      auditedBody.features.map(
        (f) => (f.properties.immo_zone_lot_provenance as { zone_geometry_provenance: { status: string } }).zone_geometry_provenance.status,
      ),
    ).toEqual([...statuses]);
  });

  it("en retirant SEULEMENT immo_zone_lot_provenance, la projection (proof inclus) est identique au baseline", async () => {
    const [auditedBody, baselineBody] = await Promise.all([serve(auditedLots()), serve(baselineLots())]);

    // Retire UNIQUEMENT la provenance (le contrat conserve proof).
    const strippedOfProvenance = auditedBody.features.map(({ properties, ...feature }) => {
      const { immo_zone_lot_provenance: _provenance, ...kept } = properties;
      return { ...feature, properties: kept };
    });
    expect(strippedOfProvenance).toEqual(baselineBody.features);

    // Identité explicite, champ par champ (contrat §9.4).
    auditedBody.features.forEach((audited, i) => {
      const base = baselineBody.features[i]!.properties;
      const p = audited.properties;
      expect(p.zone_code).toBe(base.zone_code);
      expect(p.code_zone).toBe(base.code_zone);
      expect(p.zone_codes).toEqual(base.zone_codes);
      expect(p.dominant_fraction).toBe(base.dominant_fraction);
      expect(p.multi_zone).toBe(base.multi_zone);
      expect(p.assignment_method).toBe(base.assignment_method);
      expect(p.norms).toEqual(base.norms);
      expect(p.adresse).toBeNull(); // un null préexistant reste null
      // proof PRÉSERVÉ à l'identique (jamais retiré par le sanitiseur).
      expect(p.proof).toEqual(base.proof);
      expect(p.proof).toBeDefined();
    });
  });

  it("le sanitiseur ne retire JAMAIS un proof conforme, même si la provenance est frauduleuse", async () => {
    // Un lot avec proof conforme + provenance qui fuit (clé interne) : proof
    // conservé tel quel, provenance entièrement écartée.
    const leaky = baselineLots();
    (leaky.features[0]!.properties as Record<string, unknown>).immo_zone_lot_provenance = {
      ...provenanceFor("orphan"),
      raw_log: "internal-secret", // clé inconnue = fuite → enveloppe rejetée
    };
    const body = await serve(leaky);
    const props = body.features[0]!.properties;
    expect(props.proof).toEqual(baseProperties(0).proof); // proof intact
    expect("immo_zone_lot_provenance" in props).toBe(false); // provenance écartée
    expect(JSON.stringify(body)).not.toContain("internal-secret");
  });
});

// ─── Erreurs ─────────────────────────────────────────────────────────────────
describe("erreurs", () => {
  it("erreur réseau geo → 502 honnête (pas de crash)", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeThrowFetch(),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-rosemere/items");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("geo_proxy_unreachable");
  });

  it("geo répond 5xx → 502 honnête", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeFailFetch(503),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-rosemere/items");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("geo_proxy_error");
  });

  it("geo répond 404 → 404 honnête (collection réellement absente)", async () => {
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: makeFailFetch(404),
    });
    const res = await app.request("/api/geo/collections/qc-zonage-inconnue/items");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("collection_not_found");
  });

  it("collection hors préfixe → 404 sans proxy", async () => {
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({ localResolver: emptyLocal, fetchImpl: fn });
    const res = await app.request("/api/geo/collections/random-collection/items");
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

// ─── Robustesse store local ──────────────────────────────────────────────────
describe("store local indisponible", () => {
  it("si le resolver local jette (PG down), on proxifie sans crasher", async () => {
    const { fn, calls } = makeOkFetch();
    const throwingLocal: LocalCollectionResolver = async () => {
      throw new Error("PG unavailable");
    };
    const app = geoCollectionsRoute({
      localResolver: throwingLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-lots-delson/items");
    expect(res.status).toBe(200);
    // 2 fetchs : la collection lots + le zonage pour l'enrichissement.
    expect(calls.some((u) => u.includes("/collections/qc-lots-delson/items"))).toBe(true);
  });
});

// ─── Enrichissement des lots (zone + flags dérivés) ──────────────────────────

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

/** Réplique la forme live api.geo.sent-tech.ca (2026-07). */
const LIVE_LOTS_FC = {
  type: "FeatureCollection",
  numberMatched: 1,
  numberReturned: 1,
  features: [
    {
      type: "Feature",
      geometry: square(-73.556, 45.349, -73.555, 45.35),
      properties: {
        NO_LOT: "6 057 912",
        geoId: "ca/qc/lot/6-057-912",
        name: "6 057 912",
        code: "6 057 912",
        level: "locality",
        country: "CA",
        noLot: "6 057 912",
      },
    },
  ],
};

const LIVE_ZONAGE_FC = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: square(-73.6, 45.3, -73.5, 45.4),
      properties: { zone_code: "M-209", prefix: "M", kind: "mixed-use" },
    },
  ],
};

/** fetch mock routé par collection (lots vs zonage). */
function makeCollectionsFetch(handlers: {
  lots?: { status: number; body?: unknown };
  zonage?: { status: number; body?: unknown };
}): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const target = u.includes("qc-zonage-") ? handlers.zonage : handlers.lots;
    if (!target) return new Response(null, { status: 404 });
    return new Response(
      target.body !== undefined ? JSON.stringify(target.body) : null,
      { status: target.status, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("enrichissement lots via zonage (chemin proxy)", () => {
  it("joint la zone par centroïde et dérive multifamilial4plus + zone{...}", async () => {
    const { fn } = makeCollectionsFetch({
      lots: { status: 200, body: LIVE_LOTS_FC },
      zonage: { status: 200, body: LIVE_ZONAGE_FC },
    });
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    const res = await app.request("/api/geo/collections/qc-lots-delson/items?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      numberMatched: number;
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(body.numberMatched).toBe(1); // champs OGC du body préservés

    const props = body.features[0]!.properties;
    // Bruts conservés
    expect(props["NO_LOT"]).toBe("6 057 912");
    // Enrichis (contrat JSDoc de la route)
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
    // tod absent des données live → jamais fabriqué, priorite absent aussi
    expect("tod" in props).toBe(false);
    expect("priorite" in props).toBe(false);
    // superficieM2 calculée depuis la géométrie publique
    expect(typeof props["superficieM2"]).toBe("number");
  });

  it("zonage indisponible (404) → lots servis SANS champs zone, statut 200", async () => {
    const { fn } = makeCollectionsFetch({
      lots: { status: 200, body: LIVE_LOTS_FC },
      zonage: { status: 404 },
    });
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    const res = await app.request("/api/geo/collections/qc-lots-candiac/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    const props = body.features[0]!.properties;
    expect("zone" in props).toBe(false);
    expect("multifamilial4plus" in props).toBe(false);
    expect(props["NO_LOT"]).toBe("6 057 912");
  });

  it("le zonage est mis en cache : 2 requêtes lots → 1 seul fetch zonage", async () => {
    const { fn, calls } = makeCollectionsFetch({
      lots: { status: 200, body: LIVE_LOTS_FC },
      zonage: { status: 200, body: LIVE_ZONAGE_FC },
    });
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });

    await app.request("/api/geo/collections/qc-lots-delson/items");
    await app.request("/api/geo/collections/qc-lots-delson/items");
    const zonageCalls = calls.filter((u) => u.includes("qc-zonage-delson"));
    expect(zonageCalls).toHaveLength(1);
  });

  it("les collections zonage restent servies telles quelles (non enrichies)", async () => {
    const { fn } = makeCollectionsFetch({
      zonage: { status: 200, body: LIVE_ZONAGE_FC },
    });
    const app = geoCollectionsRoute({
      localResolver: emptyLocal,
      fetchImpl: fn,
      baseUrl: "https://geo.example",
    });
    const res = await app.request("/api/geo/collections/qc-zonage-delson/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(body.features[0]!.properties).toEqual(
      LIVE_ZONAGE_FC.features[0]!.properties,
    );
  });
});

describe("enrichissement lots via zonage (chemin store local)", () => {
  it("lots locaux + zonage local → zone jointe par centroïde", async () => {
    const localLots = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: square(-73.556, 45.349, -73.555, 45.35),
          properties: {
            featureKind: "lot",
            noLot: "1234567",
            citySlug: "delson",
            zoneCode: null,
          },
        },
      ],
    };
    const localZonage = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: square(-73.6, 45.3, -73.5, 45.4),
          properties: {
            featureKind: "zone",
            zoneCode: "H-101",
            zoneUsage: "zonage",
            citySlug: "delson",
          },
        },
      ],
    };
    const localResolver: LocalCollectionResolver = async (parsed) =>
      parsed.kind === "lots" ? localLots : localZonage;
    const { fn, calls } = makeOkFetch();
    const app = geoCollectionsRoute({ localResolver, fetchImpl: fn });

    const res = await app.request("/api/geo/collections/qc-lots-delson/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    const props = body.features[0]!.properties;
    expect(props["zoneCode"]).toBe("H-101");
    expect(props["zone"]).toMatchObject({ code: "H-101", kind: "H" });
    // H sans grille → false, heuristique (sous-couverture honnête)
    expect(props["multifamilial4plus"]).toBe(false);
    expect(props["multifamilial4plusSource"]).toBe("heuristique");
    expect(calls).toHaveLength(0); // tout servi depuis le store local
  });
});

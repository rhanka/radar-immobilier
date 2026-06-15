/**
 * Tests du module arcgis-discovery (P1-B — Recensement ArcGIS rejouable).
 *
 * Tests portent sur la LOGIQUE de détection uniquement.
 * Aucun appel réseau en CI : les serveurs ArcGIS sont mockés.
 */

import { describe, it, expect, vi } from "vitest";
import type { FetchLike } from "./geo-fetch-utils.js";
import {
  defaultMunicipalDomainGuesser,
  buildProbingUrls,
  filterZonageServices,
  probeArcgisCatalog,
  resolveZonageLayer,
  discoverArcgisServices,
  formatDiscoveryReport,
  reportToRegistryEntries,
  ARCGIS_SERVER_URL_PATTERNS,
  ARCGIS_DISCOVERY_VERSION,
} from "./arcgis-discovery.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSuccessFetch(body: unknown): FetchLike {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: () => Promise.resolve(JSON.stringify(body)),
      arrayBuffer: () =>
        Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
    }),
  ) as unknown as FetchLike;
}

function makeFailFetch(status = 404): FetchLike {
  return vi.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  ) as unknown as FetchLike;
}

/** Mock qui mappe les fragments d'URL à des réponses. */
function makeUrlMockFetch(urlMap: Record<string, unknown>): FetchLike {
  return vi.fn((url: string) => {
    for (const [fragment, response] of Object.entries(urlMap)) {
      if (url.includes(fragment)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: () => Promise.resolve(JSON.stringify(response)),
          arrayBuffer: () =>
            Promise.resolve(
              new TextEncoder().encode(JSON.stringify(response)).buffer,
            ),
        });
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  }) as unknown as FetchLike;
}

// ─── Fixtures catalogue ArcGIS ────────────────────────────────────────────

/** Réponse de catalogue ArcGIS REST avec 3 services dont un Zonage. */
const ARCGIS_CATALOG_FIXTURE = {
  currentVersion: 10.91,
  folders: [],
  services: [
    { name: "Voirie/Routes", type: "FeatureServer" },
    { name: "Urbanisme/Zonage_municipal", type: "FeatureServer" },
    { name: "Parcs/ParcsVerts", type: "FeatureServer" },
  ],
};

/** Réponse de catalogue ArcGIS sans service de zonage. */
const _ARCGIS_CATALOG_NO_ZONAGE_FIXTURE = {
  currentVersion: 10.91,
  folders: [],
  services: [
    { name: "Voirie/Routes", type: "FeatureServer" },
    { name: "Parcs/ParcsVerts", type: "FeatureServer" },
  ],
};

/** Réponse d'un FeatureServer ArcGIS avec couche Zonage. */
const ARCGIS_FEATURESERVER_FIXTURE = {
  currentVersion: 10.91,
  layers: [
    { id: 0, name: "Zonage_municipal", type: "Feature Layer", geometryType: "esriGeometryPolygon" },
    { id: 1, name: "Limites_administratives", type: "Feature Layer", geometryType: "esriGeometryPolygon" },
  ],
};

/** Réponse d'une couche ArcGIS directe (polygon). */
const ARCGIS_LAYER_DIRECT_FIXTURE = {
  currentVersion: 10.91,
  name: "Zonage",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
};

// ─── Tests defaultMunicipalDomainGuesser ─────────────────────────────────

describe("defaultMunicipalDomainGuesser", () => {
  it("génère plusieurs domaines candidats pour longueuil", () => {
    const domains = defaultMunicipalDomainGuesser("longueuil");
    expect(domains.length).toBeGreaterThanOrEqual(4);
    expect(domains.some((d) => d.includes("longueuil"))).toBe(true);
    expect(domains.some((d) => d.startsWith("https://"))).toBe(true);
  });

  it("génère des patterns https seulement", () => {
    const domains = defaultMunicipalDomainGuesser("brossard");
    for (const d of domains) {
      expect(d.startsWith("https://")).toBe(true);
    }
  });

  it("gère les slugs avec tirets", () => {
    const domains = defaultMunicipalDomainGuesser("saint-hyacinthe");
    expect(domains.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Tests buildProbingUrls ───────────────────────────────────────────────

describe("buildProbingUrls", () => {
  it("génère des URLs de sondage pour un domaine", () => {
    const urls = buildProbingUrls("https://cartes.brossard.ca");
    expect(urls.length).toBe(ARCGIS_SERVER_URL_PATTERNS.length);
    expect(urls.every((u) => u.startsWith("https://cartes.brossard.ca"))).toBe(true);
    expect(urls.some((u) => u.includes("/arcgis/rest/services"))).toBe(true);
    expect(urls.some((u) => u.includes("/server/rest/services"))).toBe(true);
  });
});

// ─── Tests filterZonageServices ───────────────────────────────────────────

describe("filterZonageServices", () => {
  it("retient les services de zonage", () => {
    const services = [
      { name: "Urbanisme/Zonage_municipal", type: "FeatureServer", url: "https://..." },
      { name: "Voirie/Routes", type: "FeatureServer", url: "https://..." },
      { name: "ParcsVerts/Parcs", type: "FeatureServer", url: "https://..." },
    ];
    const result = filterZonageServices(services);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Urbanisme/Zonage_municipal");
  });

  it("détecte 'zoning' (anglais)", () => {
    const services = [
      { name: "Planning/Zoning", type: "FeatureServer", url: "https://..." },
    ];
    expect(filterZonageServices(services)).toHaveLength(1);
  });

  it("retourne tableau vide si aucun service de zonage", () => {
    const services = [
      { name: "Voirie/Routes", type: "FeatureServer", url: "https://..." },
    ];
    expect(filterZonageServices(services)).toHaveLength(0);
  });

  it("détecte 'urbanisme' et 'affectation'", () => {
    const services = [
      { name: "Plan_Urbanisme", type: "MapServer", url: "https://..." },
      { name: "Affectation_sols", type: "FeatureServer", url: "https://..." },
    ];
    const result = filterZonageServices(services);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Tests probeArcgisCatalog ─────────────────────────────────────────────

describe("probeArcgisCatalog", () => {
  it("retourne les services d'un catalogue valide", async () => {
    const mockFetch = makeSuccessFetch(ARCGIS_CATALOG_FIXTURE);
    const result = await probeArcgisCatalog(
      "https://cartes.exemple.ca/arcgis/rest/services",
      mockFetch,
      5000,
    );
    expect(result).not.toBeNull();
    expect(result?.services).toHaveLength(3);
    expect(result?.services.some((s) => s.name.includes("Zonage"))).toBe(true);
  });

  it("retourne null pour HTTP 404", async () => {
    const mockFetch = makeFailFetch(404);
    const result = await probeArcgisCatalog(
      "https://inexistant.ca/arcgis/rest/services",
      mockFetch,
      5000,
    );
    expect(result).toBeNull();
  });

  it("retourne null si la réponse n'est pas un catalogue ArcGIS", async () => {
    const mockFetch = makeSuccessFetch({ message: "Not an ArcGIS server" });
    const result = await probeArcgisCatalog(
      "https://cartes.exemple.ca/arcgis/rest/services",
      mockFetch,
      5000,
    );
    expect(result).toBeNull();
  });

  it("retourne null sur erreur réseau", async () => {
    const mockFetch: FetchLike = vi.fn(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as FetchLike;
    const result = await probeArcgisCatalog(
      "https://cartes.exemple.ca/arcgis/rest/services",
      mockFetch,
      5000,
    );
    expect(result).toBeNull();
  });
});

// ─── Tests resolveZonageLayer ─────────────────────────────────────────────

describe("resolveZonageLayer", () => {
  it("résout la couche Zonage_municipal dans un FeatureServer", async () => {
    const mockFetch = makeSuccessFetch(ARCGIS_FEATURESERVER_FIXTURE);
    const layerUrl = await resolveZonageLayer(
      "https://cartes.exemple.ca/arcgis/rest/services/Urbanisme/Zonage_municipal/FeatureServer",
      mockFetch,
      5000,
    );
    expect(layerUrl).not.toBeNull();
    expect(layerUrl).toContain("/0");
  });

  it("résout une couche directe (polygon geometryType)", async () => {
    const mockFetch = makeSuccessFetch(ARCGIS_LAYER_DIRECT_FIXTURE);
    const layerUrl = await resolveZonageLayer(
      "https://cartes.exemple.ca/arcgis/rest/services/Zonage/FeatureServer/0",
      mockFetch,
      5000,
    );
    expect(layerUrl).not.toBeNull();
    expect(layerUrl).toContain("FeatureServer/0");
  });

  it("retourne null si le service est inaccessible", async () => {
    const mockFetch = makeFailFetch(403);
    const layerUrl = await resolveZonageLayer(
      "https://cartes.exemple.ca/arcgis/rest/services/Zonage/FeatureServer",
      mockFetch,
      5000,
    );
    expect(layerUrl).toBeNull();
  });
});

// ─── Tests discoverArcgisServices ─────────────────────────────────────────

describe("discoverArcgisServices — logique détection", () => {
  it("trouve un service de zonage quand le domaine répond correctement", async () => {
    // Mock : cartes.brossard.ca/arcgis/rest/services → catalogue avec Zonage
    //        .../Zonage_municipal/FeatureServer → layers avec Zonage
    const mockFetch = makeUrlMockFetch({
      "/arcgis/rest/services?f=json": ARCGIS_CATALOG_FIXTURE,
      "Zonage_municipal/FeatureServer?f=json": ARCGIS_FEATURESERVER_FIXTURE,
    });

    const report = await discoverArcgisServices(["brossard"], {
      fetchImpl: mockFetch,
      timeoutMs: 5000,
      now: () => new Date("2026-06-14T12:00:00Z"),
      domainGuesser: () => ["https://cartes.brossard.ca"],
    });

    expect(report.totalCities).toBe(1);
    expect(report.found).toBe(1);
    expect(report.results[0]?.status).toBe("found");
    expect(report.results[0]?.serviceUrl).toContain("FeatureServer");
  });

  it("statut not-found si aucun catalogue ArcGIS trouvé", async () => {
    const mockFetch = makeFailFetch(404);

    const report = await discoverArcgisServices(["saint-inconnu"], {
      fetchImpl: mockFetch,
      timeoutMs: 1000,
      now: () => new Date("2026-06-14T12:00:00Z"),
      domainGuesser: () => ["https://www.ville.saint-inconnu.qc.ca"],
    });

    expect(report.notFound).toBe(1);
    expect(report.results[0]?.status).toBe("not-found");
  });

  it("statut skipped pour une ville déjà dans le registre", async () => {
    const mockFetch = makeSuccessFetch(ARCGIS_CATALOG_FIXTURE);

    const report = await discoverArcgisServices(["longueuil"], {
      fetchImpl: mockFetch,
      timeoutMs: 5000,
      now: () => new Date("2026-06-14T12:00:00Z"),
      existingRegistry: [{ citySlug: "longueuil" }],
    });

    expect(report.skipped).toBe(1);
    expect(report.found).toBe(0);
    expect(report.results[0]?.status).toBe("skipped");
  });

  it("force=true rescanne une ville déjà dans le registre", async () => {
    const mockFetch = makeUrlMockFetch({
      "/arcgis/rest/services?f=json": ARCGIS_CATALOG_FIXTURE,
      "Zonage_municipal/FeatureServer?f=json": ARCGIS_FEATURESERVER_FIXTURE,
    });

    const report = await discoverArcgisServices(["longueuil"], {
      fetchImpl: mockFetch,
      timeoutMs: 5000,
      now: () => new Date("2026-06-14T12:00:00Z"),
      existingRegistry: [{ citySlug: "longueuil" }],
      force: true,
      domainGuesser: () => ["https://cartes.longueuil.ca"],
    });

    // Le registre existant n'arrête pas le scan avec force=true
    expect(report.skipped).toBe(0);
  });

  it("traite plusieurs villes avec statuts mixtes", async () => {
    const mockFetch = makeUrlMockFetch({
      "cartes.brossard.ca": ARCGIS_CATALOG_FIXTURE,
      "Zonage_municipal/FeatureServer?f=json": ARCGIS_FEATURESERVER_FIXTURE,
    });

    const report = await discoverArcgisServices(
      ["brossard", "saint-inconnu", "longueuil"],
      {
        fetchImpl: mockFetch,
        timeoutMs: 2000,
        now: () => new Date("2026-06-14T12:00:00Z"),
        existingRegistry: [{ citySlug: "longueuil" }],
        domainGuesser: (slug) =>
          slug === "brossard"
            ? ["https://cartes.brossard.ca"]
            : ["https://ville.saint-inconnu.qc.ca"],
      },
    );

    expect(report.totalCities).toBe(3);
    expect(report.skipped).toBe(1); // longueuil
    // brossard et saint-inconnu sont sondés
    expect(report.found + report.notFound).toBe(2);
  });
});

// ─── Tests formatDiscoveryReport ──────────────────────────────────────────

describe("formatDiscoveryReport", () => {
  it("formate un rapport avec des entrées de différents statuts", () => {
    const report = {
      version: ARCGIS_DISCOVERY_VERSION,
      generatedAt: "2026-06-14T12:00:00Z",
      totalCities: 3,
      found: 1,
      notFound: 1,
      errors: 0,
      skipped: 1,
      results: [
        {
          citySlug: "brossard",
          status: "found" as const,
          serviceUrl: "https://cartes.brossard.ca/arcgis/rest/services/Zonage/FeatureServer/0",
          serviceName: "Urbanisme/Zonage_municipal",
          probedUrls: ["https://cartes.brossard.ca/arcgis/rest/services"],
          detectedAt: "2026-06-14T12:00:00Z",
        },
        {
          citySlug: "saint-inconnu",
          status: "not-found" as const,
          probedUrls: ["https://ville.saint-inconnu.qc.ca/arcgis/rest/services"],
          detectedAt: "2026-06-14T12:00:00Z",
        },
        {
          citySlug: "longueuil",
          status: "skipped" as const,
          probedUrls: [],
          detectedAt: "2026-06-14T12:00:00Z",
        },
      ],
    };

    const text = formatDiscoveryReport(report);
    expect(text).toContain("FOUND");
    expect(text).toContain("brossard");
    expect(text).toContain("MISS");
    expect(text).toContain("saint-inconnu");
    expect(text).toContain("SKIP");
    expect(text).toContain("longueuil");
    expect(text).toContain("3 villes");
  });
});

// ─── Tests reportToRegistryEntries ────────────────────────────────────────

describe("reportToRegistryEntries", () => {
  it("convertit les résultats found en entrées de registre", () => {
    const report = {
      version: ARCGIS_DISCOVERY_VERSION,
      generatedAt: "2026-06-14T12:00:00Z",
      totalCities: 2,
      found: 1,
      notFound: 1,
      errors: 0,
      skipped: 0,
      results: [
        {
          citySlug: "brossard",
          status: "found" as const,
          serviceUrl: "https://cartes.brossard.ca/arcgis/rest/services/Zonage/FeatureServer/0",
          serviceName: "Urbanisme/Zonage_municipal",
          probedUrls: [],
          detectedAt: "2026-06-14T12:00:00Z",
        },
        {
          citySlug: "saint-inconnu",
          status: "not-found" as const,
          probedUrls: [],
          detectedAt: "2026-06-14T12:00:00Z",
        },
      ],
    };

    const entries = reportToRegistryEntries(report);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.citySlug).toBe("brossard");
    expect(entries[0]?.serviceUrl).toContain("FeatureServer/0");
    expect(entries[0]?.zoneCodeField).toBeNull();
    expect(entries[0]?.verifiedAt).toBe("2026-06-14");
    expect(entries[0]?.notes).toContain("recensement automatisé");
  });

  it("retourne un tableau vide si aucun résultat found", () => {
    const report = {
      version: ARCGIS_DISCOVERY_VERSION,
      generatedAt: "2026-06-14T12:00:00Z",
      totalCities: 1,
      found: 0,
      notFound: 1,
      errors: 0,
      skipped: 0,
      results: [
        {
          citySlug: "saint-inconnu",
          status: "not-found" as const,
          probedUrls: [],
          detectedAt: "2026-06-14T12:00:00Z",
        },
      ],
    };
    expect(reportToRegistryEntries(report)).toHaveLength(0);
  });
});

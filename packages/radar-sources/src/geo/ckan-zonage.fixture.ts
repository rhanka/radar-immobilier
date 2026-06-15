/**
 * Fixtures pour les tests du CkanZonageAdapter (P1-A).
 *
 * Données capturées live depuis l'API CKAN Données Québec (2026-06-14).
 * Ces fixtures sont STATIQUES et n'appellent jamais le réseau en CI.
 *
 * Sources vérifiées :
 *   - Longueuil : www.donneesquebec.ca/recherche/dataset/aedd53ac-.../zonage.json
 *     HTTP 200, 2085 features, champs : Zonage, URL_Grille
 *   - Saguenay  : www.donneesquebec.ca/recherche/dataset/a086941f-.../sag_zonage.geojson
 *     HTTP 200, 2838 features, champs : id, municipalite, no_zone
 */

// ─── Longueuil CKAN ─────────────────────────────────────────────────────

/** Package ID CKAN Longueuil Zonage. */
export const LONGUEUIL_CKAN_PACKAGE_ID = "aedd53ac-131d-4141-93c4-8d4211eb2d95";

/** URL directe de la ressource GeoJSON Longueuil (vérifiée live 2026-06-14). */
export const LONGUEUIL_CKAN_GEOJSON_URL =
  "https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/fafe8962-b38d-4a98-ad93-25ac8950b8c8/download/zonage.json";

/**
 * Réponse simulée de package_show pour Longueuil.
 * Capturée depuis l'API CKAN (2026-06-14).
 */
export const LONGUEUIL_CKAN_PACKAGE_FIXTURE = {
  success: true,
  result: {
    id: "aedd53ac-131d-4141-93c4-8d4211eb2d95",
    name: "zonage",
    title: "Zonage",
    license_id: "cc-by",
    notes:
      "Les limites de zonage municipal de la Ville de Longueuil sont utilisees pour des fins de gestion des reglements d'urbanisme.",
    organization: {
      id: "856b172f-18c3-4a5b-a2bc-ecdccae651d3",
      name: "ville-de-longueuil",
      title: "Ville de Longueuil",
      is_organization: true,
      state: "active",
    },
    resources: [
      {
        id: "fafe8962-b38d-4a98-ad93-25ac8950b8c8",
        name: "Zonage",
        format: "GeoJSON",
        url: "https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/fafe8962-b38d-4a98-ad93-25ac8950b8c8/download/zonage.json",
        last_modified: "2024-03-01T15:44:16.259620",
        mimetype: "application/json",
      },
      {
        id: "5bffde75-9e94-4282-8158-ec2dce8fefa6",
        name: "Zonage",
        format: "SHP",
        url: "https://www.donneesquebec.ca/recherche/dataset/aedd53ac-131d-4141-93c4-8d4211eb2d95/resource/5bffde75-9e94-4282-8158-ec2dce8fefa6/download/zonage.zip",
        last_modified: "2024-03-01T15:44:16.259620",
        mimetype: "application/zip",
      },
    ],
  },
};

/**
 * Réponse simulée de package_search pour le terme "zonage" (extrait, 2 résultats).
 */
export const CKAN_SEARCH_ZONAGE_FIXTURE = {
  success: true,
  result: {
    count: 50,
    results: [
      LONGUEUIL_CKAN_PACKAGE_FIXTURE.result,
      {
        id: "a086941f-22e3-4fe7-a8dc-fe791229d942",
        name: "zonage-saguenay",
        title: "Zonage",
        license_id: "cc-by",
        organization: {
          id: "org-saguenay",
          name: "ville-de-saguenay",
          title: "Ville de Saguenay",
          is_organization: true,
          state: "active",
        },
        resources: [
          {
            id: "6d5e4aa8-1b9f-4deb-8815-4803ce63007f",
            name: "Zonage",
            format: "GeoJSON",
            url: "https://www.donneesquebec.ca/recherche/dataset/a086941f-22e3-4fe7-a8dc-fe791229d942/resource/6d5e4aa8-1b9f-4deb-8815-4803ce63007f/download/sag_zonage.geojson",
            last_modified: "2024-01-15T10:00:00.000000",
            mimetype: "application/json",
          },
        ],
      },
    ],
  },
};

/**
 * 3 features de zonage Longueuil (capturées live 2026-06-14).
 * Champ zone : "Zonage" = "P22-328 (VLO)".
 * Champ grille : "URL_Grille" = URL PDF.
 */
export const LONGUEUIL_CKAN_GEOJSON_FIXTURE = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: {
        Zonage: "P22-328 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/P22-328.pdf",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.502, 45.531],
            [-73.501, 45.531],
            [-73.501, 45.532],
            [-73.502, 45.532],
            [-73.502, 45.531],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        Zonage: "H22-101 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/H22-101.pdf",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.503, 45.531],
            [-73.502, 45.531],
            [-73.502, 45.532],
            [-73.503, 45.532],
            [-73.503, 45.531],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        Zonage: "C22-202 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/C22-202.pdf",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.504, 45.531],
            [-73.503, 45.531],
            [-73.503, 45.533],
            [-73.504, 45.533],
            [-73.504, 45.531],
          ],
        ],
      },
    },
  ],
};

// ─── Saguenay CKAN ──────────────────────────────────────────────────────

/** Package ID CKAN Saguenay Zonage. */
export const SAGUENAY_CKAN_PACKAGE_ID = "a086941f-22e3-4fe7-a8dc-fe791229d942";

/** URL directe de la ressource GeoJSON Saguenay (vérifiée live 2026-06-14). */
export const SAGUENAY_CKAN_GEOJSON_URL =
  "https://www.donneesquebec.ca/recherche/dataset/a086941f-22e3-4fe7-a8dc-fe791229d942/resource/6d5e4aa8-1b9f-4deb-8815-4803ce63007f/download/sag_zonage.geojson";

/**
 * 3 features de zonage Saguenay (capturées live 2026-06-14).
 * Champ zone : "no_zone" = "1000". Champ MAMH : "municipalite" = "94068".
 */
export const SAGUENAY_CKAN_GEOJSON_FIXTURE = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: {
        id: 2472,
        municipalite: "94068",
        no_zone: "1000",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.064, 48.421],
            [-71.063, 48.421],
            [-71.063, 48.422],
            [-71.064, 48.422],
            [-71.064, 48.421],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        id: 2473,
        municipalite: "94068",
        no_zone: "2000",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.065, 48.421],
            [-71.064, 48.421],
            [-71.064, 48.422],
            [-71.065, 48.422],
            [-71.065, 48.421],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        id: 2474,
        municipalite: "94068",
        no_zone: "3100",
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.066, 48.421],
            [-71.065, 48.421],
            [-71.065, 48.422],
            [-71.066, 48.422],
            [-71.066, 48.421],
          ],
        ],
      },
    },
  ],
};

// ─── Dataset avec EsriREST (Sherbrooke via CKAN) ──────────────────────

/**
 * Fixture package CKAN Sherbrooke (format EsriREST -> pointe vers ArcGIS).
 * Représente le cas où le dataset CKAN référence un FeatureServer ArcGIS.
 */
export const SHERBROOKE_CKAN_PACKAGE_FIXTURE = {
  success: true,
  result: {
    id: "sherbrooke-zonage-ckan",
    name: "zonage-sherbrooke",
    title: "Zonage",
    license_id: "cc-by",
    organization: {
      id: "org-sherbrooke",
      name: "ville-de-sherbrooke-donnees-geomatiques",
      title: "Ville de Sherbrooke",
      is_organization: true,
      state: "active",
    },
    resources: [
      {
        id: "res-sherbrooke-esrirest",
        name: "Service REST ArcGIS",
        format: "EsriREST",
        url: "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer/0",
        last_modified: null,
        mimetype: null,
      },
      {
        id: "res-sherbrooke-geojson",
        name: "Zonage GeoJSON",
        format: "GeoJSON",
        url: "https://donneesouvertes-sherbrooke.opendata.arcgis.com/api/download/v1/items/ae984df25d12471f/GeoJSON/output",
        last_modified: null,
        mimetype: null,
      },
    ],
  },
};

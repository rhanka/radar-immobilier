/**
 * Fixtures pour les tests du CadastreAllegeAdapter.
 *
 * Données capturées live depuis l'API MELCC/MRNF (2026-06-14).
 * Ces données sont STATIQUES et n'appellent jamais le réseau en CI.
 *
 * Source : https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0
 *
 * Champs : NO_LOT (string), OBJECTID (OID), SHAPE (geometry)
 * Vérification : 4 642 815 lots province-entière, maxRecordCount=2000
 */

/**
 * 3 lots réels de Delson (bbox: -73.56, 45.36, -73.53, 45.38).
 * Capturés live 2026-06-14 avec resultRecordCount=5.
 * NO_LOT contient des espaces (ex. "6 057 912") — fidèle à la source.
 */
export const CADASTRE_DELSON_FIXTURE_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { NO_LOT: "6 057 912", OBJECTID: 21621 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.543, 45.371],
            [-73.542, 45.371],
            [-73.542, 45.372],
            [-73.543, 45.372],
            [-73.543, 45.371],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: { NO_LOT: "2 095 168", OBJECTID: 28449 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.544, 45.368],
            [-73.543, 45.368],
            [-73.543, 45.369],
            [-73.544, 45.369],
            [-73.544, 45.368],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: { NO_LOT: "4 138 886", OBJECTID: 94088 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.545, 45.370],
            [-73.544, 45.370],
            [-73.544, 45.371],
            [-73.545, 45.371],
            [-73.545, 45.370],
          ],
        ],
      },
    },
  ],
};

/**
 * GeoJSON page simulant une réponse paginée avec exceededTransferLimit=true.
 * Utilisé pour tester le comportement de pagination.
 */
export const CADASTRE_PAGE1_FIXTURE = {
  type: "FeatureCollection" as const,
  exceededTransferLimit: true,
  features: [
    {
      type: "Feature" as const,
      properties: { NO_LOT: "1 000 001", OBJECTID: 1 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.6, 45.4],
            [-73.59, 45.4],
            [-73.59, 45.41],
            [-73.6, 45.41],
            [-73.6, 45.4],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: { NO_LOT: "1 000 002", OBJECTID: 2 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.59, 45.4],
            [-73.58, 45.4],
            [-73.58, 45.41],
            [-73.59, 45.41],
            [-73.59, 45.4],
          ],
        ],
      },
    },
  ],
};

export const CADASTRE_PAGE2_FIXTURE = {
  type: "FeatureCollection" as const,
  exceededTransferLimit: false,
  features: [
    {
      type: "Feature" as const,
      properties: { NO_LOT: "1 000 003", OBJECTID: 3 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-73.58, 45.4],
            [-73.57, 45.4],
            [-73.57, 45.41],
            [-73.58, 45.41],
            [-73.58, 45.4],
          ],
        ],
      },
    },
  ],
};

/** Métadonnées de la couche (réponse à ?f=json). Captées live 2026-06-14. */
export const CADASTRE_LAYER_INFO_FIXTURE = {
  name: "Lots du cadastre rénové",
  type: "Feature Layer",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
  supportedQueryFormats: "JSON, geoJSON, PBF",
  fields: [
    {
      name: "NO_LOT",
      type: "esriFieldTypeString",
      alias: "Numéro de lot",
      length: 10,
      domain: null,
    },
    {
      name: "SHAPE",
      type: "esriFieldTypeGeometry",
      alias: "Géométrie",
      domain: null,
    },
    {
      name: "OBJECTID",
      type: "esriFieldTypeOID",
      alias: "Clé interne",
      domain: null,
    },
  ],
};

/** Bbox de test pour Delson (WGS84). */
export const DELSON_BBOX = {
  minLon: -73.56,
  minLat: 45.36,
  maxLon: -73.53,
  maxLat: 45.38,
} as const;

/** Bbox de test pour Sainte-Catherine (WGS84). */
export const SAINTE_CATHERINE_BBOX = {
  minLon: -73.60,
  minLat: 45.38,
  maxLon: -73.56,
  maxLat: 45.42,
} as const;

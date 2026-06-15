/**
 * Fixtures pour les tests du ArcgisZonageAdapter.
 *
 * Données capturées live depuis des services ArcGIS REST publics QC (2026-06-14).
 * Ces fixtures sont STATIQUES et n'appellent jamais le réseau en CI.
 *
 * Sources vérifiées :
 *   - Longueuil : services2.arcgis.com/h4XWvDXfYYyD6jNu/.../DO_Zonage/FeatureServer/0
 *   - Shawinigan : cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0
 *   - Sherbrooke : services3.arcgis.com/qsNXG7LzoUbR4c1C/.../Zonage/FeatureServer/0
 */

// ─── Longueuil ─────────────────────────────────────────────────────────────

/** URL du service ArcGIS REST de Longueuil (vérifié live 2026-06-14). */
export const LONGUEUIL_SERVICE_URL =
  "https://services2.arcgis.com/h4XWvDXfYYyD6jNu/arcgis/rest/services/DO_Zonage/FeatureServer/0";

/**
 * Métadonnées de la couche Longueuil DO_Zonage (réponse à ?f=json).
 * Captées live 2026-06-14. Champ zone = "Zonage".
 */
export const LONGUEUIL_LAYER_INFO_FIXTURE = {
  name: "Zonage",
  type: "Feature Layer",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
  supportedQueryFormats: "JSON, geoJSON, PBF",
  fields: [
    {
      name: "Zonage",
      type: "esriFieldTypeString",
      alias: "Zonage",
      length: 200,
    },
    {
      name: "URL_Grille",
      type: "esriFieldTypeString",
      alias: "Grille d'usage",
      length: 200,
    },
    {
      name: "OBJECTID",
      type: "esriFieldTypeOID",
      alias: "OBJECTID",
    },
    {
      name: "SHAPE__Area",
      type: "esriFieldTypeDouble",
      alias: "Superficie (m²)",
    },
    {
      name: "SHAPE__Length",
      type: "esriFieldTypeDouble",
      alias: "Périmètre",
    },
  ],
};

/**
 * 3 features de zonage Longueuil (capturés live 2026-06-14).
 * Champ zone : "Zonage" = "H34-327 (VLO)".
 */
export const LONGUEUIL_ZONAGE_FIXTURE = {
  type: "FeatureCollection" as const,
  exceededTransferLimit: false,
  features: [
    {
      type: "Feature" as const,
      properties: {
        Zonage: "H34-327 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/H34-327.pdf",
        OBJECTID: 1,
        SHAPE__Area: 2500.0,
        SHAPE__Length: 200.0,
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
        Zonage: "H34-141 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/H34-141.pdf",
        OBJECTID: 2,
        SHAPE__Area: 1800.0,
        SHAPE__Length: 170.0,
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
        Zonage: "P34-191 (VLO)",
        URL_Grille:
          "https://gociteweb.longueuil.quebec/hotlink/Logo/Zonage/VLO/P34-191.pdf",
        OBJECTID: 3,
        SHAPE__Area: 5000.0,
        SHAPE__Length: 280.0,
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

// ─── Shawinigan ────────────────────────────────────────────────────────────

/** URL du service ArcGIS REST de Shawinigan (vérifié live 2026-06-14, source DQ CKAN). */
export const SHAWINIGAN_SERVICE_URL =
  "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0";

/**
 * Métadonnées de la couche Shawinigan (réponse à ?f=json).
 * Champ zone = "zone_", champ usage = "usage_".
 */
export const SHAWINIGAN_LAYER_INFO_FIXTURE = {
  name: "Zonage (après 2011)",
  type: "Feature Layer",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
  supportedQueryFormats: "JSON, geoJSON, PBF",
  fields: [
    {
      name: "objectid",
      type: "esriFieldTypeOID",
      alias: "OBJECTID",
    },
    {
      name: "usage_",
      type: "esriFieldTypeString",
      alias: "Usage_",
      length: 5,
    },
    {
      name: "zone_",
      type: "esriFieldTypeString",
      alias: "Zone_",
      length: 10,
    },
    {
      name: "nb_logements",
      type: "esriFieldTypeSmallInteger",
      alias: "nb_logements",
    },
    {
      name: "nb_etages",
      type: "esriFieldTypeSmallInteger",
      alias: "nb_etages",
    },
  ],
};

/**
 * 3 features de zonage Shawinigan (capturés live 2026-06-14).
 * Champ zone : "zone_" = "H-9509". Champ usage : "usage_" = "H".
 * Note : OID = "objectid" (minuscule) sur ce service.
 */
export const SHAWINIGAN_ZONAGE_FIXTURE = {
  type: "FeatureCollection" as const,
  exceededTransferLimit: false,
  features: [
    {
      type: "Feature" as const,
      properties: {
        objectid: 1,
        usage_: "H",
        zone_: "H-9509",
        nb_logements: null,
        nb_etages: null,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-72.741, 46.558],
            [-72.740, 46.558],
            [-72.740, 46.559],
            [-72.741, 46.559],
            [-72.741, 46.558],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        objectid: 2,
        usage_: "H",
        zone_: "H-9506",
        nb_logements: null,
        nb_etages: null,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-72.742, 46.558],
            [-72.741, 46.558],
            [-72.741, 46.559],
            [-72.742, 46.559],
            [-72.742, 46.558],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        objectid: 3,
        usage_: "H",
        zone_: "H-9503",
        nb_logements: null,
        nb_etages: null,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-72.743, 46.558],
            [-72.742, 46.558],
            [-72.742, 46.559],
            [-72.743, 46.559],
            [-72.743, 46.558],
          ],
        ],
      },
    },
  ],
};

// ─── Sherbrooke ────────────────────────────────────────────────────────────

/** URL du service ArcGIS REST de Sherbrooke (vérifié live 2026-06-14, source DQ CKAN). */
export const SHERBROOKE_SERVICE_URL =
  "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer/0";

/**
 * Métadonnées de la couche Sherbrooke (réponse à ?f=json).
 * Champ zone = "NO_ZONE", champ grille = "GRILLEUSAGE".
 */
export const SHERBROOKE_LAYER_INFO_FIXTURE = {
  name: "zonage",
  type: "Feature Layer",
  geometryType: "esriGeometryPolygon",
  maxRecordCount: 2000,
  supportedQueryFormats: "JSON, geoJSON, PBF",
  fields: [
    {
      name: "ID",
      type: "esriFieldTypeSmallInteger",
      alias: "ID",
    },
    {
      name: "MUNICIPALITE",
      type: "esriFieldTypeString",
      alias: "MUNICIPALITE",
      length: 10,
    },
    {
      name: "NO_ZONE",
      type: "esriFieldTypeString",
      alias: "NO_ZONE",
      length: 25,
    },
    {
      name: "GRILLEUSAGE",
      type: "esriFieldTypeString",
      alias: "GRILLEUSAGE",
      length: 200,
    },
    {
      name: "OBJECTID",
      type: "esriFieldTypeOID",
      alias: "OBJECTID",
    },
  ],
};

/**
 * 3 features de zonage Sherbrooke (capturés live 2026-06-14).
 * Champ zone : "NO_ZONE" = "A1336". Champ grille usage = URL.
 */
export const SHERBROOKE_ZONAGE_FIXTURE = {
  type: "FeatureCollection" as const,
  exceededTransferLimit: false,
  features: [
    {
      type: "Feature" as const,
      properties: {
        ID: 1,
        MUNICIPALITE: "43027",
        NO_ZONE: "A1336",
        GRILLEUSAGE:
          "https://cartes.ville.sherbrooke.qc.ca/GrilleUsage/?zoneid=A1336",
        OBJECTID: 1,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.889, 45.399],
            [-71.888, 45.399],
            [-71.888, 45.400],
            [-71.889, 45.400],
            [-71.889, 45.399],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        ID: 2,
        MUNICIPALITE: "43027",
        NO_ZONE: "A1301",
        GRILLEUSAGE:
          "https://cartes.ville.sherbrooke.qc.ca/GrilleUsage/?zoneid=A1301",
        OBJECTID: 2,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.890, 45.399],
            [-71.889, 45.399],
            [-71.889, 45.400],
            [-71.890, 45.400],
            [-71.890, 45.399],
          ],
        ],
      },
    },
    {
      type: "Feature" as const,
      properties: {
        ID: 3,
        MUNICIPALITE: "43027",
        NO_ZONE: "RU1302",
        GRILLEUSAGE:
          "https://cartes.ville.sherbrooke.qc.ca/GrilleUsage/?zoneid=RU1302",
        OBJECTID: 3,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.891, 45.399],
            [-71.890, 45.399],
            [-71.890, 45.400],
            [-71.891, 45.400],
            [-71.891, 45.399],
          ],
        ],
      },
    },
  ],
};

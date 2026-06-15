/**
 * Registre des services ArcGIS REST de zonage par ville QC (T1 — P0-B).
 *
 * Chaque entrée représente une ville pour laquelle un service ArcGIS REST
 * de zonage municipal a été vérifié (URL valide, polygones + code zone, sans auth).
 *
 * ## Protocole anti-invention
 * - Seules les entrées VÉRIFIÉES live (curl HTTP 200, GeoJSON retourné) sont listées.
 * - Date de vérification portée dans `verifiedAt`.
 * - Le champ `zoneCodeField` est null si la détection automatique suffit
 *   (voir `detectZoneCodeField()` dans arcgis-zonage.ts).
 *
 * ## Backlog
 * Ce registre est le point d'entrée du recensement S3.
 * L'objectif S3 est de peupler ~150-250 entrées via sondage automatisé.
 * Les villes ci-dessous sont le seed initial (vérification manuelle P0).
 *
 * ## Types différés (T3/T4/T5)
 * - T3 JMap : non dans ce registre (API propriétaire, chantier S4).
 * - T4 GOnet/Azimut : non dans ce registre (auth requis, chantier S4).
 * - T5 PDF scannés (~600-800 villes) : backlog planifié, pas ici.
 *   Le principal confirme qu'on finira par les numériser (OCR + éditeur).
 *
 * ## Extension
 * Ajouter une entrée = ajouter un objet `ArcgisServiceEntry`.
 * Le recensement S3 écrira dans ce fichier via script idempotent.
 */

/** Entrée du registre pour un service ArcGIS REST de zonage. */
export interface ArcgisServiceEntry {
  /** City slug (clé de jointure avec QC_MUNICIPALITIES). */
  readonly citySlug: string;
  /** URL complète de la couche ArcGIS REST (FeatureServer/N ou MapServer/N). */
  readonly serviceUrl: string;
  /**
   * Champ portant le code de zone.
   * `null` = détection automatique par `detectZoneCodeField()`.
   */
  readonly zoneCodeField: string | null;
  /** Date de vérification live (ISO 8601). */
  readonly verifiedAt: string;
  /** Notes libres (caveats, source de l'URL, etc.). */
  readonly notes?: string;
}

/**
 * Registre des services ArcGIS REST de zonage vérifiés.
 *
 * Villes vérifiées live (2026-06-14) :
 *   - Longueuil  : 3 features query OK, champ "Zonage", géométrie Polygon ✓
 *   - Shawinigan : 3 features query OK, champ "zone_", géométrie Polygon ✓
 *   - Sherbrooke : 3 features query OK, champ "NO_ZONE", géométrie Polygon ✓
 *
 * Sources de découverte :
 *   - Longueuil  : ArcGIS Online Hub (AGOL) search "longueuil zonage"
 *   - Shawinigan : Données Québec CKAN (dataset "Plan de zonage - Ville de Shawinigan")
 *   - Sherbrooke : Données Québec CKAN (dataset "Zonage") — format EsriREST + GeoJSON
 */
export const ARCGIS_SERVICE_REGISTRY: readonly ArcgisServiceEntry[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Longueuil — vérifié live 2026-06-14
  // Source : ArcGIS Online Hub
  // Champ zone : "Zonage" (ex. "H34-327 (VLO)")
  // Champ grille : "URL_Grille" → PDF de la grille d'usage
  // ─────────────────────────────────────────────────────────────────────────
  {
    citySlug: "longueuil",
    serviceUrl:
      "https://services2.arcgis.com/h4XWvDXfYYyD6jNu/arcgis/rest/services/DO_Zonage/FeatureServer/0",
    zoneCodeField: "Zonage",
    verifiedAt: "2026-06-14",
    notes:
      "AGOL Hub. Champ 'URL_Grille' = lien PDF grille d'usage par zone. " +
      "Query live 3 features HTTP 200. geometryType=esriGeometryPolygon. " +
      "maxRecordCount=2000.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Shawinigan — vérifié live 2026-06-14
  // Source : Données Québec CKAN (dataset "Plan de zonage - Ville de Shawinigan")
  // URL DQ : https://www.donneesquebec.ca/recherche/dataset/... (format GeoJSON direct)
  // Champ zone : "zone_" (ex. "H-9509"), champ usage : "usage_" (ex. "H")
  // Note : OID = "objectid" (minuscule, inhabituel)
  // ─────────────────────────────────────────────────────────────────────────
  {
    citySlug: "shawinigan",
    serviceUrl:
      "https://cartes.shawinigan.ca/server/rest/services/Zonage_municipal/FeatureServer/0",
    zoneCodeField: "zone_",
    verifiedAt: "2026-06-14",
    notes:
      "Données Québec CKAN (ressource GeoJSON directe pointant le FeatureServer). " +
      "Champ OID = 'objectid' (minuscule, détecté automatiquement). " +
      "Query live 3 features HTTP 200. geometryType=esriGeometryPolygon.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Sherbrooke — vérifié live 2026-06-14
  // Source : Données Québec CKAN (dataset "Zonage") — format EsriREST
  // Champ zone : "NO_ZONE" (ex. "A1336", "RU1302")
  // Champ grille : "GRILLEUSAGE" → URL grille d'usage Sherbrooke
  // ─────────────────────────────────────────────────────────────────────────
  {
    citySlug: "sherbrooke",
    serviceUrl:
      "https://services3.arcgis.com/qsNXG7LzoUbR4c1C/arcgis/rest/services/Zonage/FeatureServer/0",
    zoneCodeField: "NO_ZONE",
    verifiedAt: "2026-06-14",
    notes:
      "Données Québec CKAN (format EsriREST). Champ 'GRILLEUSAGE' = URL grille d'usage. " +
      "Champ 'MUNICIPALITE' = code MAMH (ex. '43027'). " +
      "Query live 3 features HTTP 200. geometryType=esriGeometryPolygon.",
  },
];

/**
 * Retourne l'entrée du registre pour une ville donnée (par slug).
 * Retourne `undefined` si la ville n'est pas dans le registre.
 */
export function getArcgisServiceEntry(
  citySlug: string,
): ArcgisServiceEntry | undefined {
  return ARCGIS_SERVICE_REGISTRY.find((e) => e.citySlug === citySlug);
}

/**
 * Retourne tous les slugs de villes ayant un service ArcGIS vérifié.
 */
export function listVerifiedArcgisCities(): readonly string[] {
  return ARCGIS_SERVICE_REGISTRY.map((e) => e.citySlug);
}

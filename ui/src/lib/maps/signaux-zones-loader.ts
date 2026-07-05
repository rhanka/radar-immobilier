/**
 * signaux-zones-loader — résolution TIERÉE de la couche zonage de la vue Signaux.
 *
 * Bug corrigé (Salaberry-de-Valleyfield) : la vue Signaux n'interrogeait QUE
 * l'endpoint de résolution `/api/geo/:citySlug/zones`. Quand cet endpoint ne
 * connaît pas la ville (registre de résolution restreint), la vue basculait en
 * fallback « contour ville » ALORS QUE geo sert déjà la collection OGC
 * `qc-zonage-<slug>` via le passthrough `/api/geo/collections/...`
 * (ex. 645 zones réelles pour salaberry-de-valleyfield).
 *
 * Ordre de résolution (du plus riche au plus pauvre) :
 *   1. endpoint `/api/geo/:citySlug/zones` (fallback=lots) — porte le join
 *      zone→lots (projection « inherited » des signaux) quand configuré ;
 *   2. collection OGC `qc-zonage-<slug>` (passthrough) — vraies géométries de
 *      zonage (aplats + codes), sans join lots ;
 *   3. rien — l'appelant applique le fallback contour ville
 *      (`withCityFallbackZone`), désormais réservé au cas où la collection est
 *      VRAIMENT absente.
 *
 * Anti-course : le `signal` de l'appelant est propagé aux deux clients
 * (fetch-with-timeout) ; une réponse périmée est avortée, jamais peinte.
 */

import {
  fetchGeoZones,
  type GeoZoneFeature,
  type GeoZonesResponse,
} from "./geo-zones-client.js";
import { fetchZones, type ZonesResponse } from "./zones-client.js";

/**
 * Limite de chargement de la collection OGC zonage. Dimensionnée pour couvrir
 * les plus grosses villes connues (Longueuil ≈ 2085 zones, Salaberry 645) sans
 * pagination ; MapLibre rend cet ordre de grandeur sans souci (mesuré côté
 * vue Évaluation).
 */
export const ZONES_COLLECTION_LIMIT = 3000;

/** Limite historique de l'endpoint de résolution (inchangée). */
export const ZONES_ENDPOINT_LIMIT = 500;

/** Réponse « endpoint non configuré » (miroir de l'ancien chemin 404 de la vue). */
export function emptyUnconfiguredZones(citySlug: string): GeoZonesResponse {
  return {
    ok: false,
    citySlug,
    source: "none",
    resolutionStatus: "missing",
    geometryStatus: "missing",
    zoneCount: 0,
    warnings: ["geo-collection-not-configured"],
    featureCollection: { type: "FeatureCollection", features: [] },
  };
}

/**
 * Adapte une collection OGC de zonage (`ZonesResponse`, zones-client) vers la
 * forme `GeoZonesResponse` consommée par la vue Signaux (carte + panneau).
 *
 * - géométrie présente → `geometryStatus: "official"` (vraie géométrie de
 *   zonage vectorielle), confiance 1 ;
 * - géométrie absente → `"missing"`, confiance 0 (aucune invention) ;
 * - pas de join lots dans la collection → `lotCount: 0`, `lots: []` (la
 *   projection « inherited » des signaux reste portée par l'endpoint quand il
 *   est configuré).
 */
export function geoZonesResponseFromCollection(
  collection: ZonesResponse,
): GeoZonesResponse {
  const features: GeoZoneFeature[] = collection.featureCollection.features.map(
    (feature) => ({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        code: feature.properties.code,
        citySlug: feature.properties.citySlug ?? collection.citySlug,
        geometryStatus: feature.geometry ? "official" : "missing",
        confidence: feature.geometry ? 1 : 0,
        source: "official-zone",
        lotCount: 0,
        lots: [],
        // kind/affectation/grille transmis TELS QUELS quand la collection les
        // expose — la teinte par famille (zone-kind-style, affectation en
        // priorité) et la fiche zone les consomment.
        ...(feature.properties.kind ? { kind: feature.properties.kind } : {}),
        ...(feature.properties.affectation
          ? { affectation: feature.properties.affectation }
          : {}),
        ...(feature.properties.grillePdfUrl
          ? { grillePdfUrl: feature.properties.grillePdfUrl }
          : {}),
        // Label lisible : le libellé d'affectation prime sur le code kind
        // ("CO-939 — Conservation" plutôt que "CO-939 — CO").
        ...(feature.properties.affectation || feature.properties.kind
          ? {
              label: `${feature.properties.code} — ${
                feature.properties.affectation ?? feature.properties.kind
              }`,
            }
          : {}),
      },
    }),
  );
  const hasGeometry = features.some((feature) => feature.geometry !== null);
  return {
    ok: true,
    citySlug: collection.citySlug,
    source: "official",
    resolutionStatus: "official",
    geometryStatus: hasGeometry ? "official" : "missing",
    zoneCount: features.length,
    warnings: [],
    featureCollection: { type: "FeatureCollection", features },
  };
}

/** Provenance de la couche zonage retenue. */
export type SignauxZonesTier = "endpoint" | "collection" | "none";

export interface SignauxZonesLoad {
  /**
   * Couche zonage retenue.
   * - tier "endpoint" / "collection" : réponse avec de VRAIES zones.
   * - tier "none" : réponse endpoint vide (l'appelant applique le fallback
   *   contour ville), ou `null` si l'endpoint lui-même est non configuré
   *   (404) — miroir exact des deux anciens chemins de la vue.
   */
  response: GeoZonesResponse | null;
  tier: SignauxZonesTier;
}

export interface LoadSignauxZonesOptions {
  /** Signal d'annulation externe (anti-course au changement de ville). */
  signal?: AbortSignal;
  endpointLimit?: number;
  collectionLimit?: number;
  /** Clients injectables (tests) — défaut : clients réels. */
  fetchResolvedZones?: typeof fetchGeoZones;
  fetchZonesCollection?: typeof fetchZones;
}

/**
 * Charge la couche zonage d'une ville pour la vue Signaux, en tiers.
 *
 * Erreurs : un 404 de l'endpoint N'EST PAS une erreur (on tente la collection) ;
 * un 404 de la collection non plus (`ok:false` du client → tier "none").
 * Toute autre erreur (réseau, timeout, abort) REMONTE telle quelle — l'appelant
 * la distingue via `isAbortError` et bascule la couche en état d'erreur.
 */
export async function loadSignauxZones(
  citySlug: string,
  opts: LoadSignauxZonesOptions = {},
): Promise<SignauxZonesLoad> {
  const fetchResolved = opts.fetchResolvedZones ?? fetchGeoZones;
  const fetchCollection = opts.fetchZonesCollection ?? fetchZones;

  // ── 1. Endpoint de résolution API (join zone→lots quand configuré) ─────────
  let resolved: GeoZonesResponse | null = null;
  try {
    resolved = await fetchResolved(citySlug, {
      fallback: "lots",
      limit: opts.endpointLimit ?? ZONES_ENDPOINT_LIMIT,
      signal: opts.signal,
    });
  } catch (err) {
    // 404 = ville inconnue de l'endpoint → PAS une erreur : on tente la
    // collection OGC. Toute autre erreur (réseau/timeout/abort) remonte.
    const message = err instanceof Error ? err.message : "";
    if (!message.includes("geo-zones HTTP 404")) throw err;
  }
  if (
    resolved &&
    resolved.zoneCount > 0 &&
    resolved.featureCollection.features.length > 0
  ) {
    return { response: resolved, tier: "endpoint" };
  }

  // ── 2. Collection OGC qc-zonage-<slug> (passthrough) ───────────────────────
  const collection = await fetchCollection(citySlug, {
    limit: opts.collectionLimit ?? ZONES_COLLECTION_LIMIT,
    signal: opts.signal,
  });
  if (collection.ok && collection.featureCollection.features.length > 0) {
    return {
      response: geoZonesResponseFromCollection(collection),
      tier: "collection",
    };
  }

  // ── 3. Vraiment rien : fallback contour ville à l'appelant ─────────────────
  return { response: resolved, tier: "none" };
}

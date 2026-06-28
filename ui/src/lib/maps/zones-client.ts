/**
 * Client for OGC zonage collections exposed at /api/geo/collections.
 *
 * Miroir de `lots-client.ts`, mais pour la couche ZONAGE : géométrie des
 * zones d'urbanisme (polygones) servie par geo via la collection OGC
 * `qc-zonage-<slug>/items` (cf. #92 part-2). La forme retournée est un
 * FeatureCollection GeoJSON identique à `qc-lots`.
 *
 * Chaque zone porte un `code` (ex. "H-431", "C-18") résolu de façon FLEXIBLE
 * car le nom exact du champ côté geo n'est pas encore figé : on essaie une
 * liste de candidats (`code`, `zoneCode`, `zone_code`, `ZONE`, `code_affiche`,
 * `codeAffiche`). Le `code` sert à l'appariement signal↔zone (join pur, voir
 * `matchZonesToSignal`) ; la géométrie ne sert qu'à colorier la carte.
 *
 * Robustesse (identique à lots-client) :
 *  - 404 (collection pas encore servie par geo) → { ok:false, features:[] },
 *    PAS de faux compteur à 0 ;
 *  - accepte aussi un corps "legacy" déjà au format ZonesResponse (mocks) ;
 *  - lève sur erreur réseau / HTTP non-2xx hors collection absente.
 *
 * Anti-PII (Loi 25) : on n'expose que des attributs publics de zonage
 * (code, kind, usages). Aucune donnée propriétaire.
 */

// Normalisation d'appariement partagée avec signaux-map-geo : importée plutôt
// que dupliquée pour garantir que la couche zonage et l'extracteur de refs de
// signal parlent EXACTEMENT le même langage de comparaison.
import { zoneRefComparableKey } from "./signaux-map-geo.js";

/** Properties d'une zone d'urbanisme (données publiques de zonage). */
export interface ZoneProperties {
  /** Code de zone normalisé d'affichage (ex. "H-431"). Source = candidats multiples. */
  code: string;
  /** Slug de la ville porteuse de la zone. */
  citySlug?: string;
  /**
   * Famille/catégorie de la zone quand l'API la fournit (ex. "habitation",
   * "commerce"). Candidats : kind, type, categorie, category. null si absent.
   */
  kind?: string | null;
  /**
   * Usages autorisés listés par l'API quand disponibles (tableau de chaînes).
   * Candidats : usages (array|csv), usage. undefined si absent.
   */
  usages?: string[];
  /**
   * Lien vers la grille de zonage PDF quand la collection l'expose (preuve).
   * Candidats hétérogènes : URL_Grille, LienGrille, Grille, URL_GRILLE, GRILLE_URL.
   * undefined si absent.
   */
  grillePdfUrl?: string;
}

export interface ZoneGeometry {
  type: string;
  coordinates: unknown;
}

export interface ZoneFeature {
  type: "Feature";
  geometry: ZoneGeometry | null;
  properties: ZoneProperties;
}

export interface ZoneFeatureCollection {
  type: "FeatureCollection";
  features: ZoneFeature[];
}

export interface ZonesResponse {
  ok: boolean;
  citySlug: string;
  source: "donnees-quebec" | "none";
  /** Raison de l'échec (ok=false seulement). */
  reason?: string;
  /** OGC collection id when loaded from the live geo API. */
  collectionId?: string;
  /** OGC total match count. May be greater than the loaded features length. */
  numberMatched?: number;
  /** OGC returned feature count for the current page. */
  numberReturned?: number;
  featureCollection: ZoneFeatureCollection;
}

export interface FetchZonesOptions {
  limit?: number;
  bbox?: [number, number, number, number];
  baseUrl?: string;
}

interface OgcFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
  numberMatched?: number;
  numberReturned?: number;
}

const EMPTY_ZONES: ZoneFeatureCollection = { type: "FeatureCollection", features: [] };

export function zonesCollectionId(citySlug: string): string {
  return `qc-zonage-${citySlug}`;
}

export function resolveZonesUrl(
  citySlug: string,
  opts: FetchZonesOptions = {},
): string {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const path = `/api/geo/collections/${encodeURIComponent(zonesCollectionId(citySlug))}/items`;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Charge la couche de zonage d'une ville depuis l'API OGC live.
 *
 * - Retourne le FeatureCollection quand ok=true.
 * - Retourne { ok:false, featureCollection:{features:[]} } quand aucune
 *   collection `qc-zonage-{citySlug}` n'existe — pas de faux compteur à 0.
 *   (Cas nominal tant que geo ne sert pas encore la collection : 404.)
 * - Lève en cas d'erreur réseau ou HTTP non-2xx hors collection absente.
 */
export async function fetchZones(
  citySlug: string,
  opts: FetchZonesOptions = {},
): Promise<ZonesResponse> {
  const url = resolveZonesUrl(citySlug, opts);
  const res = await fetch(url);
  const collectionId = zonesCollectionId(citySlug);
  if (res.status === 404) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `Collection zonage non configurée dans l'API geo : ${collectionId}`,
      collectionId,
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: EMPTY_ZONES,
    };
  }
  if (!res.ok) {
    throw new Error(`zones HTTP ${res.status} for ${citySlug}`);
  }
  const body = await res.json();
  if (isLegacyZonesResponse(body)) {
    return {
      ...body,
      collectionId: body.collectionId ?? collectionId,
      numberMatched: body.numberMatched ?? body.featureCollection.features.length,
      numberReturned: body.numberReturned ?? body.featureCollection.features.length,
    };
  }
  if (!isOgcFeatureCollection(body)) {
    throw new Error(`zones: réponse geo inattendue pour ${citySlug}`);
  }

  const features = body.features
    .map((feature) => normalizeOgcZoneFeature(feature, citySlug))
    .filter((feature): feature is ZoneFeature => feature !== null);
  return {
    ok: true,
    citySlug,
    source: "donnees-quebec",
    collectionId,
    numberMatched: body.numberMatched ?? features.length,
    numberReturned: body.numberReturned ?? features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
}

/**
 * JOIN pur signal↔zonage.
 *
 * Retourne les features de zone dont le code (normalisé : casse, espaces,
 * tirets) matche l'un des codes cités par un signal. La normalisation est
 * cohérente avec `signaux-map-geo` (`zoneRefComparableKey` : majuscule,
 * tiret demi-cadratin → ASCII, suffixe secteur retiré, espaces ET tirets
 * supprimés) — de sorte que "A16" (signal) ↔ "A-16" (zone) matchent, et que
 * les codes vides ne provoquent JAMAIS de faux-match.
 *
 * @param signalZoneCodes - codes cités par le signal (typiquement la sortie de
 *   `extractSignalZoneRefs`, déjà partiellement normalisée — re-normalisée ici
 *   pour être robuste à une entrée brute).
 * @param zoneFeatures    - features de zone (p.ex. `response.featureCollection.features`).
 */
export function matchZonesToSignal(
  signalZoneCodes: readonly string[],
  zoneFeatures: readonly ZoneFeature[],
): ZoneFeature[] {
  const wanted = new Set(
    signalZoneCodes
      .map((code) => zoneRefComparableKey(code))
      .filter((key) => key.length > 0),
  );
  if (wanted.size === 0) return [];
  return zoneFeatures.filter((feature) => {
    const key = zoneRefComparableKey(feature.properties.code);
    return key.length > 0 && wanted.has(key);
  });
}

function isLegacyZonesResponse(value: unknown): value is ZonesResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ZonesResponse>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.citySlug === "string" &&
    typeof candidate.source === "string" &&
    candidate.featureCollection?.type === "FeatureCollection" &&
    Array.isArray(candidate.featureCollection.features)
  );
}

function isOgcFeatureCollection(value: unknown): value is OgcFeatureCollection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OgcFeatureCollection>;
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
}

function normalizeOgcZoneFeature(feature: unknown, citySlug: string): ZoneFeature | null {
  if (typeof feature !== "object" || feature === null) return null;
  const raw = feature as {
    type?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  };
  if (raw.type !== "Feature") return null;
  const properties = raw.properties ?? {};
  // Matching de propriété FLEXIBLE : le nom du champ zone VARIE selon la source
  // geo (heads-up geo 2026-06-28 + mesure recall #74 2026-06-28) — 'zone_code'
  // (obscura/GoNet, ~70 collections), 'code' (×5), 'Zonage'/'NumZone' (ArcGIS),
  // 'Zone'/'NO_ZONAGE'/'zone_' (variantes casse), 'ETIQUETTE' composite.
  // ETIQUETTE = "<id>  <CODE>" : on extrait le dernier token (le code réglementaire).
  const etiquette = typeof properties.ETIQUETTE === "string" ? properties.ETIQUETTE.trim().split(/\s+/).pop() : undefined;
  // ORDRE CRITIQUE (#74) : les codes RÉGLEMENTAIRES d'abord (ceux qui matchent les PV),
  // les ids SÉQUENTIELS internes (NumZone/NUM_ZONE = "4052", "R-128") en DERNIER recours —
  // sinon ils volent la priorité au vrai code (ex. saint-hyacinthe NUM_ZONE 4052 vs ETIQUETTE H01).
  const code = firstString([
    properties.code,
    properties.Code,
    properties.zoneCode,
    properties.zone_code,
    properties.ZONE,
    properties.Zone,
    properties.Zonage,
    properties.zonage,
    properties.NO_ZONAGE,
    properties.zone_,
    etiquette,
    properties.code_affiche,
    properties.codeAffiche,
    properties.No_zone,
    properties.no_zone,
    properties.NumZone,
    properties.num_zone,
    properties.NUM_ZONE,
  ]);
  if (!code) return null;

  return {
    type: "Feature",
    geometry: normalizeGeometry(raw.geometry),
    properties: {
      code,
      citySlug,
      ...normalizeOgcZoneProperties(properties),
    },
  };
}

function normalizeOgcZoneProperties(properties: Record<string, unknown>): Partial<ZoneProperties> {
  const kind = firstString([
    properties.kind,
    properties.type,
    properties.categorie,
    properties.category,
    properties.zoneKind,
    properties.zone_kind,
  ]);
  const usages = normalizeUsages(properties.usages ?? properties.usage);
  // Lien grille PDF — nom de champ hétérogène selon la source geo (catalogue #74).
  const grillePdfUrl = firstString([
    properties.URL_Grille,
    properties.LienGrille,
    properties.Grille,
    properties.URL_GRILLE,
    properties.GRILLE_URL,
    properties.grille,
    properties.lien_grille,
  ]);

  return {
    ...(kind !== null ? { kind } : {}),
    ...(usages !== undefined ? { usages } : {}),
    ...(grillePdfUrl !== null ? { grillePdfUrl } : {}),
  };
}

function normalizeUsages(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((v) => readString(v)).filter((v): v is string => v !== null);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function normalizeGeometry(value: unknown): ZoneGeometry | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    "coordinates" in value
  ) {
    return value as ZoneGeometry;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function firstString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = readString(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

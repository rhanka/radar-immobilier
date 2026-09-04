/**
 * cptaq-client — couche CPTAQ « Zone agricole protégée » servie par geo via
 * l'API **OGC API Features DIRECTE** (CORS `*`, GeoJSON, PAS de tuiles) :
 *   GET <BASE>/collections/ca-qc-constraints-<citySlug>/items?bbox=&limit=
 *
 * Miroir de `zones-client.ts` (même forme OGC-collections), MAIS :
 *  - base = `VITE_GEO_OGC_BASE_URL` (host geo direct, CORS `*`) SI défini ;
 *    sinon proxy same-origin `/api/geo/collections` (geo-api, 0 touche api/ —
 *    comme le reste de l'app consomme geo). Le même-origine NU `/collections`
 *    n'est PAS proxifié (SPA fallback → 200 text/html → erreur, pas d'absence),
 *    donc le défaut est `/api/geo`, jamais la racine ;
 *  - collection per-ville `ca-qc-constraints-<slug>` (nommage réel geo-cond).
 *
 * Robustesse (identique à zones-client) :
 *  - 404 (collection non servie pour la ville) → { ok:false, absent:true,
 *    features:[] } SANS lever (état d'absence VISIBLE côté vue, jamais muet) ;
 *  - lève sur erreur réseau / HTTP non-2xx hors 404.
 *
 * Overlay purement géométrique (aplat « zone agricole ») : les properties sont
 * gardées OPAQUES (aucune n'est requise pour la peinture) — NE RIEN INVENTER.
 */
import { fetchWithTimeout } from "$lib/net/fetch-with-timeout.js";

export interface CptaqGeometry {
  type: string;
  coordinates: unknown;
}

/** Properties opaques d'une contrainte CPTAQ (aucune requise pour l'aplat). */
export type CptaqProperties = Record<string, unknown>;

export interface CptaqFeature {
  type: "Feature";
  geometry: CptaqGeometry | null;
  properties: CptaqProperties;
}

export interface CptaqFeatureCollection {
  type: "FeatureCollection";
  features: CptaqFeature[];
}

export interface CptaqResponse {
  ok: boolean;
  citySlug: string;
  source: "geo-ogc" | "none";
  /** `true` quand la collection n'est pas servie pour cette ville (404). */
  absent?: boolean;
  /** Raison de l'échec (ok=false seulement). */
  reason?: string;
  collectionId?: string;
  numberMatched?: number;
  numberReturned?: number;
  featureCollection: CptaqFeatureCollection;
}

export interface FetchCptaqOptions {
  limit?: number;
  bbox?: [number, number, number, number];
  baseUrl?: string;
  /** Signal d'annulation externe (anti-course au changement de ville/bbox). */
  signal?: AbortSignal;
  /** Timeout requête (ms). Défaut : `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

interface OgcFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
  numberMatched?: number;
  numberReturned?: number;
}

const EMPTY_CPTAQ: CptaqFeatureCollection = { type: "FeatureCollection", features: [] };

export function cptaqCollectionId(citySlug: string): string {
  return `ca-qc-constraints-${citySlug}`;
}

export function resolveCptaqUrl(citySlug: string, opts: FetchCptaqOptions = {}): string {
  // VITE_GEO_OGC_BASE_URL défini (host geo direct CORS *) → prioritaire ; sinon
  // proxy same-origin `/api/geo` (geo-api). PAS la racine : `/collections` nu
  // tombe dans le SPA fallback (200 text/html) → cptaqError, 0 couche rendue.
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_GEO_OGC_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "/api/geo";
  const path = `/collections/${encodeURIComponent(cptaqCollectionId(citySlug))}/items`;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Charge la couche CPTAQ d'une ville depuis l'API OGC geo directe.
 *
 * - `ok:true` + FeatureCollection quand la collection est servie ;
 * - `ok:false, absent:true, features:[]` sur 404 (collection non servie pour
 *   cette ville) — état d'absence, PAS une erreur dure ;
 * - lève sur erreur réseau ou HTTP non-2xx hors 404.
 */
export async function fetchCptaqConstraints(
  citySlug: string,
  opts: FetchCptaqOptions = {},
): Promise<CptaqResponse> {
  const url = resolveCptaqUrl(citySlug, opts);
  const res = await fetchWithTimeout(url, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  const collectionId = cptaqCollectionId(citySlug);
  if (res.status === 404) {
    return {
      ok: false,
      citySlug,
      source: "none",
      absent: true,
      reason: `Collection CPTAQ non servie par geo : ${collectionId}`,
      collectionId,
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: EMPTY_CPTAQ,
    };
  }
  if (!res.ok) {
    throw new Error(`cptaq HTTP ${res.status} for ${citySlug}`);
  }
  const body = await res.json();
  if (!isOgcFeatureCollection(body)) {
    throw new Error(`cptaq: réponse geo inattendue pour ${citySlug}`);
  }
  const features = body.features
    .map((feature) => normalizeCptaqFeature(feature))
    .filter((feature): feature is CptaqFeature => feature !== null);
  return {
    ok: true,
    citySlug,
    source: "geo-ogc",
    collectionId,
    numberMatched: body.numberMatched ?? features.length,
    numberReturned: body.numberReturned ?? features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
}

function isOgcFeatureCollection(value: unknown): value is OgcFeatureCollection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OgcFeatureCollection>;
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
}

function normalizeCptaqFeature(feature: unknown): CptaqFeature | null {
  if (typeof feature !== "object" || feature === null) return null;
  const raw = feature as {
    type?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  };
  if (raw.type !== "Feature") return null;
  return {
    type: "Feature",
    geometry: normalizeGeometry(raw.geometry),
    properties: raw.properties ?? {},
  };
}

function normalizeGeometry(value: unknown): CptaqGeometry | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    "coordinates" in value
  ) {
    return value as CptaqGeometry;
  }
  return null;
}

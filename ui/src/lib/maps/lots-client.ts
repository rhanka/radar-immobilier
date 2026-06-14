/**
 * Client for GET /api/geo/:city/lots — WP B slice-2.
 *
 * Retourne un FeatureCollection GeoJSON de lots cadastraux réels (MRNF)
 * pour une ville.  Propriétés exposées : uniquement `noLot`, `citySlug`
 * et `potentialScore` (Loi 25 — aucune PII, aucun propriétaire).
 *
 * Lorsque la ville n'a pas de source lots (ok=false) on retourne
 * un FeatureCollection vide plutôt que de lever, sauf si
 * opts.throwOnEmpty=true.
 *
 * CS-L2 : `potentialScore` (0–10) est retourné par l'API (PR #165).
 * Échelle DISTINCTE du 0-5 T2 et du 0-100 legacy.
 * Quand non disponible (endpoint non enrichi) : undefined.
 */

/** Properties d'un lot cadastral (uniquement données publiques non-PII). */
export interface LotProperties {
  noLot: string;
  citySlug?: string;
  /**
   * Score de potentiel par lot (0–10, échelle distincte du 0-5 T2 et du 0-100 legacy).
   * Calculé à partir de ZoneVersion.densiteLogHa, kind, usages, TOD.
   * undefined si l'endpoint ne l'a pas encore enrichi.
   * Source : /api/geo/:city/lots (feat/api-score-potentiel-lot).
   */
  potentialScore?: number;
  /**
   * Mode de la source de données.
   * "carte-steve" = données Steve (4 villes), "donnees-quebec" = MRNF scrappé.
   * undefined si l'endpoint est l'ancien format.
   */
  mode?: "carte-steve" | "donnees-quebec";
  /**
   * Tag de provenance — "steve-import" pour les données de la carte Steve.
   * Permet de distinguer les sources dans l'UI.
   */
  provenance?: "steve-import";
  // ── Champs enrichis mode carte-steve ──────────────────────────────────────
  /** Code de zone (ex. "H-104"). Présent en mode carte-steve. */
  zone?: string;
  /** Flag dans périmètre TOD. Présent en mode carte-steve. */
  tod?: boolean;
  /** Flag multifamilial 4+ logements. Présent en mode carte-steve. */
  multifamilial4plus?: boolean;
  /**
   * Flag priorité = 4+ ∩ TOD (précalculé par Steve).
   * Lots prioritaires affichés en orange sur la carte.
   * Présent en mode carte-steve.
   */
  priorite?: boolean;
  /** Valeur totale au rôle 2022 ($). Présent en mode carte-steve. */
  valTotale?: number;
  /** Valeur terrain ($). Présent en mode carte-steve. */
  valTerrain?: number;
  /** Catégorie (ex. "Résidentiel"). Présent en mode carte-steve. */
  categorie?: string;
  /** Nombre de logements au rôle. Présent en mode carte-steve. */
  nbLogementsRole?: number;
  /** Nombre d'étages. Présent en mode carte-steve. */
  nbEtages?: string;
}

export interface LotGeometry {
  type: string;
  coordinates: unknown;
}

export interface LotFeature {
  type: "Feature";
  geometry: LotGeometry | null;
  properties: LotProperties;
}

export interface LotFeatureCollection {
  type: "FeatureCollection";
  features: LotFeature[];
}

export interface LotsResponse {
  ok: boolean;
  citySlug: string;
  source: "donnees-quebec" | "carte-steve" | "none";
  /** Mode de la source (carte-steve = données Steve, donnees-quebec = MRNF). */
  mode?: "carte-steve" | "donnees-quebec";
  /** Raison de l'échec (ok=false seulement). */
  reason?: string;
  featureCollection: LotFeatureCollection;
}

export interface FetchLotsOptions {
  limit?: number;
  bbox?: [number, number, number, number];
  baseUrl?: string;
}

export function resolveLotsUrl(
  citySlug: string,
  opts: FetchLotsOptions = {},
): string {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const path = `/api/geo/${encodeURIComponent(citySlug)}/lots`;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Charge les lots cadastraux d'une ville depuis l'API.
 *
 * - Retourne le FeatureCollection quand ok=true.
 * - Retourne { ok:false, featureCollection:{features:[]} } quand la ville
 *   n'a pas de source lots (source absente) — pas d'exception.
 * - Lève en cas d'erreur réseau ou HTTP non-2xx.
 */
export async function fetchLots(
  citySlug: string,
  opts: FetchLotsOptions = {},
): Promise<LotsResponse> {
  const url = resolveLotsUrl(citySlug, opts);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`lots HTTP ${res.status} for ${citySlug}`);
  }
  const body = (await res.json()) as LotsResponse;
  // ok=false with featureCollection={features:[]} is a valid "no source" case —
  // we return it directly so the caller can display an honest empty state.
  return body;
}

/**
 * Client for OGC lots collections exposed at /api/geo/collections.
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
   * Source historique : /api/geo/:city/lots (feat/api-score-potentiel-lot).
   * Source prod actuelle : /api/geo/collections/qc-lots-{city}/items.
   */
  potentialScore?: number | null;
  /** Mode de la source (carte-steve uniquement). */
  mode?: string;
  /** Flag emprise de rue — carte-steve uniquement. */
  isRue?: boolean;
  /** Flag dans périmètre TOD — carte-steve uniquement. */
  tod?: boolean;
  /** Flag multifamilial 4+ — carte-steve uniquement. */
  multifamilial4plus?: boolean;
  /** Surface calculée par l'API depuis la géométrie publique, en m². */
  superficieM2?: number | null;
  /** Usage public résolu quand disponible; null sinon. */
  usageCode?: string | null;
  /** Zone résolue pour le lot quand disponible; null sinon. */
  zone?: {
    kind: string;
    usages: string[];
    densiteLogHa: number | null;
  } | null;
  /** Raw zone code/group from an OGC lot collection when present. */
  zoneCode?: string | null;
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
  /** Mode de la source (carte-steve uniquement). */
  mode?: "carte-steve" | "donnees-quebec";
  /** Raison de l'échec (ok=false seulement). */
  reason?: string;
  /** OGC collection id when loaded from the live geo API. */
  collectionId?: string;
  /** OGC total match count. May be greater than the loaded features length. */
  numberMatched?: number;
  /** OGC returned feature count for the current page. */
  numberReturned?: number;
  featureCollection: LotFeatureCollection;
}

export interface FetchLotsOptions {
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

const EMPTY_LOTS: LotFeatureCollection = { type: "FeatureCollection", features: [] };

export function lotsCollectionId(citySlug: string): string {
  return `qc-lots-${citySlug}`;
}

export function resolveLotsUrl(
  citySlug: string,
  opts: FetchLotsOptions = {},
): string {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const path = `/api/geo/collections/${encodeURIComponent(lotsCollectionId(citySlug))}/items`;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Charge les lots cadastraux d'une ville depuis l'API OGC live.
 *
 * - Retourne le FeatureCollection quand ok=true.
 * - Retourne { ok:false, featureCollection:{features:[]} } quand aucune
 *   collection `qc-lots-{citySlug}` n'existe — pas de faux compteur à 0.
 * - Lève en cas d'erreur réseau ou HTTP non-2xx hors collection absente.
 */
export async function fetchLots(
  citySlug: string,
  opts: FetchLotsOptions = {},
): Promise<LotsResponse> {
  const url = resolveLotsUrl(citySlug, opts);
  const res = await fetch(url);
  const collectionId = lotsCollectionId(citySlug);
  if (res.status === 404) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `Collection lots non configurée dans l'API geo : ${collectionId}`,
      collectionId,
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: EMPTY_LOTS,
    };
  }
  if (!res.ok) {
    throw new Error(`lots HTTP ${res.status} for ${citySlug}`);
  }
  const body = await res.json();
  if (isLegacyLotsResponse(body)) {
    return {
      ...body,
      collectionId: body.collectionId ?? collectionId,
      numberMatched: body.numberMatched ?? body.featureCollection.features.length,
      numberReturned: body.numberReturned ?? body.featureCollection.features.length,
    };
  }
  if (!isOgcFeatureCollection(body)) {
    throw new Error(`lots: réponse geo inattendue pour ${citySlug}`);
  }

  const features = body.features
    .map((feature) => normalizeOgcLotFeature(feature, citySlug))
    .filter((feature): feature is LotFeature => feature !== null);
  return {
    ok: true,
    citySlug,
    source: "donnees-quebec",
    mode: "donnees-quebec",
    collectionId,
    numberMatched: body.numberMatched ?? features.length,
    numberReturned: body.numberReturned ?? features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
}

function isLegacyLotsResponse(value: unknown): value is LotsResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LotsResponse>;
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

function normalizeOgcLotFeature(feature: unknown, citySlug: string): LotFeature | null {
  if (typeof feature !== "object" || feature === null) return null;
  const raw = feature as {
    type?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  };
  if (raw.type !== "Feature") return null;
  const properties = raw.properties ?? {};
  const noLot = readString(properties.noLot) ?? readString(properties.NO_LOT) ?? readString(properties.code);
  if (!noLot) return null;

  return {
    type: "Feature",
    geometry: normalizeGeometry(raw.geometry),
    properties: {
      noLot,
      citySlug,
      ...normalizeOgcLotProperties(properties),
    },
  };
}

function normalizeOgcLotProperties(properties: Record<string, unknown>): Partial<LotProperties> {
  const potentialScore = firstNumber([
    properties.potentialScore,
    properties.potential_score,
    properties.score,
  ]);
  const mode = readString(properties.mode);
  const isRue = firstBoolean([properties.isRue, properties.is_rue]);
  const tod = firstBoolean([properties.tod, properties.inTod, properties.in_tod]);
  const multifamilial4plus = firstBoolean([
    properties.multifamilial4plus,
    properties.multifamilial_4plus,
  ]);
  const superficieM2 = firstNumber([
    properties.superficieM2,
    properties.superficie_m2,
    properties.superficie_m2_calculee,
  ]);
  const usageCode = firstString([
    properties.usageCode,
    properties.usage_code,
    properties.cubf,
  ]);
  const zone = normalizeZone(properties.zone);
  const zoneCode = firstString([
    properties.zoneCode,
    properties.zone_code,
    properties.zone,
  ]);

  return {
    ...(potentialScore !== null ? { potentialScore } : {}),
    ...(mode !== null ? { mode } : {}),
    ...(isRue !== null ? { isRue } : {}),
    ...(tod !== null ? { tod } : {}),
    ...(multifamilial4plus !== null ? { multifamilial4plus } : {}),
    ...(superficieM2 !== null ? { superficieM2 } : {}),
    ...(usageCode !== null ? { usageCode } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(zoneCode !== null ? { zoneCode } : {}),
  };
}

function normalizeZone(value: unknown): LotProperties["zone"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = readString(record.kind);
  if (!kind) return undefined;
  const rawUsages = Array.isArray(record.usages) ? record.usages : [];
  return {
    kind,
    usages: rawUsages.map(String),
    densiteLogHa: firstNumber([record.densiteLogHa, record.densite_log_ha]),
  };
}

function normalizeGeometry(value: unknown): LotGeometry | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    "coordinates" in value
  ) {
    return value as LotGeometry;
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

function firstNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(values: readonly unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "oui"].includes(normalized)) return true;
      if (["false", "0", "no", "non"].includes(normalized)) return false;
    }
  }
  return null;
}

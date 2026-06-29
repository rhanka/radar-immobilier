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
import { resolveLotPotentialScore } from "./lot-potential-visual.js";

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
  /** État de résolution du score visuel. */
  potentialScoreStatus?: "scored" | "fallback" | "unavailable";
  /** Source de résolution du score visuel. */
  potentialScoreSource?: "api" | "zone" | "flags" | "none";
  /** Explication courte du score/fallback. */
  potentialScoreReason?: string;
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
  /** Champs publics du rôle d'évaluation quand l'API geo les expose. */
  valuation?: {
    usageCode?: string | null;
    categorie?: string | null;
    valeurTotale?: number | null;
    valeurTerrain?: number | null;
    valeurBatiment?: number | null;
    nbLogements?: number | null;
    nbEtages?: number | null;
    anneeConstruction?: number | null;
  } | null;
  /** Zone résolue pour le lot quand disponible; null sinon. */
  zone?: {
    kind: string;
    usages: string[];
    densiteLogHa: number | null;
    code?: string | null;
    grillePdfUrl?: string | null;
  } | null;
  /** Raw zone code/group from an OGC lot collection when present. */
  zoneCode?: string | null;
  /** Lien direct vers la grille PDF quand exposé hors objet zone. */
  grillePdfUrl?: string | null;
  /**
   * Identifiant de version du lot cadastral, requis pour le marquage prospect
   * (clé du mark côté API). Présent quand la collection OGC l'expose
   * (`lotVersionId` / `lot_version_id`) ; absent sinon → marquage marks désactivé.
   */
  lotVersionId?: string | null;
  /** UI-derived projection state for signal mode; not persisted by the API. */
  signalProjection?: "direct" | "inherited" | "none";
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
    const featureCollection = normalizeFeatureCollection(body.featureCollection, body.citySlug);
    return {
      ...body,
      featureCollection,
      collectionId: body.collectionId ?? collectionId,
      numberMatched: body.numberMatched ?? featureCollection.features.length,
      numberReturned: body.numberReturned ?? featureCollection.features.length,
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

function normalizeFeatureCollection(
  collection: LotFeatureCollection,
  citySlug: string,
): LotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features
      .map((feature) => normalizeExistingLotFeature(feature, citySlug))
      .filter((feature): feature is LotFeature => feature !== null),
  };
}

function normalizeExistingLotFeature(feature: LotFeature, citySlug: string): LotFeature | null {
  const noLot = readString(feature.properties.noLot);
  if (!noLot) return null;
  return {
    type: "Feature",
    geometry: normalizeGeometry(feature.geometry),
    properties: {
      noLot,
      citySlug: feature.properties.citySlug ?? citySlug,
      ...normalizeOgcLotProperties({ ...feature.properties, noLot }),
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
  const valuation = normalizeValuation(properties.valuation, usageCode, properties);
  const zone = normalizeZone(properties.zone, properties);
  const zoneCode = firstString([
    properties.zoneCode,
    properties.zone_code,
    properties.zoneCodeRaw,
    properties.zone_code_raw,
    typeof properties.zone === "string" ? properties.zone : null,
  ]) ?? zone?.code ?? null;
  const grillePdfUrl = firstString([
    properties.grillePdfUrl,
    properties.grille_pdf_url,
    properties.gridPdfUrl,
    properties.grid_pdf_url,
    properties.zoningGridPdfUrl,
    properties.zoning_grid_pdf_url,
  ]) ?? zone?.grillePdfUrl ?? null;
  const lotVersionId = firstString([
    properties.lotVersionId,
    properties.lot_version_id,
  ]);
  const scoreResolution = resolveLotPotentialScore({
    ...properties,
    ...(potentialScore !== null ? { potentialScore } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(zoneCode !== null ? { zoneCode } : {}),
    ...(tod !== null ? { tod } : {}),
    ...(multifamilial4plus !== null ? { multifamilial4plus } : {}),
  });

  return {
    potentialScore: scoreResolution.score,
    potentialScoreStatus: scoreResolution.status,
    potentialScoreSource: scoreResolution.source,
    potentialScoreReason: scoreResolution.reason,
    ...(mode !== null ? { mode } : {}),
    ...(isRue !== null ? { isRue } : {}),
    ...(tod !== null ? { tod } : {}),
    ...(multifamilial4plus !== null ? { multifamilial4plus } : {}),
    ...(superficieM2 !== null ? { superficieM2 } : {}),
    ...(usageCode !== null ? { usageCode } : {}),
    ...(valuation !== undefined ? { valuation } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(zoneCode !== null ? { zoneCode } : {}),
    ...(grillePdfUrl !== null ? { grillePdfUrl } : {}),
  };
}

function normalizeZone(
  value: unknown,
  fallback: Record<string, unknown> = {},
): LotProperties["zone"] | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
  const kind = firstString([record.kind, record.zoneKind, record.zone_kind, record.typeZone, record.type_zone]);
  const code = firstString([record.code, record.zoneCode, record.zone_code, fallback.zoneCode, fallback.zone_code]);
  const densiteLogHa = firstNumber([
    record.densiteLogHa,
    record.densite_log_ha,
    record.densityLogHa,
    record.density_log_ha,
    fallback.densiteLogHa,
    fallback.densite_log_ha,
  ]);
  const rawUsages = Array.isArray(record.usages)
    ? record.usages
    : Array.isArray(record.uses)
      ? record.uses
      : [];
  const grillePdfUrl = firstString([
    record.grillePdfUrl,
    record.grille_pdf_url,
    record.gridPdfUrl,
    record.grid_pdf_url,
    fallback.grillePdfUrl,
    fallback.grille_pdf_url,
  ]);

  if (!kind && !code && densiteLogHa === null && rawUsages.length === 0 && !grillePdfUrl) return undefined;
  return {
    kind: kind ?? "non précisé",
    usages: rawUsages.map(String),
    densiteLogHa,
    ...(code !== null ? { code } : {}),
    ...(grillePdfUrl !== null ? { grillePdfUrl } : {}),
  };
}

function normalizeValuation(
  value: unknown,
  fallbackUsageCode: string | null,
  fallback: Record<string, unknown> = {},
): LotProperties["valuation"] | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
  const valuation = {
    usageCode: firstString([record.usageCode, record.usage_code, record.cubf]) ?? fallbackUsageCode,
    categorie: firstString([record.categorie, record.category, record.usageLabel, record.usage_label]),
    valeurTotale: firstNumber([record.valeurTotale, record.valeur_totale, record.totalValue, record.total_value]),
    valeurTerrain: firstNumber([record.valeurTerrain, record.valeur_terrain, record.landValue, record.land_value]),
    valeurBatiment: firstNumber([record.valeurBatiment, record.valeur_batiment, record.buildingValue, record.building_value]),
    nbLogements: firstNumber([record.nbLogements, record.nb_logements, record.logements, record.dwellingCount]),
    nbEtages: firstNumber([record.nbEtages, record.nb_etages, record.etages, record.floorCount]),
    anneeConstruction: firstNumber([record.anneeConstruction, record.annee_construction, record.yearBuilt, record.year_built]),
  };
  return Object.values(valuation).some((v) => v !== null && v !== undefined) ? valuation : undefined;
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

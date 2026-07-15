/** Regulation provenance fields recognized on live geo zone properties. */
export const REGLEMENT_KEYS = [
  "reglement_numero",
  "reglement_millesime",
  "reglement_page_source",
  "reglement_url",
  "reglementNumero",
  "reglementMillesime",
  "reglementPageSource",
  "reglementUrl",
  "REGLEMENT_NUMERO",
  "REGLEMENT_MILLESIME",
  "REGLEMENT_PAGE_SOURCE",
  "REGLEMENT_URL",
] as const;

/** Explicit normative value fields recognized on live geo zone properties. */
export const NORMATIVE_VALUE_KEYS = [
  "densite_value",
  "hauteur_min_value",
  "hauteur_max_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;

/** Normalize sourced evidence verbatim-or-null, without deriving semantics. */
export function normalizeNormValue(value: unknown): string | number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeNormValue(item);
      if (normalized !== null) return normalized;
    }
    return null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const numeric = Number(trimmed.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : trimmed;
}

export function hasRecognizedValue(
  props: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => normalizeNormValue(props[key]) !== null);
}

export interface NormesCoverageCounters {
  zonesWithGrille: number;
  zonesWithReglement: number;
  zonesWithLegacyNormes: number;
  zonesWithNormativeValues: number;
  covered: number;
}

export type GeoNormesError = "geo_unreachable" | "invalid_response";
export type GeoFeatureCollectionResult =
  | {
      ok: true;
      found: boolean;
      features: unknown[];
      numberMatched: number | null;
      complete: boolean;
    }
  | { ok: false; error: GeoNormesError };

/** Load and validate one bounded OGC page used by the lazy coverage measure. */
export async function loadGeoFeatureCollection(
  baseUrl: string,
  collectionId: string,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<GeoFeatureCollectionResult> {
  const url =
    `${baseUrl}/collections/${encodeURIComponent(collectionId)}` +
    `/items?limit=${limit}&f=json`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    return { ok: false, error: "geo_unreachable" };
  }
  if (response.status === 404) {
    return {
      ok: true,
      found: false,
      features: [],
      numberMatched: 0,
      complete: true,
    };
  }
  if (!response.ok) return { ok: false, error: "geo_unreachable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "invalid_response" };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_response" };
  }
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return { ok: false, error: "invalid_response" };
  }
  const rawMatched = (body as { numberMatched?: unknown }).numberMatched;
  const numberMatched =
    rawMatched === undefined || rawMatched === null
      ? null
      : typeof rawMatched === "number" &&
          Number.isInteger(rawMatched) &&
          rawMatched >= features.length
        ? rawMatched
        : undefined;
  if (numberMatched === undefined) {
    return { ok: false, error: "invalid_response" };
  }
  return {
    ok: true,
    found: true,
    features,
    numberMatched,
    complete:
      numberMatched === null
        ? features.length < limit
        : numberMatched === features.length,
  };
}

function featureProps(feature: unknown): Record<string, unknown> {
  const props =
    typeof feature === "object" && feature !== null
      ? (feature as { properties?: unknown }).properties
      : null;
  return typeof props === "object" && props !== null
    ? (props as Record<string, unknown>)
    : {};
}

function explicitZoneCode(props: Record<string, unknown>): string | null {
  const code = normalizeZoneCode(extractZoneCode(props));
  return code.length > 0 ? code : null;
}

function hasLegacyNormes(props: Record<string, unknown>): boolean {
  const normes = zoneNormes(props);
  return normes.densiteLogHa !== null || normes.usages.length > 0;
}

/** Count evidence existentially for each served zone feature. */
export function measureNormesCoverage(
  servedZoneFeatures: unknown[],
  geoNormeFeatures: unknown[],
): NormesCoverageCounters {
  const geoNormesByCode = new Map<string, Record<string, unknown>[]>();
  for (const feature of geoNormeFeatures) {
    const props = featureProps(feature);
    const code = explicitZoneCode(props);
    if (!code) continue;
    const evidence = geoNormesByCode.get(code) ?? [];
    evidence.push(props);
    geoNormesByCode.set(code, evidence);
  }

  const result: NormesCoverageCounters = {
    zonesWithGrille: 0,
    zonesWithReglement: 0,
    zonesWithLegacyNormes: 0,
    zonesWithNormativeValues: 0,
    covered: 0,
  };
  for (const feature of servedZoneFeatures) {
    const props = featureProps(feature);
    const code = explicitZoneCode(props);
    const evidence = [props, ...(code ? (geoNormesByCode.get(code) ?? []) : [])];
    const grille = evidence.some((item) => zoneGrillePdfUrl(item) !== null);
    const reglement = evidence.some((item) =>
      hasRecognizedValue(item, REGLEMENT_KEYS),
    );
    const legacy = evidence.some(hasLegacyNormes);
    const values = evidence.some((item) =>
      hasRecognizedValue(item, NORMATIVE_VALUE_KEYS),
    );
    if (grille) result.zonesWithGrille += 1;
    if (reglement) result.zonesWithReglement += 1;
    if (legacy) result.zonesWithLegacyNormes += 1;
    if (values) result.zonesWithNormativeValues += 1;
    if (grille || reglement || legacy || values) result.covered += 1;
  }
  return result;
}
import { normalizeZoneCode } from "./extract-refs.js";
import { extractZoneCode } from "./ogc-pull.js";
import { zoneGrillePdfUrl, zoneNormes } from "./lot-zone-enrichment.js";

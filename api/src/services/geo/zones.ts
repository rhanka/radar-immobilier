/**
 * Pure zone/lot normalization for geo display.
 *
 * Official zone polygons are preferred. Lot-group geometry is only a visual
 * fallback and is explicitly marked as lower-confidence, never official.
 */

export type GeometryStatus =
  | "official"
  | "lot-union-fallback"
  | "text-only"
  | "missing";

export type ZoneResolutionStatus =
  | "official"
  | "fallback"
  | "missing";

export interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
}

export interface OfficialZoneInput {
  code: string;
  citySlug?: string;
  label?: string;
  geometry?: GeoJsonGeometry | null;
  source?: string;
  confidence?: number;
}

export interface ZoneLotInput {
  noLot: string;
  citySlug?: string;
  zoneCode?: string | null;
  geometry?: GeoJsonGeometry | null;
}

export interface NormalizedLotRef {
  noLot: string;
  citySlug: string;
}

export interface NormalizedZoneProperties {
  code: string;
  citySlug: string;
  geometryStatus: GeometryStatus;
  confidence: number;
  source: "official-zone" | "lot-zone-fallback";
  lotCount: number;
  lots: NormalizedLotRef[];
  label?: string;
}

export interface NormalizedZoneFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: NormalizedZoneProperties;
}

export interface NormalizedZoneFeatureCollection {
  type: "FeatureCollection";
  features: NormalizedZoneFeature[];
}

export interface NormalizeZonesOpts {
  includeLotFallback?: boolean;
}

export interface NormalizeZonesInput {
  citySlug: string;
  officialZones?: OfficialZoneInput[];
  lots?: ZoneLotInput[];
  opts?: NormalizeZonesOpts;
}

export interface NormalizeZonesResult {
  citySlug: string;
  resolutionStatus: ZoneResolutionStatus;
  geometryStatus: GeometryStatus;
  featureCollection: NormalizedZoneFeatureCollection;
  warnings: string[];
}

const OFFICIAL_CONFIDENCE = 0.95;
const OFFICIAL_TEXT_CONFIDENCE = 0.7;
const LOT_FALLBACK_CONFIDENCE = 0.55;
const LOT_TEXT_CONFIDENCE = 0.35;

const EMPTY_ZONE_CODES = new Set([
  "",
  "N/D",
  "ND",
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "-",
]);

export function officialZoneConfidence(): number {
  return OFFICIAL_CONFIDENCE;
}

export function lotFallbackConfidence(): number {
  return LOT_FALLBACK_CONFIDENCE;
}

export function normalizeZoneCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return EMPTY_ZONE_CODES.has(code) ? "" : code;
}

function hasGeometry(geometry: GeoJsonGeometry | null | undefined): geometry is GeoJsonGeometry {
  return geometry !== null && geometry !== undefined && typeof geometry.type === "string" && geometry.type.length > 0;
}

function sanitizedLot(lot: ZoneLotInput, citySlug: string): NormalizedLotRef | null {
  const noLot = String(lot.noLot ?? "").trim();
  if (!noLot) return null;
  return {
    noLot,
    citySlug: lot.citySlug ?? citySlug,
  };
}

function groupLotsByZone(
  lots: ZoneLotInput[],
  citySlug: string,
): Map<string, Array<{ lot: ZoneLotInput; ref: NormalizedLotRef }>> {
  const byZone = new Map<string, Array<{ lot: ZoneLotInput; ref: NormalizedLotRef }>>();

  for (const lot of lots) {
    const zoneCode = normalizeZoneCode(lot.zoneCode);
    if (!zoneCode) continue;
    const ref = sanitizedLot(lot, citySlug);
    if (!ref) continue;
    const current = byZone.get(zoneCode) ?? [];
    current.push({ lot, ref });
    byZone.set(zoneCode, current);
  }

  return byZone;
}

function lotUnionGeometry(lots: ZoneLotInput[]): GeoJsonGeometry | null {
  const geometries = lots
    .map((lot) => lot.geometry ?? null)
    .filter((geometry): geometry is GeoJsonGeometry => hasGeometry(geometry));

  if (geometries.length === 0) return null;

  const polygons: unknown[] = [];
  for (const geometry of geometries) {
    if (geometry.type === "Polygon") {
      polygons.push(geometry.coordinates);
      continue;
    }
    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      polygons.push(...geometry.coordinates);
      continue;
    }
  }

  if (polygons.length > 0) {
    return {
      type: "MultiPolygon",
      coordinates: polygons,
    };
  }

  return {
    type: "GeometryCollection",
    geometries,
  };
}

function summarizeGeometryStatus(features: NormalizedZoneFeature[]): GeometryStatus {
  if (features.some((feature) => feature.properties.geometryStatus === "official")) {
    return "official";
  }
  if (features.some((feature) => feature.properties.geometryStatus === "lot-union-fallback")) {
    return "lot-union-fallback";
  }
  if (features.some((feature) => feature.properties.geometryStatus === "text-only")) {
    return "text-only";
  }
  return "missing";
}

function officialFeatures(
  citySlug: string,
  officialZones: OfficialZoneInput[],
  lotsByZone: Map<string, Array<{ lot: ZoneLotInput; ref: NormalizedLotRef }>>,
): NormalizedZoneFeature[] {
  const features: NormalizedZoneFeature[] = [];
  const seen = new Set<string>();

  for (const zone of officialZones) {
    const code = normalizeZoneCode(zone.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const lotGroup = lotsByZone.get(code) ?? [];
    const geometry = hasGeometry(zone.geometry) ? zone.geometry : null;
    const geometryStatus: GeometryStatus = geometry ? "official" : "text-only";
    const confidence =
      zone.confidence ??
      (geometryStatus === "official" ? OFFICIAL_CONFIDENCE : OFFICIAL_TEXT_CONFIDENCE);

    features.push({
      type: "Feature",
      geometry,
      properties: {
        code,
        citySlug: zone.citySlug ?? citySlug,
        ...(zone.label ? { label: zone.label } : {}),
        geometryStatus,
        confidence,
        source: "official-zone",
        lotCount: lotGroup.length,
        lots: lotGroup.map((entry) => entry.ref),
      },
    });
  }

  return features;
}

function fallbackFeatures(
  citySlug: string,
  lotsByZone: Map<string, Array<{ lot: ZoneLotInput; ref: NormalizedLotRef }>>,
): NormalizedZoneFeature[] {
  return Array.from(lotsByZone.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, lotGroup]) => {
      const lots = lotGroup.map((entry) => entry.lot);
      const geometry = lotUnionGeometry(lots);
      const geometryStatus: GeometryStatus = geometry ? "lot-union-fallback" : "text-only";
      return {
        type: "Feature" as const,
        geometry,
        properties: {
          code,
          citySlug,
          geometryStatus,
          confidence: geometry ? LOT_FALLBACK_CONFIDENCE : LOT_TEXT_CONFIDENCE,
          source: "lot-zone-fallback" as const,
          lotCount: lotGroup.length,
          lots: lotGroup.map((entry) => entry.ref),
        },
      };
    });
}

export function normalizeZonesAndLots(input: NormalizeZonesInput): NormalizeZonesResult {
  const officialZones = input.officialZones ?? [];
  const lots = input.lots ?? [];
  const lotsByZone = groupLotsByZone(lots, input.citySlug);

  const official = officialFeatures(input.citySlug, officialZones, lotsByZone);
  if (official.length > 0) {
    return {
      citySlug: input.citySlug,
      resolutionStatus: "official",
      geometryStatus: summarizeGeometryStatus(official),
      featureCollection: {
        type: "FeatureCollection",
        features: official,
      },
      warnings: [],
    };
  }

  if (input.opts?.includeLotFallback) {
    const fallback = fallbackFeatures(input.citySlug, lotsByZone);
    if (fallback.length > 0) {
      return {
        citySlug: input.citySlug,
        resolutionStatus: "fallback",
        geometryStatus: summarizeGeometryStatus(fallback),
        featureCollection: {
          type: "FeatureCollection",
          features: fallback,
        },
        warnings: ["lot-union-fallback-is-visual-only"],
      };
    }
  }

  return {
    citySlug: input.citySlug,
    resolutionStatus: "missing",
    geometryStatus: "missing",
    featureCollection: {
      type: "FeatureCollection",
      features: [],
    },
    warnings: [],
  };
}

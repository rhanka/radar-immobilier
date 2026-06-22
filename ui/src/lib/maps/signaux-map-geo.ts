import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type { GeoJsonGeometry } from "./cadastre-geojson-source.js";
import type {
  GeoZoneFeature,
  GeoZonesResponse,
} from "./geo-zones-client.js";
import type {
  LotFeatureCollection,
} from "./lots-client.js";
import {
  DIMMED_SELECTION_OPACITY,
  FULL_SELECTION_OPACITY,
  type SelectionBucketState,
  type SelectionKey,
} from "./selection-bucket.js";

export const CITY_FALLBACK_ZONE_PREFIX = "fallback:";

/**
 * Normalise un code de zone côté client pour qu'il soit comparable au
 * `properties.code` retourné par l'API geo (qui normalise côté serveur).
 *
 * Miroir de `normalizeZoneCode` dans api/src/services/geo/extract-refs.ts :
 *   - majuscules
 *   - tirets demi-cadratins → tirets ASCII
 *   - suppression du suffixe secteur (ex. "(VLO)")
 *   - suppression de tous les espaces
 *
 * Exemples :
 *   "h-431"        → "H-431"
 *   "H 431"        → "H431"
 *   "H34-327 (VLO)" → "H34-327"
 *   "H–431"        → "H-431"   (demi-cadratin unicode)
 */
export function normalizeZoneCodeRef(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "")
    .replace(/\s+/g, "");
}

/**
 * Normalise un numéro de lot pour la comparaison client :
 * conserve uniquement les chiffres (supprime espaces et tirets).
 *
 * Exemples :
 *   "4 516 943" → "4516943"
 *   "4516943"   → "4516943"
 */
export function normalizeLotNoRef(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export type LotSignalProjection = "direct" | "inherited" | "none";

export interface CityFallbackZoneInput {
  citySlug: string;
  cityName: string;
  geometry: GeoJsonGeometry | null;
}

export interface FallbackZoneResult {
  response: GeoZonesResponse;
  created: boolean;
}

export function fallbackZoneCode(citySlug: string): string {
  return `${CITY_FALLBACK_ZONE_PREFIX}${citySlug}`;
}

export function withCityFallbackZone(
  response: GeoZonesResponse,
  input: CityFallbackZoneInput,
): FallbackZoneResult {
  if (response.featureCollection.features.length > 0) {
    return { response, created: false };
  }

  const fallbackCode = fallbackZoneCode(input.citySlug);
  const fallbackFeature: GeoZoneFeature = {
    type: "Feature",
    geometry: input.geometry,
    properties: {
      code: fallbackCode,
      citySlug: input.citySlug,
      geometryStatus: "missing",
      confidence: 0,
      source: "lot-zone-fallback",
      lotCount: 0,
      lots: [],
      label: `Fallback ville - ${input.cityName}`,
    },
  };

  return {
    created: true,
    response: {
      ...response,
      ok: true,
      source: "none",
      resolutionStatus: "fallback",
      geometryStatus: "missing",
      zoneCount: 0,
      warnings: uniqueStrings([
        ...response.warnings,
        "city-fallback-zone-no-official-zones",
      ]),
      featureCollection: {
        type: "FeatureCollection",
        features: [fallbackFeature],
      },
    },
  };
}

export function opacityForSelectionKey(
  state: Pick<SelectionBucketState, "selectedKeys">,
  key: SelectionKey,
  emptyBucketOpacity: number,
): number {
  if (state.selectedKeys.size === 0) return emptyBucketOpacity;
  return state.selectedKeys.has(key)
    ? FULL_SELECTION_OPACITY
    : DIMMED_SELECTION_OPACITY;
}

export function decorateLotsWithSignalProjection(
  lots: LotFeatureCollection,
  zones: readonly GeoZoneFeature[],
  nodes: readonly GraphSignalNode[],
): LotFeatureCollection {
  if (lots.features.length === 0 || nodes.length === 0) return lots;

  const lotByComparableRef = buildLotComparableLookup(lots);
  const zoneLotsByCode = new Map<string, string[]>();
  for (const zone of zones) {
    const lotRefs = zone.properties.lots
      .map((lot) => resolveLotNo(lot.noLot, lotByComparableRef))
      .filter((lotNo): lotNo is string => lotNo !== null);
    zoneLotsByCode.set(zone.properties.code, lotRefs);
  }

  const projectionByLot = new Map<string, LotSignalProjection>();

  for (const node of nodes) {
    for (const rawLotRef of extractSignalLotRefs(node)) {
      const noLot = resolveLotNo(rawLotRef, lotByComparableRef);
      if (noLot) projectionByLot.set(noLot, "direct");
    }
  }

  for (const node of nodes) {
    if (extractSignalLotRefs(node).length > 0) continue;
    for (const zoneRef of extractSignalZoneRefs(node)) {
      for (const noLot of zoneLotsByCode.get(zoneRef) ?? []) {
        if (!projectionByLot.has(noLot)) projectionByLot.set(noLot, "inherited");
      }
    }
  }

  if (projectionByLot.size === 0) return lots;

  return {
    ...lots,
    features: lots.features.map((lot) => ({
      ...lot,
      properties: {
        ...lot.properties,
        signalProjection: projectionByLot.get(lot.properties.noLot) ?? "none",
      },
    })),
  };
}

export function extractSignalZoneRefs(node: GraphSignalNode): string[] {
  const raw = uniqueStrings(
    propRecords(node).flatMap((props) => [
      ...extractStructuredRefs(props.zone_ref),
      ...extractStructuredRefs(props.zoneRef),
      ...extractStructuredRefs(props.zone),
      ...extractStructuredRefs(props.zone_refs),
      ...extractStructuredRefs(props.zones),
      ...extractStructuredRefs(props.target_zone),
      ...extractStructuredRefs(props.targets_zone),
    ]),
  );
  // Normalise chaque code extrait pour qu'il soit comparable au
  // `properties.code` de la réponse API geo (normalisé côté serveur).
  return uniqueStrings(raw.map(normalizeZoneCodeRef));
}

/**
 * Forme comparable d'un code de zone pour l'appariement signal↔zone géo.
 *
 * Plus laxiste que `normalizeZoneCodeRef` : on retire AUSSI les tirets afin que
 * "A16" (référence d'un signal) et "A-16" (code_affiche d'une zone cadastrale)
 * soient reconnus comme la même zone. Le tiret est un artefact d'affichage du
 * cadastre OGC, pas une différence sémantique de zone.
 *
 * Exemples :
 *   "A16"   → "A16"
 *   "A-16"  → "A16"
 *   "H-431" → "H431"
 */
export function zoneRefComparableKey(code: string): string {
  return normalizeZoneCodeRef(code).replace(/-/g, "");
}

/**
 * Fusionne les zones géo de l'API avec les zones DÉSIGNÉES par les signaux.
 *
 * Problème résolu : un signal peut désigner une zone (`zone_ref`) qui n'existe
 * PAS dans la couche cadastrale OGC — typiquement une zone que la municipalité
 * veut *créer ou modifier* par un futur règlement (ex. St-Frédéric : rezonage
 * "A16"/"I93" du règlement 419-26). Cette zone est la donnée de valeur même
 * sans polygone : elle DOIT être listée et liée au signal. Le polygone ne sert
 * qu'à colorer la carte.
 *
 * Pour chaque code de zone désigné par un signal et absent des zones API
 * (comparaison par forme normalisée, tiret ignoré), on ajoute une feature
 * synthétique sans géométrie (`geometryStatus: "missing"`,
 * `source: "signal-designated"`). Les zones API existantes sont conservées
 * telles quelles, donc une zone désignée déjà présente côté géo n'est pas
 * dupliquée (corrige aussi le faux négatif "A16" ≠ "A-16").
 *
 * @param apiZones - Zones renvoyées par l'API geo (couche cadastrale).
 * @param nodes    - Nœuds Signal/DesignationEvent (filtrés ou non) à projeter.
 * @param citySlug - Slug de la ville pour les features synthétiques.
 * @returns Zones API + zones désignées manquantes, dédupliquées.
 */
export function mergeDesignatedZones(
  apiZones: readonly GeoZoneFeature[],
  nodes: readonly GraphSignalNode[],
  citySlug: string,
): GeoZoneFeature[] {
  const merged: GeoZoneFeature[] = [...apiZones];
  const knownKeys = new Set(
    apiZones.map((z) => zoneRefComparableKey(z.properties.code)),
  );

  for (const node of nodes) {
    for (const code of extractSignalZoneRefs(node)) {
      const key = zoneRefComparableKey(code);
      if (key.length === 0 || knownKeys.has(key)) continue;
      knownKeys.add(key);
      merged.push({
        type: "Feature",
        geometry: null,
        properties: {
          code,
          citySlug,
          geometryStatus: "missing",
          confidence: 0,
          source: "signal-designated",
          lotCount: 0,
          lots: [],
          label: `Zone ${code} (désignée — géométrie geo manquante)`,
        },
      });
    }
  }

  return merged;
}

export function extractSignalLotRefs(node: GraphSignalNode): string[] {
  const raw = uniqueStrings(
    propRecords(node).flatMap((props) => [
      ...extractStructuredRefs(props.lot_ref),
      ...extractStructuredRefs(props.lotRef),
      ...extractStructuredRefs(props.noLot),
      ...extractStructuredRefs(props.no_lot),
      ...extractStructuredRefs(props.lot),
      ...extractStructuredRefs(props.lots),
      ...extractStructuredRefs(props.target_lot),
      ...extractStructuredRefs(props.targets_lot),
      ...extractRelationRefs(props.subject_of, "lot"),
      ...extractRelationRefs(props.subdivides, "lot"),
    ]),
  );
  // Retourne les refs brutes ET les formes compactes (sans espaces)
  // pour couvrir les deux formats possibles du noLot API ("4 516 943" et "4516943").
  return uniqueStrings(raw.flatMap((ref) => [ref, normalizeLotNoRef(ref)]));
}

function propRecords(node: GraphSignalNode): Record<string, unknown>[] {
  const props = node.props ?? {};
  const nested = props.properties;
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? [props, nested as Record<string, unknown>]
    : [props];
}

function buildLotComparableLookup(lots: LotFeatureCollection): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const lot of lots.features) {
    const raw = lot.properties.noLot;
    for (const comparable of comparableRefs(raw)) {
      lookup.set(comparable, raw);
    }
  }
  return lookup;
}

function resolveLotNo(
  rawRef: string,
  lookup: ReadonlyMap<string, string>,
): string | null {
  for (const comparable of comparableRefs(rawRef)) {
    const noLot = lookup.get(comparable);
    if (noLot) return noLot;
  }
  return null;
}

function extractStructuredRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(extractStructuredRefs);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  return uniqueStrings([
    ...extractStructuredRefs(record.id),
    ...extractStructuredRefs(record.ref),
    ...extractStructuredRefs(record.code),
    ...extractStructuredRefs(record.noLot),
    ...extractStructuredRefs(record.no_lot),
    ...extractStructuredRefs(record.zoneRef),
    ...extractStructuredRefs(record.zone_ref),
    ...extractStructuredRefs(record.lotRef),
    ...extractStructuredRefs(record.lot_ref),
  ]);
}

function extractRelationRefs(value: unknown, expectedKind: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => extractRelationRefs(item, expectedKind));
  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  const kind =
    readString(record.kind) ??
    readString(record.entityKind) ??
    readString(record.type) ??
    "";
  if (!kind.toLowerCase().includes(expectedKind)) return [];

  return extractStructuredRefs(record);
}

function comparableRefs(value: string): string[] {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s+/g, "");
  return uniqueStrings([trimmed, compact]);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

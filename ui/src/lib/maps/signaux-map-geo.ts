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

/** Provenance d'un code de zone : champ structuré ou inféré du texte libre. */
export type ZoneRefSource = "structured" | "inferred";

/**
 * Code de zone extrait d'un signal, avec sa provenance et sa confiance.
 *
 * `source: "structured"` = champ `zone_ref`/`zoneRef`/… renseigné par graphify
 * (confiance 1). `source: "inferred"` = code repéré dans le texte libre (label,
 * citation, excerpt, description) par balayage regex (confiance 0.5–0.85).
 *
 * Règle d'or : une zone structurée n'est JAMAIS écrasée par une zone inférée du
 * même code. L'inférence ne fait que COMBLER les zones citées mais non
 * structurées (le cas Rosemère « zone C-18 », Saint-Amable « CEN-183 », etc.).
 */
export interface ZoneRefWithProvenance {
  /** Code normalisé (comparable au `properties.code` de l'API geo). */
  code: string;
  source: ZoneRefSource;
  /** Confiance : 1 (structuré) ; 0.5–0.85 (inféré, selon le motif). */
  confidence: number;
}

/**
 * Extrait les codes de zone d'un signal AVEC leur provenance.
 *
 * 1. Champs STRUCTURÉS (`zone_ref`, `zoneRef`, `zone`, `targets_zone`…) →
 *    `source: "structured"`, confiance 1. Comportement historique préservé.
 * 2. TEXTE LIBRE (label + citation + excerpt + description + refs[].excerpt) →
 *    `source: "inferred"`. Comble les 22/27 signaux dont la zone est CITÉE mais
 *    non structurée par graphify, pour qu'elle soit listable / filtrable /
 *    mappable / highlightable dès que la géométrie existera.
 *
 * Anti-écrasement : un code déjà présent en structuré reste structuré. Les
 * doublons inférés conservent la confiance maximale. Tout est dédupliqué et
 * normalisé (casse, espaces, tirets unicode, suffixe secteur).
 *
 * NE crée AUCUNE géométrie et n'expose AUCUNE route : pure détection de codes.
 */
export function extractSignalZoneRefsDetailed(node: GraphSignalNode): ZoneRefWithProvenance[] {
  const byCode = new Map<string, ZoneRefWithProvenance>();

  // 1. Champs structurés — autorité maximale, jamais écrasés (comportement historique).
  const structuredRaw = uniqueStrings(
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
  for (const rawCode of structuredRaw) {
    const code = normalizeZoneCodeRef(rawCode);
    if (code.length === 0) continue;
    if (!byCode.has(code)) byCode.set(code, { code, source: "structured", confidence: 1 });
  }

  // 2. Inférence depuis le texte libre — comble UNIQUEMENT les codes manquants.
  for (const candidate of scanZoneCodesFromText(collectSignalFreeText(node))) {
    const code = normalizeZoneCodeRef(candidate.rawText);
    if (code.length < 2) continue;
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, { code, source: "inferred", confidence: candidate.confidence });
    } else if (existing.source === "inferred" && candidate.confidence > existing.confidence) {
      // Jamais d'écrasement d'un structuré ; entre inférés, garder le plus confiant.
      existing.confidence = candidate.confidence;
    }
  }

  return [...byCode.values()];
}

/**
 * Codes de zone d'un signal (forme historique `string[]`, normalisée).
 *
 * Inclut désormais les codes structurés ET les codes inférés du texte libre
 * (cf. `extractSignalZoneRefsDetailed`). Les appelants qui ont besoin de la
 * provenance/confiance utilisent la variante `…Detailed`.
 */
export function extractSignalZoneRefs(node: GraphSignalNode): string[] {
  return extractSignalZoneRefsDetailed(node).map((zone) => zone.code);
}

/** Un code de zone candidat repéré dans le texte libre, avec sa confiance. */
interface InferredZoneCandidate {
  rawText: string;
  confidence: number;
}

/**
 * Concatène le texte libre exploitable d'un signal pour l'inférence de zones :
 * label + description + citation + excerpt (au niveau props ET props.properties),
 * plus les extraits des `refs[]`. Miroir allégé d'`extractSignalEvidence`.
 */
function collectSignalFreeText(node: GraphSignalNode): string {
  const parts: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.trim().length > 0) parts.push(value);
  };

  push(node.label);
  push(node.description);
  for (const props of propRecords(node)) {
    push(props.description);
    push(props.citation);
    push(props.excerpt);
    push(props.summary);
    push(props.justification);
    push(props.resume);
  }

  const refs = (node.props ?? {}).refs;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (ref && typeof ref === "object") {
        const record = ref as Record<string, unknown>;
        push(record.excerpt);
        push(record.citation);
        push(record.quote);
        push(record.text);
      }
    }
  }

  return parts.join(" \n ");
}

/**
 * Confiances par motif d'inférence (toujours < 1, réservé au structuré).
 *  - explicit : précédé du mot « zone » → désambiguïsé, confiance haute.
 *  - hyphen   : format lettre(s)+tiret+chiffres (H-431, CEN-183, IDC-1).
 *  - compact  : format collé lettre(s)+chiffres (A16, I93, Rf51, RU1302).
 */
const INFERRED_CONFIDENCE = { explicit: 0.85, hyphen: 0.65, compact: 0.5 } as const;

// Motifs réinstanciés à chaque appel (reset de lastIndex). Miroir simplifié de
// api/src/services/geo/extract-refs.ts, en majuscule-tête pour éviter les faux
// positifs sur le texte français en minuscules et les identifiants de test.
//
// explicit : « zone C-18 », « zones H-42-1 » — le mot « zone » lève l'ambiguïté,
//   donc on tolère la casse (/i) mais on EXIGE un chiffre (pas « zone résidentielle »).
const ZONE_EXPLICIT_SRC =
  String.raw`\bzones?\s+([A-Za-z]{1,4}-?[0-9]{1,4}(?:-[0-9A-Za-z]{1,3})?)\b`;
// hyphen : « H-431 », « CEN-183 », « MxtV-4 » — lettre-tête majuscule + tiret obligatoire.
const ZONE_HYPHEN_SRC =
  String.raw`\b([A-Z][A-Za-z]{0,3}[0-9]{0,2}-[0-9A-Z]{1,6}(?:-[0-9A-Z]{1,4})?)\b`;
// compact : « A16 », « I93 », « Rf51 », « RU1302 » — lettre-tête majuscule + 2-5 chiffres collés.
const ZONE_COMPACT_SRC = String.raw`\b([A-Z][A-Za-z]{0,3}[0-9]{2,5})\b`;

/**
 * Balaye un texte libre et renvoie les codes de zone candidats.
 *
 * Garde-fou anti-règlement : un code immédiatement précédé d'un contexte
 * « règlement / concordance / résolution / annexe / article / numéro » ou d'un
 * préfixe numérique-tiret (ex. « 2009-Z-84 ») est ÉCARTÉ — c'est un numéro de
 * règlement de concordance, pas une zone (faux positif Z-94/Z-84 de l'audit).
 * Le motif « zone X » explicite n'est pas soumis à ce garde-fou.
 */
function scanZoneCodesFromText(text: string): InferredZoneCandidate[] {
  if (!text || text.trim().length === 0) return [];
  const out: InferredZoneCandidate[] = [];

  for (const match of text.matchAll(new RegExp(ZONE_EXPLICIT_SRC, "gi"))) {
    if (match[1]) out.push({ rawText: match[1].trim(), confidence: INFERRED_CONFIDENCE.explicit });
  }
  for (const match of text.matchAll(new RegExp(ZONE_HYPHEN_SRC, "g"))) {
    if (!match[1]) continue;
    if (isReglementContext(text.slice(Math.max(0, match.index - 30), match.index))) continue;
    out.push({ rawText: match[1].trim(), confidence: INFERRED_CONFIDENCE.hyphen });
  }
  for (const match of text.matchAll(new RegExp(ZONE_COMPACT_SRC, "g"))) {
    if (!match[1]) continue;
    if (isReglementContext(text.slice(Math.max(0, match.index - 30), match.index))) continue;
    out.push({ rawText: match[1].trim(), confidence: INFERRED_CONFIDENCE.compact });
  }

  return out;
}

/**
 * Vrai si le préfixe (texte juste avant le candidat) trahit un numéro de
 * règlement plutôt qu'un code de zone : mot-clé règlementaire immédiatement
 * accolé, ou suffixe numérique-tiret (« 2009-Z-84 », « 419-26 »).
 */
function isReglementContext(prefix: string): boolean {
  const tail = prefix.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/(reglement|concordance|resolution|annexe|article|chapitre|numero)\s*(?:n[o°]?\.?|#)?\s*[\w.-]*$/.test(tail)) {
    return true;
  }
  return /\d\s*-\s*$/.test(tail);
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

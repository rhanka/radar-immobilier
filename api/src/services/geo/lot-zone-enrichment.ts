/**
 * Enrichissement des lots OGC avec les données de zone — jointure en mémoire.
 *
 * ## Rôle (P0 parité carte Steve)
 * Les items `qc-lots-<city>` servis par /api/geo/collections/:id/items ne
 * portent aujourd'hui AUCUNE donnée de zone (live : NO_LOT/geoId/name/code
 * seulement ; store PG : zoneCode toujours null). Ce module joint chaque lot
 * à sa zone de zonage (`qc-zonage-<city>`) et dérive les flags réels
 * `multifamilial4plus` / `priorite` + l'objet `zone{...}` attendus par l'UI
 * (contrat LotProperties, ui/src/lib/maps/lots-client.ts).
 *
 * ## Stratégie de jointure (bornée, par requête)
 *   1. Par CODE : si le lot porte un code de zone explicite
 *      (zoneCode/zone_code/ZONE/zonage/...), lookup O(1) sur le code normalisé
 *      (normalizeZoneCode, extract-refs.ts). `zoneJoin: "code"`.
 *   2. Par CENTROÏDE : sinon, centroïde (shoelace) du polygone du lot →
 *      pré-filtre bbox des zones → point-dans-polygone (even-odd). En cas de
 *      chevauchement, la zone à la plus petite bbox (la plus spécifique) gagne.
 *      `zoneJoin: "centroid"`.
 * Les items lots sont déjà paginés/bbox par la route ; les zones (~100-300 par
 * ville) sont indexées une fois (bbox pré-calculées) et cachées côté route.
 *
 * ## Anti-invention
 *   - Zone introuvable → AUCUN champ zone/flag ajouté (absence honnête).
 *   - `tod` : transmis UNIQUEMENT si la source lots le porte déjà
 *     (tod/in_tod/inTod). Jamais fabriqué (aucune donnée TOD live aujourd'hui).
 *   - `priorite` : présent UNIQUEMENT si `multifamilial4plus` ET `tod`
 *     existent tous deux (= 4+ ∧ TOD).
 *   - `multifamilial4plusSource` expose la source de dérivation
 *     ("grille" | "heuristique") — voir scoring/zone-allows-4plus.ts.
 *   - `zone.densiteLogHa` / `zone.usages` : valeurs RÉELLES de la source de
 *     zonage uniquement (null / [] quand absentes — jamais l'estimation).
 *   - `zone.reglement{Numero,Millesime,PageSource,Url}` : provenance RÉELLE du
 *     règlement porté par la zone de norme (`qc-zonage-norms-<slug>`) — chaque
 *     champ null quand la source ne le porte pas ; jamais deviné.
 */

import { normalizeZoneCode } from "./extract-refs.js";
import {
  zoneKindFromCode,
  canonicalKindFromSimKind,
} from "./simulation/zone-kind.js";
import {
  zoneAllows4Plus,
  type ZoneAllows4PlusResult,
} from "../scoring/zone-allows-4plus.js";
import type { ZoneKind } from "../scoring/lot-potential.js";
import { superficieFromGeometry } from "./superficie.js";

// ─── Types GeoJSON minimaux (compatibles geo-features.ts / OGC brut) ──────────

export interface EnrichGeometry {
  type: string;
  coordinates?: unknown;
}

export interface EnrichFeature {
  type: string;
  geometry?: EnrichGeometry | null;
  properties?: Record<string, unknown> | null;
}

// ─── Index de zones ───────────────────────────────────────────────────────────

/** [minX, minY, maxX, maxY] en WGS84. */
type Bbox = [number, number, number, number];

export interface ZoneIndexEntry {
  /** Code de zone tel qu'affiché par la source (ex. "H-241"). */
  code: string;
  /** Code normalisé (clé de jointure). */
  codeNorm: string;
  /** Kind canonique (SPEC_DESIGN_DATA_MODEL §1.1). */
  kind: ZoneKind;
  /** Densité RÉELLE (log/ha) si la source de zonage la porte ; null sinon. */
  densiteLogHa: number | null;
  /** Usages RÉELS si la source de zonage les porte ; [] sinon. */
  usages: string[];
  /** Lien grille PDF si la source le porte (URL_GRILLE…) ; null sinon. */
  grillePdfUrl: string | null;
  /**
   * Provenance du règlement en vigueur qui porte la norme (zone de norme,
   * `qc-zonage-norms-<slug>`). Valeurs RÉELLES — null quand la source ne les
   * porte pas ; jamais fabriquées.
   */
  reglementNumero: string | null;
  reglementMillesime: number | null;
  reglementPageSource: string | null;
  reglementUrl: string | null;
  /** Géométrie pour la jointure spatiale ; null si absente. */
  geometry: EnrichGeometry | null;
  /** Bbox pré-calculée de la géométrie ; null si géométrie absente. */
  bbox: Bbox | null;
  /** Aire de la bbox (deg²) — départage des chevauchements. */
  bboxArea: number;
}

export interface ZoneIndex {
  byCodeNorm: Map<string, ZoneIndexEntry>;
  /** Zones avec géométrie, candidates à la jointure spatiale. */
  spatial: ZoneIndexEntry[];
  size: number;
}

/**
 * Mapping des kinds exposés par l'API geo OGC (anglais) vers le ZoneKind
 * canonique. Valeurs observées live (2026-07) : residential, commercial,
 * industrial, institutional, mixed-use, unknown.
 */
const OGC_KIND_TO_CANONICAL: Record<string, ZoneKind> = {
  residential: "H",
  "mixed-use": "MIXTE",
  mixed: "MIXTE",
  commercial: "C",
  industrial: "I",
  institutional: "P",
  public: "P",
  agricultural: "A",
  agriculture: "A",
  conservation: "CONS",
  recreation: "REC",
  recreative: "REC",
};

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

/** Valeur verbatim : chaîne non vide telle quelle, nombre fini rendu en chaîne. */
function firstVerbatim(values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = readString(value);
    if (parsed !== null) return parsed;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
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

/**
 * Kind canonique d'une zone : d'abord l'attribut `kind` de la source
 * (mapping anglais → canonique), sinon heuristique par préfixe du code
 * (zoneKindFromCode — la même que le mode carte-Steve).
 */
function canonicalZoneKind(
  props: Record<string, unknown>,
  code: string,
): ZoneKind {
  const rawKind = readString(props["kind"])?.toLowerCase() ?? null;
  const mapped = rawKind !== null ? OGC_KIND_TO_CANONICAL[rawKind] : undefined;
  if (mapped) return mapped;
  return canonicalKindFromSimKind(zoneKindFromCode(code));
}

/** Usages réels : tableau de strings, ou string délimitée (";" / ","). */
function realUsages(props: Record<string, unknown>): string[] {
  for (const key of ["usages", "usages_permis", "USAGES"]) {
    const raw = props[key];
    if (Array.isArray(raw)) {
      const arr = raw.map((u) => String(u).trim()).filter((u) => u.length > 0);
      if (arr.length > 0) return arr;
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw
        .split(/[;,]/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
    }
  }
  return [];
}

/**
 * Lien grille PDF porté par les properties d'une zone (mêmes clés candidates
 * que l'index de jointure — source de vérité UNIQUE, réutilisée par la
 * couverture qualité /api/source/coverage).
 */
export function zoneGrillePdfUrl(
  props: Record<string, unknown>,
): string | null {
  return firstString([
    props["grillePdfUrl"],
    props["grille_pdf_url"],
    props["URL_GRILLE"],
    props["url_grille"],
  ]);
}

/** Provenance du règlement portée par une zone de norme (grille). */
export interface ZoneReglementProvenance {
  /** Numéro de règlement (ex. "2008-102") ; null si non renseigné. */
  numero: string | null;
  /** Millésime du règlement (ex. 2008) ; null si absent. */
  millesime: number | null;
  /** Page source dans le PDF (verbatim) ; null si absente. */
  pageSource: string | null;
  /** Lien PDF source du règlement ; null si absent. */
  url: string | null;
}

/**
 * Provenance du règlement portée par les properties d'une zone (zone de norme,
 * `qc-zonage-norms-<slug>`). Jamais inventée : chaque champ est null quand la
 * source ne le porte pas. Source de vérité UNIQUE, réutilisée par l'index de
 * jointure et par le payload lot servi au front.
 */
export function zoneReglementProvenance(
  props: Record<string, unknown>,
): ZoneReglementProvenance {
  return {
    numero: firstString([
      props["reglementNumero"],
      props["reglement_numero"],
      props["REGLEMENT_NUMERO"],
    ]),
    millesime: firstNumber([
      props["reglementMillesime"],
      props["reglement_millesime"],
      props["REGLEMENT_MILLESIME"],
    ]),
    pageSource: firstVerbatim([
      props["reglementPageSource"],
      props["reglement_page_source"],
      props["REGLEMENT_PAGE_SOURCE"],
    ]),
    url: firstString([
      props["reglementUrl"],
      props["reglement_url"],
      props["REGLEMENT_URL"],
    ]),
  };
}

/**
 * Normes RÉELLES portées par les properties d'une zone (densité log/ha +
 * usages). Jamais inventées : densité null / usages [] quand la source ne les
 * porte pas. Mêmes clés candidates que l'index de jointure.
 */
export function zoneNormes(props: Record<string, unknown>): {
  densiteLogHa: number | null;
  usages: string[];
} {
  return {
    densiteLogHa: firstNumber([
      props["densiteLogHa"],
      props["densite_log_ha"],
      props["DENSITE_LOG_HA"],
      props["densite"],
      props["DENSITE"],
    ]),
    usages: realUsages(props),
  };
}

/** Bbox d'une géométrie GeoJSON (parcours récursif des coordonnées). */
function geometryBbox(geom: EnrichGeometry | null): Bbox | null {
  if (!geom || geom.coordinates === undefined) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
      const x = node[0];
      const y = node[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      found = true;
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geom.coordinates);

  return found ? [minX, minY, maxX, maxY] : null;
}

/**
 * Construit l'index de zones depuis une FeatureCollection de zonage.
 * Accepte les deux formes servies par la route :
 *   - store local PG (geo-features.ts : properties.zoneCode, …)
 *   - OGC live (properties.zone_code / ZONE / kind anglais / URL_GRILLE, …)
 * Les zones sans code exploitable sont ignorées (honnête).
 */
export function buildZoneIndex(fc: {
  features: EnrichFeature[];
}): ZoneIndex {
  const byCodeNorm = new Map<string, ZoneIndexEntry>();
  const spatial: ZoneIndexEntry[] = [];

  for (const feature of fc.features ?? []) {
    const props = feature.properties ?? {};
    const code = firstString([
      props["zoneCode"],
      props["zone_code"],
      props["ZONE_CODE"],
      props["NUM_ZONE"],
      props["NO_ZONAGE"],
      props["CODE_ZONE"],
      props["code_zone"],
      props["ZONE"],
      props["zone"],
      props["ZONAGE"],
      props["zonage"],
    ]);
    if (!code) continue;

    const codeNorm = normalizeZoneCode(code);
    if (!codeNorm) continue;

    const geometry = feature.geometry ?? null;
    const bbox = geometryBbox(geometry);

    const normes = zoneNormes(props);
    const provenance = zoneReglementProvenance(props);
    const entry: ZoneIndexEntry = {
      code,
      codeNorm,
      kind: canonicalZoneKind(props, code),
      densiteLogHa: normes.densiteLogHa,
      usages: normes.usages,
      grillePdfUrl: zoneGrillePdfUrl(props),
      reglementNumero: provenance.numero,
      reglementMillesime: provenance.millesime,
      reglementPageSource: provenance.pageSource,
      reglementUrl: provenance.url,
      geometry,
      bbox,
      bboxArea: bbox ? (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) : 0,
    };

    if (!byCodeNorm.has(codeNorm)) byCodeNorm.set(codeNorm, entry);
    if (bbox && geometry) spatial.push(entry);
  }

  return { byCodeNorm, spatial, size: byCodeNorm.size };
}

// ─── Jointure spatiale ────────────────────────────────────────────────────────

/** Point dans anneau (ray casting even-odd). */
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point dans polygone GeoJSON (Polygon ou MultiPolygon).
 * Even-odd sur tous les anneaux : les trous sont naturellement exclus.
 */
function pointInGeometry(
  x: number,
  y: number,
  geom: EnrichGeometry,
): boolean {
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    let count = 0;
    for (const ring of rings) {
      if (pointInRing(x, y, ring)) count++;
    }
    return count % 2 === 1;
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as number[][][][];
    for (const poly of polys) {
      let count = 0;
      for (const ring of poly) {
        if (pointInRing(x, y, ring)) count++;
      }
      if (count % 2 === 1) return true;
    }
  }
  return false;
}

/**
 * Centroïde (shoelace) de l'anneau extérieur du plus grand polygone.
 * Repli : moyenne des sommets si l'aire est dégénérée.
 * null si la géométrie n'est pas polygonale.
 */
export function lotCentroid(
  geom: EnrichGeometry | null,
): [number, number] | null {
  if (!geom) return null;

  let rings: number[][][] = [];
  if (geom.type === "Polygon") {
    rings = [((geom.coordinates as number[][][]) ?? [])[0] ?? []];
  } else if (geom.type === "MultiPolygon") {
    const polys = (geom.coordinates as number[][][][]) ?? [];
    rings = polys.map((p) => p[0] ?? []);
  } else {
    return null;
  }

  let best: [number, number] | null = null;
  let bestArea = -1;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let area = 0;
    let cx = 0;
    let cy = 0;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i]![0]!;
      const yi = ring[i]![1]!;
      const xj = ring[j]![0]!;
      const yj = ring[j]![1]!;
      const cross = xj * yi - xi * yj;
      area += cross;
      cx += (xj + xi) * cross;
      cy += (yj + yi) * cross;
    }
    area /= 2;
    const absArea = Math.abs(area);
    if (absArea < 1e-14) {
      // Aire dégénérée → moyenne des sommets
      if (bestArea < 0) {
        let sx = 0;
        let sy = 0;
        for (const pt of ring) {
          sx += pt[0]!;
          sy += pt[1]!;
        }
        best = [sx / n, sy / n];
        bestArea = 0;
      }
      continue;
    }
    if (absArea > bestArea) {
      best = [cx / (6 * area), cy / (6 * area)];
      bestArea = absArea;
    }
  }

  return best;
}

/** Résout la zone d'un lot par centroïde (bbox pré-filtre puis PIP). */
function zoneByCentroid(
  geometry: EnrichGeometry | null,
  index: ZoneIndex,
): ZoneIndexEntry | null {
  if (index.spatial.length === 0) return null;
  const centroid = lotCentroid(geometry);
  if (!centroid) return null;
  const [x, y] = centroid;

  let match: ZoneIndexEntry | null = null;
  for (const zone of index.spatial) {
    const b = zone.bbox!;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (!pointInGeometry(x, y, zone.geometry!)) continue;
    // Chevauchement : la zone la plus spécifique (plus petite bbox) gagne.
    if (match === null || zone.bboxArea < match.bboxArea) match = zone;
  }
  return match;
}

// ─── Enrichissement des lots ──────────────────────────────────────────────────

/** Codes de zone explicites possibles sur un item LOT (liste volontairement
 *  plus étroite que ZONE_CODE_ATTRS : pas de "code"/"CODE", qui sur un lot
 *  est le numéro de lot lui-même). */
const LOT_ZONE_CODE_KEYS = [
  "zoneCode",
  "zone_code",
  "ZONE_CODE",
  "zone_code_raw",
  "zoneCodeRaw",
  "ZONE",
  "zone",
  "zona",
  "ZONAGE",
  "zonage",
  "NO_ZONAGE",
  "NUM_ZONE",
  "CODE_ZONE",
  "code_zone",
] as const;

/** Résultat par lot, pour instrumentation/tests. */
export interface LotEnrichmentStats {
  total: number;
  joinedByCode: number;
  joinedByCentroid: number;
  unjoined: number;
}

/**
 * Enrichit (copie, sans muter l'entrée) les features lots avec la zone jointe
 * et les flags dérivés. Contrat des champs ajoutés : voir routes/geo-collections.ts.
 *
 * `index` null ou vide → seuls les champs indépendants de la zone sont ajoutés
 * (superficieM2 calculée, tod normalisé s'il existe déjà).
 */
export function enrichLotFeatures(
  features: EnrichFeature[],
  index: ZoneIndex | null,
): { features: EnrichFeature[]; stats: LotEnrichmentStats } {
  const stats: LotEnrichmentStats = {
    total: features.length,
    joinedByCode: 0,
    joinedByCentroid: 0,
    unjoined: 0,
  };

  const out = features.map((feature) => {
    const props: Record<string, unknown> = { ...(feature.properties ?? {}) };
    const geometry = feature.geometry ?? null;

    // ── superficieM2 : valeur source si présente, sinon calcul géométrique ──
    const rawSuperficie = firstNumber([
      props["superficieM2"],
      props["superficie_m2"],
      props["superficie_m2_calculee"],
    ]);
    const superficieM2 =
      rawSuperficie !== null && rawSuperficie > 0
        ? rawSuperficie
        : superficieFromGeometry(
            geometry && geometry.coordinates !== undefined
              ? { type: geometry.type, coordinates: geometry.coordinates }
              : null,
          );
    if (superficieM2 !== null) props["superficieM2"] = superficieM2;

    // ── tod : passthrough normalisé UNIQUEMENT si la donnée existe ──────────
    const tod = firstBoolean([props["tod"], props["inTod"], props["in_tod"]]);
    if (tod !== null) props["tod"] = tod;

    // ── Jointure zone ────────────────────────────────────────────────────────
    let zone: ZoneIndexEntry | null = null;
    let zoneJoin: "code" | "centroid" | null = null;

    if (index && index.size > 0) {
      const explicitCode = firstString(
        LOT_ZONE_CODE_KEYS.map((k) => props[k]),
      );
      if (explicitCode) {
        const norm = normalizeZoneCode(explicitCode);
        const hit = index.byCodeNorm.get(norm);
        if (hit) {
          zone = hit;
          zoneJoin = "code";
          stats.joinedByCode++;
        }
      }
      if (!zone) {
        zone = zoneByCentroid(geometry, index);
        if (zone) {
          zoneJoin = "centroid";
          stats.joinedByCentroid++;
        }
      }
    }

    if (zone && zoneJoin) {
      const derived: ZoneAllows4PlusResult = zoneAllows4Plus({
        kind: zone.kind,
        densiteLogHa: zone.densiteLogHa,
        usages: zone.usages,
      });

      props["zoneCode"] = zone.code;
      props["zone"] = {
        code: zone.code,
        kind: zone.kind,
        densiteLogHa: zone.densiteLogHa,
        usages: zone.usages,
        grillePdfUrl: zone.grillePdfUrl,
        reglementNumero: zone.reglementNumero,
        reglementMillesime: zone.reglementMillesime,
        reglementPageSource: zone.reglementPageSource,
        reglementUrl: zone.reglementUrl,
      };
      props["zoneJoin"] = zoneJoin;
      props["multifamilial4plus"] = derived.allows4Plus;
      props["multifamilial4plusSource"] = derived.confidence;

      // priorite = 4+ ∧ TOD — seulement si les DEUX existent.
      if (tod !== null) {
        props["priorite"] = derived.allows4Plus && tod;
      }
    } else {
      stats.unjoined++;
    }

    return { ...feature, properties: props };
  });

  return { features: out, stats };
}

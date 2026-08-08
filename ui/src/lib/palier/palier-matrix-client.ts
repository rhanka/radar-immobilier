/**
 * palier-matrix/v1 — couche DONNÉES de la vue Matrice (villes × KPI).
 *
 * Binding LIVE (lock conducteur « matrix-clientside-live ») :
 *  - Le SCOPE B (cohorte), le DÉNOMINATEUR et les cohortes de RÉCENCE se
 *    calculent CÔTÉ CLIENT depuis /api/graph-signals/by-city (date-aware, comme
 *    la vue Signaux). Dans le navigateur SSO de l'owner, ça rend SON 127/36 live.
 *    On NE hardcode PAS ces nombres depuis l'artefact offline recette.
 *  - Les CELLULES immo (kpi04 PV, kpi20 recall) + le flag priorité viennent de
 *    l'artefact recette EN RÉFÉRENCE hors-ligne (non autoritaire), embarqué en
 *    snapshot (`palier-immo-fallback.json`), matché par citySlug.
 *  - Les 17 KPI geo restent « à qualifier » tant que le mapping KPI→couche
 *    (/api/source/coverage) n'est pas livré (routé jointures).
 *
 * Copy produit NEUTRE (jamais 'unknown'/'honnête' client-facing) : statut de
 * cellule rendu « Complet / Partiel / À qualifier / N-A ».
 */

import {
  fetchGraphSignalsByCity,
  type GraphSignalCityItem,
  type GraphSignalsByCityResponse,
} from "$lib/signals/graph-signals-by-city-client.js";
import {
  B_SUBSET_KEY,
  countForVivierCity,
} from "$lib/signals/vivier-view-mode.js";
import {
  fetchSourceCoverage,
  type CityCoverage,
  type CoverageResponse,
  type CoverageState,
} from "$lib/sources/source-coverage-client.js";
import immoFallbackRaw from "./palier-immo-fallback.json";

export type PalierCellStatus = "complete" | "incomplete" | "unknown" | "na";

/** Libellé CLIENT neutre d'un statut de cellule. */
export function palierCellStatusLabel(status: PalierCellStatus): string {
  switch (status) {
    case "complete":
      return "Complet";
    case "incomplete":
      return "Partiel";
    case "unknown":
      return "À qualifier";
    case "na":
      return "N-A";
  }
}

/** Sous-ensemble affiché : A = palier-30, B = cohorte B live. */
export type PalierSubset = "A" | "B";

/** Bande de récence LIVE d'une ville B (fenêtre où elle est B). */
export type RecencyBand = "lt3mo" | "lt6mo" | "older";
/** Filtre de récence appliqué à l'affichage (le dénominateur % reste la cohorte B). */
export type RecencyFilter = "all" | "lt3mo" | "lt6mo";

export interface PalierKpi {
  /** Identifiant stable du KPI (colonne). */
  id: string;
  /** Libellé court affiché en en-tête de colonne. */
  label: string;
}

export interface PalierCell {
  kpiId: string;
  status: PalierCellStatus;
  /** Provenance par cellule (« réf. hors-ligne » pour immo) ; null sinon. */
  source?: string | null;
}

export interface PalierCityRow {
  citySlug: string;
  cityName: string;
  /** Une cellule par KPI (ordre = matrix.kpis). */
  cells: PalierCell[];
  /** Bande de récence LIVE (fenêtre where la ville est B). */
  recency?: RecencyBand;
  /** Flag priorité (réf. hors-ligne artefact recette). */
  isPriority?: boolean;
}

export interface PalierMatrix {
  contract: "palier-matrix/v1";
  subset: PalierSubset;
  /** Étiquette de provenance/limite affichée (jamais du jargon interne). */
  label: string;
  kpis: PalierKpi[];
  cities: PalierCityRow[];
  /** Dénominateur LIVE = nb villes B (base des %). Absent sur le placeholder. */
  denominator?: number;
  /** Comptes de récence LIVE (cohorte B par fenêtre). */
  recencyCounts?: { lt3mo: number; lt6mo: number; all: number };
  /** Nb villes B priorité (intersection cohorte B live × flag prio réf.). */
  priorityCount?: number;
  /** ISO de génération (fenêtres de récence calculées depuis là). */
  generatedAtIso?: string;
}

/** % de cellules « complètes » d'une ville (N-A exclus du dénominateur). */
export function cityResolvedPct(row: PalierCityRow): number {
  const scored = row.cells.filter((c) => c.status !== "na");
  if (scored.length === 0) return 0;
  const complete = scored.filter((c) => c.status === "complete").length;
  return Math.round((complete / scored.length) * 100);
}

/** % de villes « complètes » pour un KPI donné (barre de résolution par-KPI). */
export function kpiResolvedPct(matrix: PalierMatrix, kpiId: string): number {
  const cells = matrix.cities
    .map((row) => row.cells.find((c) => c.kpiId === kpiId))
    .filter((c): c is PalierCell => c != null && c.status !== "na");
  if (cells.length === 0) return 0;
  const complete = cells.filter((c) => c.status === "complete").length;
  return Math.round((complete / cells.length) * 100);
}

// ── 20 KPI (colonnes) — la maille geo. 2 immo (kpi04 live / kpi20 réf.) + 17
// dims geo dérivées du LIVE servi /api/source/coverage (mapping conducteur). ──
const IMMO_KPI4_ID = "kpi04";
const IMMO_KPI20_ID = "kpi20";

export const PALIER_KPIS_20: PalierKpi[] = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const id = `kpi${n}`;
  let label = `KPI ${n}`;
  if (id === IMMO_KPI4_ID) label = "KPI 04 · PV";
  if (id === IMMO_KPI20_ID) label = "KPI 20 · Recall";
  return { id, label };
});

// ── Fallback immo hors-ligne (réf. non autoritaire, artefact recette) ──
interface ImmoFallbackCity {
  citySlug: string;
  cityName: string;
  kpi4_pv: string | null;
  kpi20_recall: string | null;
  isPriority: boolean;
}
const immoFallback = immoFallbackRaw as unknown as { cities: ImmoFallbackCity[] };
const FALLBACK_BY_SLUG = new Map<string, ImmoFallbackCity>(
  immoFallback.cities.map((c) => [c.citySlug, c]),
);

/** Traduit une valeur de statut recette vers un statut de cellule neutre. */
function toCellStatus(value: string | null | undefined): PalierCellStatus {
  switch (value) {
    case "complete":
      return "complete";
    case "incomplete":
    case "partial":
      return "incomplete";
    case "na":
    case "n-a":
      return "na";
    default:
      return "unknown";
  }
}

// ── Cellules GEO depuis /api/source/coverage (17 dims servies) ────────────────
// Mapping kpi_id → couche coverage VERROUILLÉ par le conducteur
// (env 17dims-mapping-locked). Définitions = table VOLET B de
// PRESCORE_167_ET_PROMESSES_GEO.md (lane recette). L'assignation def→couche est
// la dérivation conducteur (validée recette). Les valeurs live par ville rendent
// dans la session SSO de l'owner ; en build/test le fetch coverage est 401 →
// couverture absente → cellules « à qualifier » honnêtes.

const IMMO_KPI14_ID = "kpi14";

/** Tri-état coverage → statut de cellule neutre. */
function triToStatus(state: CoverageState): PalierCellStatus {
  switch (state) {
    case "verified":
      return "complete";
    case "declared":
      return "incomplete";
    case "absent":
      return "unknown";
  }
}

/**
 * Statut dérivé d'un compte « X sur total » (sous-champ mesuré) : total absent
 * → à qualifier ; 0 → à qualifier (absent) ; complet si X ≥ total ; sinon
 * partiel. Sert aux sous-dimensions normes (grille/règlement/valeurs) et à la
 * citation des signaux.
 */
function countStatus(withN: number | null | undefined, total: number | null | undefined): PalierCellStatus {
  if (total == null || total <= 0 || withN == null) return "unknown";
  if (withN <= 0) return "unknown";
  return withN >= total ? "complete" : "incomplete";
}

/** Fraîcheur → statut (proxy provenance-qualité, best-effort). */
function freshnessToStatus(f: string | undefined): PalierCellStatus {
  if (f === "fresh") return "complete";
  if (f === "partial") return "incomplete";
  return "unknown";
}

/**
 * Cellule d'un KPI GEO pour une ville, dérivée de sa couverture servie (bulk
 * /api/source/coverage). `city` absent (ville hors couverture ou fetch 401) →
 * « à qualifier » honnête. Cas spéciaux du lock :
 *  - 07 (effet-densifiant) : N-A STRUCTUREL prouvé (0 avis + 0 cert MRC 137.3),
 *    jamais complete, exclu du dénominateur % ;
 *  - 10 (preuve-v2) : campagne longue → « en cours » (unknown honnête) ;
 *  - 14 (ontolot) : chaîne B non peuplée → unknown honnête ;
 *  - 08/09/11 : dérivés best-effort → source « dérivé à valider » (recette cc).
 * Sous-dimensions normes (03/05/06) : compte mesuré si présent en bulk, sinon
 * repli sur l'état bulk normes. Sous-champs lot (13/15/17/16) : repli sur l'état
 * bulk lotFields (la discrimination par champ = endpoint lazy /lot-fields, à
 * suivre — non servie en bulk).
 */
export function geoCellFor(kpiId: string, city: CityCoverage | undefined): PalierCell {
  const absent: PalierCell = { kpiId, status: "unknown", source: "couverture absente" };
  // Structurels : indépendants de la couverture servie.
  if (kpiId === "kpi07") return { kpiId, status: "na", source: "structurel" };
  if (kpiId === "kpi10") return { kpiId, status: "unknown", source: "en cours" };
  if (kpiId === IMMO_KPI14_ID) return { kpiId, status: "unknown", source: "structurel" };
  if (!city) return absent;
  const cov = "coverage";
  const derive = "dérivé à valider";
  switch (kpiId) {
    case "kpi01": // Zones-compl
      return { kpiId, status: triToStatus(city.l4Zonage.state), source: cov };
    case "kpi02": // Cohérence-lot-zone
      return { kpiId, status: triToStatus(city.l5Lots.state), source: cov };
    case "kpi03": // Normes-grille
      return {
        kpiId,
        status:
          city.normes.zonesWithGrille != null
            ? countStatus(city.normes.zonesWithGrille, city.normes.zoneCount)
            : triToStatus(city.normes.state),
        source: cov,
      };
    case "kpi05": // Règlement
      return {
        kpiId,
        status:
          city.normes.zonesWithReglement != null
            ? countStatus(city.normes.zonesWithReglement, city.normes.zoneCount)
            : triToStatus(city.normes.state),
        source: cov,
      };
    case "kpi06": // Usage-dom (valeurs normatives)
      return {
        kpiId,
        status:
          city.normes.zonesWithNormativeValues != null
            ? countStatus(city.normes.zonesWithNormativeValues, city.normes.zoneCount)
            : triToStatus(city.normes.state),
        source: cov,
      };
    case "kpi08": // Prov-jointure (provenance du zonage servi)
      return {
        kpiId,
        status:
          city.l4Zonage.servedBy === "geo"
            ? "complete"
            : city.l4Zonage.servedBy === "local"
              ? "incomplete"
              : "unknown",
        source: derive,
      };
    case "kpi09": // Prov-qualité (proxy fraîcheur extraction)
      return { kpiId, status: freshnessToStatus(city.l2Graph.freshness), source: derive };
    case "kpi11": // URL-source (signaux à citation)
      return {
        kpiId,
        status: countStatus(city.signals.withCitation, city.signals.count),
        source: derive,
      };
    case "kpi12": // Immo-assign-lot-zone
      return { kpiId, status: triToStatus(city.l5Lots.state), source: cov };
    case "kpi13": // Immo-normes-pliées (LOT_NORM)
    case "kpi15": // Surface
    case "kpi16": // Code-postal
    case "kpi17": // Adresse
      return { kpiId, status: triToStatus(city.lotFields?.state ?? "absent"), source: cov };
    case "kpi18": // TOD
    case "kpi19": // TOD (groupé 18/19)
      return { kpiId, status: triToStatus(city.tod.state), source: cov };
    default:
      return absent;
  }
}

/**
 * Compte bulk B d'une ville — EXACTEMENT le prédicat de la vue Signaux : on
 * réutilise `countForVivierCity` avec la clé B PAR DÉFAUT (« vivier-v2 » =
 * zonage ∩ résidentiel-éligible, précoce), et non une somme brute de
 * `stageCounts` (qui serait le périmètre L1 large, non résidentiel-éligible).
 * Garantit par construction que le dénominateur de la matrice == ce que l'owner
 * voit dans le rail Signaux (le 127/36 live). `countForVivierCity` garde
 * `!vivierV2Counts → 0` (pas de throw sur réponse partielle).
 */
export function cityBCount(item: GraphSignalCityItem): number {
  return countForVivierCity(item, B_SUBSET_KEY);
}

/** Ville B = compte bulk B > 0 (même prédicat que la vue Signaux). */
export function cityIsB(item: GraphSignalCityItem): boolean {
  return cityBCount(item) > 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENCY_LT3MO_DAYS = 91;
export const RECENCY_LT6MO_DAYS = 182;

function isoDaysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

const REC_RANK: Record<RecencyBand, number> = { lt3mo: 0, lt6mo: 1, older: 2 };

export interface BuildPalierMatrixLiveOptions {
  /** Injectable pour les tests ; défaut = fetch /api/graph-signals/by-city. */
  fetcher?: (opts: {
    dateFrom?: string | null;
    dateTo?: string | null;
  }) => Promise<GraphSignalsByCityResponse>;
  /** « Maintenant » (fenêtres de récence) ; défaut = new Date(). */
  now?: Date;
  subset?: PalierSubset;
  /**
   * Injectable pour les tests ; défaut = fetch /api/source/coverage. Sert les 17
   * dims geo par ville. Un échec (401 build/test, réseau) → couverture absente
   * → cellules geo « à qualifier » honnêtes (n'invalide PAS le scope B).
   */
  coverageFetcher?: () => Promise<CoverageResponse>;
}

/**
 * Construit la matrice depuis le LIVE servi : cohorte B + dénominateur +
 * récence = 3 fetchs by-city (all / −91j / −182j) ; cellules immo + priorité =
 * réf. hors-ligne matchée par citySlug. Dans le navigateur SSO de l'owner, le
 * dénominateur/récence rendent SON 127/36 live automatiquement.
 */
export async function buildPalierMatrixLive(
  opts: BuildPalierMatrixLiveOptions = {},
): Promise<PalierMatrix> {
  const fetcher =
    opts.fetcher ?? ((o) => fetchGraphSignalsByCity("", o));
  const now = opts.now ?? new Date();
  const subset = opts.subset ?? "B";

  // Fenêtres de récence BORNÉES en haut à « maintenant » : un signal daté dans
  // le FUTUR (séance de conseil planifiée) ne doit pas compter comme « récent »
  // (sinon il tomberait dans lt3mo via une borne haute ouverte). Le « all »
  // (dénominateur) reste non borné = all-time B, comme le rail Signaux.
  const today = isoDaysBefore(now, 0);
  // Coverage (17 dims geo) fetché EN PARALLÈLE du scope B. Son échec (401
  // build/test, réseau) ne doit PAS invalider la matrice : on retombe sur une
  // couverture vide → cellules geo « à qualifier » honnêtes.
  const coveragePromise = (opts.coverageFetcher ?? (() => fetchSourceCoverage()))().catch(
    () => null as CoverageResponse | null,
  );
  const [allResp, w3Resp, w6Resp, coverage] = await Promise.all([
    fetcher({}),
    fetcher({ dateFrom: isoDaysBefore(now, RECENCY_LT3MO_DAYS), dateTo: today }),
    fetcher({ dateFrom: isoDaysBefore(now, RECENCY_LT6MO_DAYS), dateTo: today }),
    coveragePromise,
  ]);

  const bSlugSet = (r: GraphSignalsByCityResponse): Set<string> =>
    new Set(r.cities.filter(cityIsB).map((c) => c.citySlug));
  const allB = allResp.cities.filter(cityIsB);
  const set3 = bSlugSet(w3Resp);
  const set6 = bSlugSet(w6Resp);
  const coverageBySlug = new Map<string, CityCoverage>(
    (coverage?.cities ?? []).map((c) => [c.citySlug, c]),
  );

  const rows: PalierCityRow[] = allB.map((item) => {
    const fb = FALLBACK_BY_SLUG.get(item.citySlug);
    const cov = coverageBySlug.get(item.citySlug);
    const recency: RecencyBand = set3.has(item.citySlug)
      ? "lt3mo"
      : set6.has(item.citySlug)
        ? "lt6mo"
        : "older";
    const cells: PalierCell[] = PALIER_KPIS_20.map((kpi) => {
      if (kpi.id === IMMO_KPI4_ID) {
        // KPI 04 · PV = LIVE (décision owner) : présence d'un PV/désignation =
        // la ville a des signaux servis (`signalCount` agrège Signal +
        // DesignationEvent, cf. by-city). Toute ligne de la matrice est B
        // (⊆ has-signal) → « complet » ici est la vérité live courante, et
        // corrige les « à qualifier » stale de la réf. hors-ligne (mesure
        // ~08-06) pour les villes qui ont des signaux MAINTENANT.
        return {
          kpiId: kpi.id,
          status: item.signalCount > 0 ? "complete" : "unknown",
          source: "live",
        };
      }
      if (kpi.id === IMMO_KPI20_ID) {
        // KPI 20 · Recall = PAS servi live (jointure émis-geo ↔ servi, absente
        // de by-city). Reste la réf. hors-ligne, honnêtement étiquetée (pas de
        // faux-live). À passer live si un endpoint sert le recall par ville.
        return { kpiId: kpi.id, status: toCellStatus(fb?.kpi20_recall), source: "réf. hors-ligne" };
      }
      // Les 17 dims geo = dérivées du LIVE servi /api/source/coverage (mapping
      // verrouillé conducteur). Ville hors couverture (ou 401 build/test) →
      // « à qualifier » honnête.
      return geoCellFor(kpi.id, cov);
    });
    return {
      citySlug: item.citySlug,
      cityName: fb?.cityName ?? item.citySlug,
      cells,
      recency,
      isPriority: fb?.isPriority ?? false,
    };
  });

  // Tri : priorité d'abord, puis récence (lt3mo < lt6mo < older), puis nom.
  rows.sort((a, b) => {
    const pa = a.isPriority ? 1 : 0;
    const pb = b.isPriority ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ra = REC_RANK[a.recency ?? "older"];
    const rb = REC_RANK[b.recency ?? "older"];
    if (ra !== rb) return ra - rb;
    return a.cityName.localeCompare(b.cityName, "fr");
  });

  const lt3 = allB.filter((c) => set3.has(c.citySlug)).length;
  const lt6 = allB.filter((c) => set6.has(c.citySlug)).length;

  return {
    contract: "palier-matrix/v1",
    subset,
    label: "dénominateur B live · 17 dims geo servies (coverage) · KPI 04 live · KPI 20 réf. hors-ligne",
    kpis: PALIER_KPIS_20,
    cities: rows,
    denominator: allB.length,
    recencyCounts: { lt3mo: lt3, lt6mo: lt6, all: allB.length },
    priorityCount: rows.filter((r) => r.isPriority).length,
    generatedAtIso: now.toISOString(),
  };
}

/**
 * PLACEHOLDER honnête (fallback proxy-immo) : petit sous-ensemble B étiqueté
 * « proxy immo geo-lot pending ». Sert au RENDU tant que le live n'est pas
 * disponible (ex. build/test sans session). Ce n'est PAS la matrice live.
 */
const PROXY_KPIS: PalierKpi[] = [
  { id: "kpi01", label: "KPI 01" },
  { id: "kpi02", label: "KPI 02" },
  { id: "kpi03", label: "KPI 03" },
  { id: "kpi04", label: "KPI 04" },
];

const PROXY_CITIES: Array<{ slug: string; name: string; pattern: PalierCellStatus[] }> = [
  { slug: "lery", name: "Léry", pattern: ["complete", "incomplete", "unknown", "na"] },
  { slug: "saint-jean-baptiste", name: "Saint-Jean-Baptiste", pattern: ["complete", "complete", "incomplete", "na"] },
  { slug: "saint-mathieu", name: "Saint-Mathieu", pattern: ["complete", "incomplete", "incomplete", "unknown"] },
  { slug: "howick", name: "Howick", pattern: ["incomplete", "unknown", "unknown", "na"] },
  { slug: "saint-urbain-premier", name: "Saint-Urbain-Premier", pattern: ["complete", "unknown", "na", "na"] },
  { slug: "cote-saint-luc", name: "Côte-Saint-Luc", pattern: ["incomplete", "incomplete", "unknown", "unknown"] },
  { slug: "hemmingford", name: "Hemmingford", pattern: ["unknown", "unknown", "na", "na"] },
];

export function proxyImmoPlaceholderMatrix(subset: PalierSubset = "B"): PalierMatrix {
  return {
    contract: "palier-matrix/v1",
    subset,
    label: "proxy immo geo-lot pending",
    kpis: PROXY_KPIS,
    cities: PROXY_CITIES.map((c) => ({
      citySlug: c.slug,
      cityName: c.name,
      cells: PROXY_KPIS.map((kpi, i) => ({
        kpiId: kpi.id,
        status: c.pattern[i] ?? "unknown",
        source: null,
      })),
    })),
  };
}

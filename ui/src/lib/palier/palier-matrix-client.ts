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

// ── 20 KPI (colonnes) — la maille geo. 2 immo bindées (kpi04/kpi20), les 17
// geo restent « à qualifier » tant que le mapping KPI→couche n'est pas livré. ──
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

/** Somme des étapes du périmètre B servi (L1 inPerim) d'une ville. */
export function cityBStageSum(item: GraphSignalCityItem): number {
  const counts = item.vivierV2Counts;
  if (!counts) return 0;
  return Object.values(counts.stageCounts).reduce(
    (acc, v) => acc + (typeof v === "number" ? v : 0),
    0,
  );
}

/** Ville B (périmètre servi L1) = au moins une étape zonage non exclue. */
export function cityIsB(item: GraphSignalCityItem): boolean {
  return cityBStageSum(item) > 0;
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
  }) => Promise<GraphSignalsByCityResponse>;
  /** « Maintenant » (fenêtres de récence) ; défaut = new Date(). */
  now?: Date;
  subset?: PalierSubset;
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

  const [allResp, w3Resp, w6Resp] = await Promise.all([
    fetcher({}),
    fetcher({ dateFrom: isoDaysBefore(now, RECENCY_LT3MO_DAYS) }),
    fetcher({ dateFrom: isoDaysBefore(now, RECENCY_LT6MO_DAYS) }),
  ]);

  const bSlugSet = (r: GraphSignalsByCityResponse): Set<string> =>
    new Set(r.cities.filter(cityIsB).map((c) => c.citySlug));
  const allB = allResp.cities.filter(cityIsB);
  const set3 = bSlugSet(w3Resp);
  const set6 = bSlugSet(w6Resp);

  const rows: PalierCityRow[] = allB.map((item) => {
    const fb = FALLBACK_BY_SLUG.get(item.citySlug);
    const recency: RecencyBand = set3.has(item.citySlug)
      ? "lt3mo"
      : set6.has(item.citySlug)
        ? "lt6mo"
        : "older";
    const cells: PalierCell[] = PALIER_KPIS_20.map((kpi) => {
      if (kpi.id === IMMO_KPI4_ID) {
        return { kpiId: kpi.id, status: toCellStatus(fb?.kpi4_pv), source: "réf. hors-ligne" };
      }
      if (kpi.id === IMMO_KPI20_ID) {
        return { kpiId: kpi.id, status: toCellStatus(fb?.kpi20_recall), source: "réf. hors-ligne" };
      }
      return { kpiId: kpi.id, status: "unknown", source: null };
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
    label: "dénominateur B live · KPI immo réf. hors-ligne",
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

/**
 * palier-matrix/v1 — couche DONNÉES de la vue Matrice (villes × KPI).
 *
 * Scaffold #1/#1b : la matrice intégrée 20/20 (17 KPI + score Steve geo-servis
 * joints par recette) n'est pas encore livrée. On définit ici le CONTRAT typé
 * palier-matrix/v1 + un builder de PLACEHOLDER honnêtement étiqueté (fallback
 * proxy-immo recette). Dès que l'artefact recette (joint geo) est disponible,
 * on binde `fetchPalierMatrix` dessus sans changer la vue.
 *
 * Copy produit NEUTRE (jamais 'unknown'/'honnête' client-facing) : le statut de
 * cellule est rendu « complet / partiel / à qualifier / N-A ».
 */

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

/** Sous-ensemble affiché : A = palier-30, B = 167. */
export type PalierSubset = "A" | "B";

export interface PalierKpi {
  /** Identifiant stable du KPI (colonne). */
  id: string;
  /** Libellé court affiché en en-tête de colonne. */
  label: string;
}

export interface PalierCell {
  kpiId: string;
  status: PalierCellStatus;
  /** Provenance par cellule (geo/recette) quand connue ; null sinon. */
  source?: string | null;
}

export interface PalierCityRow {
  citySlug: string;
  cityName: string;
  /** Une cellule par KPI (ordre = matrix.kpis). */
  cells: PalierCell[];
}

export interface PalierMatrix {
  contract: "palier-matrix/v1";
  subset: PalierSubset;
  /**
   * Étiquette de provenance/limite affichée à l'utilisateur (jamais du jargon
   * interne). Ex. « proxy immo geo-lot pending » quand la jointure geo (17 KPI
   * + score Steve) n'est pas encore intégrée.
   */
  label: string;
  kpis: PalierKpi[];
  cities: PalierCityRow[];
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

/**
 * PLACEHOLDER honnête (fallback proxy-immo recette) : petit sous-ensemble B des
 * 7 villes z∩m∩p, étiqueté « proxy immo geo-lot pending ». Sert à valider le
 * RENDU de la matrice tant que l'artefact recette (jointure geo) n'est pas là.
 * Ce n'est PAS la matrice 20/20 intégrée — l'étiquette le dit à l'écran.
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

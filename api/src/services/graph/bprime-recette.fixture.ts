import type { GraphifyNode, GraphSignalProjectionRow } from "./graph-store.js";
import { buildNodeRow } from "./graph-store.js";
import { SUTTON_LEGACY_GRAPH_NODES } from "./sutton-legacy.fixture.js";
import { COATICOOK_LEGACY_GRAPH_NODES } from "./coaticook-legacy.fixture.js";

/**
 * Fixtures de la recette B′ × Steve-30 — DONNÉES RÉELLES UNIQUEMENT.
 *
 * Contrat : docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md.
 *
 * ANTI-INVENTION (correctif de la revue NO-GO) : plus AUCUNE fixture fabriquée.
 * L'accès S3/SCW aux projections `graph/<slug>/latest.json` N'EST PAS configuré
 * dans ce worktree (ni rclone `scw:` ni credentials s5cmd) → on NE fabrique
 * RIEN. Les seules villes prouvables HORS-LIGNE sont celles dont les nœuds de
 * graphe RÉELS sont déjà committés :
 *
 *   - Sutton    → api/src/services/graph/sutton-legacy.fixture.ts
 *                 (5 nœuds réels de graph/sutton/latest.json, 2026-07-14)
 *   - Coaticook → api/src/services/graph/coaticook-legacy.fixture.ts
 *                 (1 nœud réel de graph/coaticook/latest.json, 2026-07-15)
 *
 * Toutes les autres villes du contrat (Saint-Stanislas, Saint-Raphaël,
 * Saint-Gilbert, Rosemère, Saint-Charles-Borromée, Rimouski, …) N'ONT PAS de
 * nœud de graphe committé → elles sont marquées `provable: false` et EXCLUES
 * des assertions vertes de la recette (voir `BPRIME_RECETTE_OFFLINE_GAPS`).
 * Leur preuve finale sera la QA prod (données réelles servies par l'endpoint).
 *
 * Le compte de recette est mesuré par le VRAI chemin serveur :
 * `aggregateGraphSignalProjectionRows` (identique à `listCitiesWithSignalNodes`)
 * → `vivierV2Counts`. Le badge rail de la vue B (précoce) =
 * `stageCounts.avis_motion + stageCounts.projet_reglement` — c'est exactement ce
 * que lit `ui/.../vivier-view-mode.ts countForVivierCity` (parité prouvée côté
 * UI dans vivier-view-mode.test.ts).
 */

/**
 * Reproduit FIDÈLEMENT la projection SQL de `listCitiesWithSignalNodes`
 * (`props->'properties'->>'x'`) à partir d'un nœud de graphe réel : on passe par
 * `buildNodeRow` (le même builder que l'ingestion) puis on extrait les champs
 * plats comme le fait la requête. Aucune donnée inventée — juste le nœud réel
 * remis en forme de ligne de projection.
 */
function jsonbText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function projectionRowFromGraphNode(
  node: GraphifyNode,
  citySlug: string,
): GraphSignalProjectionRow {
  const nodeRow = buildNodeRow(node, citySlug);
  const props = (nodeRow.props ?? {}) as Record<string, unknown>;
  const properties = (props.properties ?? {}) as Record<string, unknown>;
  return {
    id: nodeRow.id,
    citySlug,
    type: nodeRow.type,
    category: jsonbText(properties.category),
    label: nodeRow.label ?? "",
    nbUnitesMax: jsonbText(properties.nb_unites_max),
    intensite: jsonbText(properties.intensite),
    description: jsonbText(properties.description),
    etapeAnnote: jsonbText(properties.etape),
    props: nodeRow.props,
    sourceRef: nodeRow.sourceRef,
  };
}

/** Lignes de projection RÉELLES fournies au chemin serveur de la recette. */
export const BPRIME_RECETTE_ROWS: readonly GraphSignalProjectionRow[] = [
  ...SUTTON_LEGACY_GRAPH_NODES.map((node) => projectionRowFromGraphNode(node, "sutton")),
  ...COATICOOK_LEGACY_GRAPH_NODES.map((node) => projectionRowFromGraphNode(node, "coaticook")),
];

/**
 * Attendu de recette PROUVABLE HORS-LIGNE (colonne « B′ (cible) » du contrat),
 * métrique = badge B précoce sur les nœuds RÉELS.
 */
export interface RecetteExpectation {
  citySlug: string;
  label: string;
  /** Compte contractuel « B′ (cible) » (peut dépendre de nœuds hors fixture). */
  contractBPrime: number;
  /** Compte prouvable sur les nœuds RÉELS committés de ce worktree. */
  provableBPrime: number;
  rule: string;
  /** Le compte contractuel exact est-il atteignable avec les nœuds committés ? */
  provable: boolean;
  note: string;
}

export const BPRIME_RECETTE_EXPECTATIONS: readonly RecetteExpectation[] = [
  {
    citySlug: "sutton",
    label: "Sutton",
    contractBPrime: 2,
    provableBPrime: 2,
    rule: "R1+R2 (permissif, sans gate)",
    provable: true,
    note:
      "5 nœuds réels. La PAIRE refonte (event + signal, projet_reglement, " +
      "résidentiel=indéterminé) remonte via le PÉRIMÈTRE permissif — PAS via un " +
      "forçage refonte→oui. Le CPTAQ agricole reste exclu, PPCMOI/usage " +
      "conditionnel restent hors étape précoce.",
  },
  {
    citySlug: "coaticook",
    label: "Coaticook",
    contractBPrime: 2,
    provableBPrime: 1,
    rule: "— (non-régression)",
    provable: false,
    note:
      "1 SEUL nœud réel committé (PPCMOI RD-104, 12 logements, projet_reglement, " +
      "résidentiel=oui → qualifié). Le contrat vise ✓2 (2 nœuds en PROD) : le 2ᵉ " +
      "nœud n'est pas dans la fixture legacy → ✓2 NON prouvable hors-ligne. On " +
      "prouve seulement le nœud disponible (✓1) ; ✓2 = QA prod.",
  },
];

/**
 * Villes du contrat NON prouvables hors-ligne (aucun nœud de graphe committé,
 * ou texte réel absent). EXCLUES des assertions vertes ; preuve = QA prod.
 * Anti-invention : on les DÉCLARE au lieu de les fabriquer.
 */
export interface OfflineGap {
  label: string;
  contractBPrime: string;
  reason: string;
}

export const BPRIME_RECETTE_OFFLINE_GAPS: readonly OfflineGap[] = [
  {
    label: "Saint-Stanislas-de-Kostka",
    contractBPrime: "✓2 (refonte 451-2025)",
    reason: "Aucun nœud de graphe committé (S3 non accessible). Refonte non sourçable hors-ligne.",
  },
  {
    label: "Saint-Raphaël",
    contractBPrime: "✓2 (refonte 2026-244)",
    reason: "Aucun nœud de graphe committé (S3 non accessible). Refonte non sourçable hors-ligne.",
  },
  {
    label: "Saint-Gilbert",
    contractBPrime: "✓2 (R1 récupère le 2ᵉ signal)",
    reason: "Aucun nœud de graphe committé (S3 non accessible).",
  },
  {
    label: "Rimouski",
    contractBPrime: "✓1 (SPAR reste, pôle retiré)",
    reason:
      "steve30/dataset.ts marque `signal_unavailable` ; aucun nœud de graphe " +
      "committé. Ni SPAR ni le « pôle » ne sont sourçables hors-ligne.",
  },
  {
    label: "Rosemère",
    contractBPrime: "✗0 (faux positif attendu, R3/R4)",
    reason:
      "Le PV RÉEL 801-71 (proces-verbaux-rosemere.fixture.ts) est un « Règlement " +
      "de concordance … relatif au pôle régional » — PAS la « densification " +
      "commerciale » fabriquée dans l'ancienne fixture. Le texte réel ne porte " +
      "aucun marqueur franc-commercial ni « pôle COMMERCIAL régional » : le filtre " +
      "déterministe le classe donc `indéterminé` (périmètre à confirmer), il n'est " +
      "PAS lexicalement ✗0 sans une règle sur-large qui exclurait à tort de vrais " +
      "signaux. ✗0 = jugement sémantique (geo) → QA prod, PAS une invention lexicale.",
  },
  {
    label: "Saint-Charles-Borromée",
    contractBPrime: "✗0 (faux positif attendu, R3)",
    reason:
      "Aucun texte de PV réel committé. Le PATTERN « zone résidentielle → " +
      "commerciale » est prouvé exclu au niveau lexical (b-prime.test.ts), mais " +
      "la ville elle-même n'est pas sourçable hors-ligne.",
  },
  {
    label: "Saint-Raymond / Saint-Boniface / Saint-Mathieu-de-Beloeil / Saint-Amable / Mont-Saint-Hilaire",
    contractBPrime: "≥6/10 (divers)",
    reason:
      "Aucun nœud de graphe committé (les PV bruts éventuels ne sont pas des " +
      "projections de graphe et exigeraient l'extraction LLM). Preuve = QA prod.",
  },
];

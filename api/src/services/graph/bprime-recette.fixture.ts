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
 * Les 30 villes du CONTRAT (docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md,
 * table de recette lignes 1..30). SOURCE de la partition exhaustive : CHAQUE
 * ligne doit avoir soit une SOURCE RÉELLE committée (`BPRIME_RECETTE_EXPECTATIONS`
 * avec `provableBPrime > 0`), soit un GAP QA-PROD explicite (`OFFLINE_GAPS`).
 * La colonne « B′ (cible) » est l'attendu de réception — validée VILLE PAR VILLE
 * en QA prod (voir statut CIBLE du contrat), pas offline.
 */
export interface ContractCity {
  slug: string;
  label: string;
  noteSteve: string;
  targetBPrime: string;
}

export const BPRIME_STEVE30_CONTRACT_CITIES: readonly ContractCity[] = [
  { slug: "saint-stanislas-de-kostka", label: "Saint-Stanislas-de-Kostka", noteSteve: "10", targetBPrime: "✓2" },
  { slug: "sutton", label: "Sutton", noteSteve: "10", targetBPrime: "✓2" },
  { slug: "saint-raphael", label: "Saint-Raphaël", noteSteve: "10", targetBPrime: "✓2" },
  { slug: "saint-raymond", label: "Saint-Raymond", noteSteve: "9", targetBPrime: "✓4" },
  { slug: "saint-boniface", label: "Saint-Boniface", noteSteve: "8", targetBPrime: "✓1" },
  { slug: "coaticook", label: "Coaticook", noteSteve: "8", targetBPrime: "✓2" },
  { slug: "saint-mathieu-de-beloeil", label: "Saint-Mathieu-de-Beloeil", noteSteve: "7", targetBPrime: "✓2" },
  { slug: "saint-amable", label: "Saint-Amable", noteSteve: "7", targetBPrime: "✓3" },
  { slug: "mont-saint-hilaire", label: "Mont-Saint-Hilaire", noteSteve: "0 et 7", targetBPrime: "✓2" },
  { slug: "saint-gilbert", label: "Saint-Gilbert", noteSteve: "6", targetBPrime: "✓2" },
  { slug: "neuville", label: "Neuville", noteSteve: "4", targetBPrime: "✗0" },
  { slug: "saint-come-liniere", label: "Saint-Côme-Linière", noteSteve: "3", targetBPrime: "✓1" },
  { slug: "rosemere", label: "Rosemère", noteSteve: "2", targetBPrime: "✗0" },
  { slug: "petite-riviere-saint-francois", label: "Petite-Rivière-St-François", noteSteve: "2", targetBPrime: "✓3" },
  { slug: "stratford", label: "Stratford", noteSteve: "0", targetBPrime: "✗0" },
  { slug: "mont-tremblant", label: "Mont-Tremblant", noteSteve: "non pertinent", targetBPrime: "✓3" },
  { slug: "saint-frederic", label: "Saint-Frédéric", noteSteve: "non rés.", targetBPrime: "✓2" },
  { slug: "saint-charles-borromee", label: "Saint-Charles-Borromée", noteSteve: "non pertinent", targetBPrime: "✗0" },
  { slug: "sainte-cecile-de-milton", label: "Sainte-Cécile-de-Milton", noteSteve: "pas d'opp.", targetBPrime: "✓2" },
  { slug: "cowansville", label: "Cowansville", noteSteve: "promoteur", targetBPrime: "✓2" },
  { slug: "champlain", label: "Champlain", noteSteve: "assouplissement", targetBPrime: "✓2" },
  { slug: "sainte-catherine", label: "Sainte-Catherine", noteSteve: "bug « indispo »", targetBPrime: "✗0" },
  { slug: "hemmingford", label: "Hemmingford", noteSteve: "bug", targetBPrime: "0/0/1" },
  { slug: "plaisance", label: "Plaisance", noteSteve: "bug", targetBPrime: "✓3" },
  { slug: "notre-dame-de-lourdes", label: "Notre-Dame-de-Lourdes", noteSteve: "bug", targetBPrime: "2/2" },
  { slug: "chelsea", label: "Chelsea", noteSteve: "bug", targetBPrime: "✓2" },
  { slug: "alma", label: "Alma", noteSteve: "bug", targetBPrime: "✓2" },
  { slug: "preissac", label: "Preissac", noteSteve: "bug", targetBPrime: "✗0" },
  { slug: "rimouski", label: "Rimouski", noteSteve: "bug", targetBPrime: "✓1" },
  { slug: "la-sarre", label: "La Sarre", noteSteve: "bug", targetBPrime: "✓1" },
];

/**
 * Villes du contrat NON entièrement prouvables hors-ligne (aucun nœud de graphe
 * committé, ou texte réel absent). EXCLUES des assertions vertes ; preuve = QA
 * prod. Anti-invention : on les DÉCLARE au lieu de les fabriquer. `slugs` rend
 * la couverture ADRESSABLE PAR VILLE pour la partition exhaustive des 30 lignes.
 */
export interface OfflineGap {
  slugs: readonly string[];
  label: string;
  contractBPrime: string;
  reason: string;
}

const NO_NODE = "Aucun nœud de graphe committé (S3/SCW non accessible dans ce worktree). Preuve = QA prod.";

export const BPRIME_RECETTE_OFFLINE_GAPS: readonly OfflineGap[] = [
  {
    slugs: ["saint-stanislas-de-kostka"],
    label: "Saint-Stanislas-de-Kostka",
    contractBPrime: "✓2 (refonte 451-2025)",
    reason: "Refonte précoce non sourçable hors-ligne. " + NO_NODE,
  },
  {
    slugs: ["saint-raphael"],
    label: "Saint-Raphaël",
    contractBPrime: "✓2 (refonte 2026-244)",
    reason: "Refonte précoce non sourçable hors-ligne. " + NO_NODE,
  },
  {
    slugs: ["saint-gilbert"],
    label: "Saint-Gilbert",
    contractBPrime: "✓2 (R1 récupère le 2ᵉ signal)",
    reason: "R1 à re-vérifier sur données réelles. " + NO_NODE,
  },
  {
    slugs: ["coaticook"],
    label: "Coaticook (✓2 résiduel — ✓1 prouvé offline)",
    contractBPrime: "✓2 (2ᵉ nœud en prod)",
    reason:
      "✓1 est PROUVÉ offline (1 nœud réel committé, cf. BPRIME_RECETTE_EXPECTATIONS). " +
      "Le ✓2 du contrat suppose un 2ᵉ nœud présent en PROD mais non committé ici → " +
      "résiduel non prouvable hors-ligne. Preuve du 2ᵉ = QA prod.",
  },
  {
    slugs: ["saint-raymond", "saint-boniface", "saint-mathieu-de-beloeil", "saint-amable", "mont-saint-hilaire"],
    label: "Saint-Raymond / Saint-Boniface / Saint-Mathieu-de-Beloeil / Saint-Amable / Mont-Saint-Hilaire",
    contractBPrime: "≥6/10 (divers)",
    reason:
      "Villes notées ≥6/10 sans nœud de graphe committé (les PV bruts éventuels ne " +
      "sont pas des projections de graphe et exigeraient l'extraction LLM). " + NO_NODE,
  },
  {
    slugs: ["saint-frederic", "sainte-cecile-de-milton", "notre-dame-de-lourdes"],
    label: "Saint-Frédéric / Sainte-Cécile-de-Milton / Notre-Dame-de-Lourdes",
    contractBPrime: "R1 ajoute l'event",
    reason: "Gain R1 à re-vérifier sur données réelles. " + NO_NODE,
  },
  {
    slugs: [
      "saint-come-liniere", "petite-riviere-saint-francois", "mont-tremblant", "cowansville",
      "champlain", "hemmingford", "plaisance", "chelsea", "alma", "la-sarre",
    ],
    label: "Saint-Côme-Linière / Petite-Rivière-St-François / Mont-Tremblant / Cowansville / Champlain / Hemmingford / Plaisance / Chelsea / Alma / La Sarre",
    contractBPrime: "inchangé B→B′ (divers)",
    reason: "Comptes attendus inchangés entre B et B′, mais non vérifiables offline. " + NO_NODE,
  },
  {
    slugs: ["neuville", "stratford", "preissac", "sainte-catherine"],
    label: "Neuville / Stratford / Preissac / Sainte-Catherine",
    contractBPrime: "✗0 (souhaité)",
    reason:
      "Cible ✗0 (aucune opportunité attendue). Sans nœud committé, l'absence ne se " +
      "prouve pas non plus offline. " + NO_NODE,
  },
  {
    slugs: ["rimouski"],
    label: "Rimouski",
    contractBPrime: "✓1 (SPAR reste, pôle retiré)",
    reason:
      "steve30/dataset.ts marque `signal_unavailable` ; aucun nœud de graphe " +
      "committé. Ni SPAR ni le « pôle » ne sont sourçables hors-ligne. Preuve = QA prod.",
  },
  {
    slugs: ["rosemere"],
    label: "Rosemère",
    contractBPrime: "✗0 (cible NON atteignable côté immo)",
    reason:
      "CIBLE ✗0 NON ATTEIGNABLE côté immo. Le PV RÉEL 801-71 " +
      "(proces-verbaux-rosemere.fixture.ts) est un « Règlement de concordance … " +
      "relatif au pôle régional » — SANS marqueur franc-commercial ni « pôle " +
      "COMMERCIAL régional ». Le filtre déterministe le classe honnêtement " +
      "`indéterminé` : on REFUSE de fabriquer un marqueur pour forcer ✗0. " +
      "L'exclusion relève d'un marquage SÉMANTIQUE GEO (pôle régional/commercial) " +
      "à venir → EN ATTENTE geo, PAS une règle lexicale immo.",
  },
  {
    slugs: ["saint-charles-borromee"],
    label: "Saint-Charles-Borromée",
    contractBPrime: "✗0 (cible NON atteignable côté immo)",
    reason:
      "CIBLE ✗0 NON ATTEIGNABLE côté immo hors-ligne. Le PATTERN « zone " +
      "résidentielle → commerciale » est prouvé exclu au niveau lexical " +
      "(b-prime.test.ts), mais AUCUN texte de PV réel de la ville n'est committé, " +
      "et la distinction directionnelle fine relève d'un marquage SÉMANTIQUE GEO → " +
      "EN ATTENTE geo, jamais une exclusion fabriquée.",
  },
];

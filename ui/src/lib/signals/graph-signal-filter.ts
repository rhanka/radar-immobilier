/**
 * Helpers de filtrage client pour les nœuds GraphSignal.
 *
 * Partagé entre SignauxSelPanel (panneau droit) et SignauxRail (drawer gauche)
 * pour garantir que les deux appliquent le même filtre actif.
 *
 * Anti-invention : pas d'appel API — filtre purement calculé côté client
 * à partir des props du nœud.
 */
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

/** Miroir client des catégories de zonage (cf. ZONAGE_CATEGORIES serveur). */
const ZONAGE_CATEGORIES_CLIENT = new Set([
  "rezonage",
  "derogation",
  "derogation_mineure",
  "piia",
  "cptaq",
  "ppcmoi",
  "lotissement",
  "subdivision",
  "densification",
  "usage_conditionnel",
  "modification_zonage",
  "changement_usage",
  "zone_agricole",
  "contrainte_reglementaire",
  "patrimoine",
]);

function nodeProps(node: GraphSignalNode): Record<string, unknown> {
  const props = node.props;
  const nested =
    props.properties !== null && typeof props.properties === "object"
      ? (props.properties as Record<string, unknown>)
      : props;
  return nested;
}

export function nodeIsZonage(node: GraphSignalNode): boolean {
  if (node.type === "DesignationEvent") return true;
  if (node.type !== "Signal") return false;
  const nested = nodeProps(node);
  const category = typeof nested.category === "string" ? nested.category : null;
  if (category !== null && ZONAGE_CATEGORIES_CLIENT.has(category)) return true;
  // #4 — repli sur l'étape annotée (v2.1) quand `category` est NULL (cas
  // majoritaire en prod). Miroir client de isZonageSignal côté API : tester
  // category OU etape, sur le même vocabulaire de zonage.
  const etape = typeof nested.etape === "string" ? nested.etape : null;
  return etape !== null && ZONAGE_CATEGORIES_CLIENT.has(etape);
}

export function nodeIsMulti4(node: GraphSignalNode): boolean {
  const nested = nodeProps(node);
  const nbUnites = nested.nb_unites_max ?? nested.nbUnitesMax;
  if (typeof nbUnites === "string") {
    const parsed = parseFloat(nbUnites);
    if (!isNaN(parsed) && parsed >= 4) return true;
  }
  if (typeof nbUnites === "number" && nbUnites >= 4) return true;
  return (
    typeof nested.intensite === "string" && nested.intensite === "haute"
  );
}

/**
 * Retourne true si le nœud passe le filtre défini par `subsetKey`.
 *
 * `subsetKey` est une clé combinant les axes actifs :
 *   ""     → aucun filtre, tout passe
 *   "z"    → zonage uniquement
 *   "m"    → multifamilial 4+ uniquement
 *   "p"    → signaux précoces (heuristique légère, ne masque pas)
 *   "z|m"  → intersection zonage ET multi4+
 *   …etc.
 */
export function nodeMatchesSubset(
  node: GraphSignalNode,
  subsetKey: string,
): boolean {
  if (!subsetKey) return true;
  const flags = subsetKey.split("|");
  if (flags.includes("z") && !nodeIsZonage(node)) return false;
  if (flags.includes("m") && !nodeIsMulti4(node)) return false;
  // "p" (précoce) — heuristique label/description trop complexe côté client,
  // on retourne true pour ne pas masquer de signaux réels.
  return true;
}

/**
 * Filtre un tableau de nœuds selon la clé active.
 * Si la clé est vide, retourne le tableau d'origine (même référence).
 */
export function filterNodesBySubset(
  nodes: GraphSignalNode[],
  subsetKey: string,
): GraphSignalNode[] {
  if (!subsetKey) return nodes;
  return nodes.filter((n) => nodeMatchesSubset(n, subsetKey));
}

/**
 * Clé d'AFFICHAGE dérivée d'une clé de sous-ensemble, pour lire un compteur
 * agrégé (`subsetCounts`) de façon COHÉRENTE avec ce que le panneau/carte
 * affiche réellement (`nodeMatchesSubset` / `filterNodesBySubset`).
 *
 * L'axe « p » (précoce) est NEUTRE à l'affichage : `nodeMatchesSubset` ne
 * masque jamais sur « p » (contrat documenté + testé — le panneau montre les
 * signaux précoces ET non précoces). Or `subsetCounts["z|m|p"]` est, lui,
 * RESTRICTIF (z∩m∩p) car calculé côté serveur pour la cohorte « 33 » /
 * focus30 (source-coverage). Lire `subsetCounts[activeKey]` avec un « p » actif
 * faisait donc SOUS-COMPTER le rail (z∩m∩p = 1) par rapport au panneau (z∩m = 2).
 *
 * On retire « p » de la clé de LECTURE pour égaler le panneau, SANS toucher au
 * calcul serveur : la cohorte restrictive reste disponible via
 * `subsetCounts["z|m|p"]` pour source-coverage.
 */
export function displaySubsetKey(subsetKey: string): string {
  return subsetKey
    .split("|")
    .filter((flag) => flag === "z" || flag === "m")
    .join("|");
}

/**
 * Compteur d'affichage d'une ville : `subsetCounts` lu à la clé d'affichage
 * (« p » neutralisé). Garantit l'égalité rail/carte ↔ panneau
 * (`filterNodesBySubset`) pour toute clé active.
 */
export function subsetDisplayCount(
  subsetCounts: Record<string, number>,
  subsetKey: string,
): number {
  return subsetCounts[displaySubsetKey(subsetKey)] ?? 0;
}

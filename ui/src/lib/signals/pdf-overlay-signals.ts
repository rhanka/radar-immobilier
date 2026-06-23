/**
 * Construction de la liste des signaux d'un même procès-verbal (même `rawRef`)
 * pour le surlignage MULTI-SIGNAUX du viewer de preuve (LOT 2, track #84).
 *
 * Un PV peut porter plusieurs signaux (St-Frédéric : A16/Rf51/I93 page 2 ;
 * certains PV jusqu'à 56 signaux). L'overlay surligne TOUS les signaux du PV,
 * chacun d'une couleur distincte + badge ID, le signal COURANT mis en avant.
 *
 * Cette logique vit côté UI : la route API renvoie déjà tous les nœuds de la
 * ville (`detailNodes`) ; on filtre sur le `rawRef` du signal courant — aucune
 * route API à modifier.
 */

import {
  extractSignalEvidence,
  type GraphSignalNode,
} from "./graph-signal-detail-client.js";
import { signalColorAt } from "./pdf-signal-colors.js";

/**
 * Un signal projeté pour l'overlay : ce dont l'overlay a besoin pour surligner
 * sa citation et l'étiqueter. `excerpt` peut être `null` (pas de surlignage
 * pour ce signal, mais il reste compté/listé).
 */
export interface OverlaySignal {
  /** Identifiant technique du nœud (sert d'ancre de réconciliation). */
  id: string;
  /** Libellé court affiché dans le badge + le panneau (ex. « A16 »). */
  label: string;
  /** Extrait cité à surligner (verbatim couche texte), ou null. */
  excerpt: string | null;
  /** Page cible (1-based) du surlignage, ou null si inconnue. */
  page: number | null;
  /** Couleur stable du signal (hex). */
  color: string;
  /** Vrai pour le signal qu'on a ouvert (mis en avant). */
  current: boolean;
}

/**
 * Borne de signaux surlignés simultanément. Un PV à 56 signaux noierait la page
 * de badges illisibles ; on borne à un nombre raisonnable. Le signal courant
 * est TOUJOURS inclus (placé en tête), les autres complètent jusqu'à la borne.
 * Choix par défaut : 12 (lève l'essentiel du besoin « tous visibles » sans
 * saturer ; à ajuster après retour produit).
 */
export const MAX_OVERLAY_SIGNALS = 12;

/** Libellé court d'un signal pour le badge : compact, sans bourrage. */
function shortLabel(node: GraphSignalNode): string {
  const raw = (node.label ?? "").trim();
  if (raw.length === 0) return node.id.slice(0, 6);
  // On garde tel quel si court ; sinon on tronque proprement pour le badge.
  return raw.length <= 14 ? raw : `${raw.slice(0, 13)}…`;
}

/**
 * Construit la liste ordonnée des signaux du même PV que `currentNode`.
 *
 * Ordre : signal courant en tête (mis en avant + couleur d'index 0), puis les
 * autres signaux du PV dans leur ordre d'apparition. La couleur est attribuée
 * par RANG dans cette liste (déterministe) ; le panneau de droite réutilise le
 * même rang pour la pastille → cohérence couleur overlay ↔ fiche.
 *
 * @param currentNode  le signal ouvert (toujours présent dans le résultat)
 * @param allNodes     tous les nœuds de la ville (`detailNodes`)
 * @param targetRawRef le rawRef résolu du signal courant (clé de regroupement)
 */
export function buildOverlaySignals(
  currentNode: GraphSignalNode,
  allNodes: readonly GraphSignalNode[],
  targetRawRef: string | null,
): OverlaySignal[] {
  // Sans rawRef on ne peut pas regrouper : seul le signal courant est connu.
  const others = targetRawRef
    ? allNodes.filter((n) => {
        if (n.id === currentNode.id) return false;
        const ev = extractSignalEvidence(n);
        return ev.rawRef !== null && ev.rawRef === targetRawRef;
      })
    : [];

  // Courant en tête, puis les autres (bornés). Le courant compte dans la borne.
  const ordered: GraphSignalNode[] = [currentNode, ...others].slice(
    0,
    MAX_OVERLAY_SIGNALS,
  );

  return ordered.map((node, index) => {
    const ev = extractSignalEvidence(node);
    return {
      id: node.id,
      label: shortLabel(node),
      excerpt: ev.excerpt ?? ev.citation ?? null,
      page: ev.page,
      color: signalColorAt(index),
      current: node.id === currentNode.id,
    };
  });
}

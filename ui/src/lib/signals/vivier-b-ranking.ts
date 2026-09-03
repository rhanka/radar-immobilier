/**
 * Tri déterministe + raison de rang LISIBLE de la vue B — AFFICHAGE UNIQUEMENT.
 *
 * Ce module NE CLASSIFIE RIEN et ne recalcule aucun verdict. Il CONSOMME :
 *   - `compareVivier` / `rankVivier` du domaine (`@radar/domain`), le
 *     comparateur déterministe déjà mergé (#374) ;
 *   - la `classification` `vivier_v2` déjà posée par le serveur sur chaque nœud.
 *
 * Il fournit deux choses au panneau :
 *   1. l'ORDRE des signaux B (le mur de ~914 signaux devient une liste triée) ;
 *   2. la RAISON du rang / la BULLE d'étape en copy produit NEUTRE
 *      (instrument + étape) — jamais `rankReason` brut (technique).
 *
 * `signalStageLabel` fournit cette bulle d'étape en TOUT mode (pas seulement en
 * vivier B) : classification posée → forme validée ; sinon reconstruite depuis
 * `props.etape`/`props.instrument`. Étape inconnue/absente → aucune bulle (repli
 * honnête : jamais une étape inventée).
 */

import {
  compareVivier,
  type VivierV2,
  type VivierEtape,
  type VivierInstrument,
  type VivierSortable,
} from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

/**
 * Fraîcheur d'un nœud pour le tri v2 : date de publication du document
 * (la plus signifiante), repli sur la date d'ingestion. `null` quand aucune —
 * `compareVivier` range alors le signal en fin de tri à fraîcheur égale.
 */
function nodeFreshness(node: GraphSignalNode): string | null {
  return node.publishedAt ?? node.createdAt ?? null;
}

/**
 * Adapte un nœud graph vers la forme minimale `VivierSortable` attendue par
 * `compareVivier` (`{ id, classification, fraicheur }`). Retourne `null` quand
 * le nœud n'a pas de classification serveur exploitable — on ne fabrique jamais
 * une classification côté client.
 */
export function toVivierSortable(node: GraphSignalNode): VivierSortable | null {
  if (!node.classification) return null;
  return {
    id: node.id,
    classification: node.classification,
    fraicheur: nodeFreshness(node),
  };
}

/**
 * Trie les nœuds de la vue B par le comparateur déterministe du domaine.
 *
 * Le tri s'applique APRÈS exclusion (l'appelant passe la liste déjà filtrée) :
 * on ne trie que ce qui est visible. Un nœud sans classification serveur (ne
 * devrait pas arriver en B, où la projection l'exige) est laissé en fin, dans
 * l'ordre d'entrée — jamais réordonné par une inférence client.
 */
export function rankVivierBNodes(
  nodes: readonly GraphSignalNode[],
): GraphSignalNode[] {
  return [...nodes].sort((a, b) => {
    const left = toVivierSortable(a);
    const right = toVivierSortable(b);
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return compareVivier(left, right);
  });
}

/**
 * Libellés d'instrument, copy client NEUTRE (aucun jeton interne exposé).
 */
const INSTRUMENT_LABELS: Record<VivierInstrument, string> = {
  rezonage: "Rezonage",
  ppcmoi: "PPCMOI",
  piia: "PIIA",
  derogation: "Dérogation",
  refonte: "Refonte",
  plan_urbanisme: "Plan d'urbanisme",
  autre: "Instrument à préciser",
};

/**
 * Libellés d'étape en phrases lisibles (avis de motion → entrée en vigueur).
 * `inconnu` reste HONNÊTE : « étape à confirmer », jamais une étape supposée.
 */
const ETAPE_LABELS: Record<VivierEtape, string> = {
  avis_motion: "avis de motion",
  projet_reglement: "projet de règlement",
  consultation_publique: "consultation publique",
  second_projet: "second projet",
  adoption: "adoption",
  entree_vigueur: "entrée en vigueur",
  inconnu: "étape à confirmer",
};

/**
 * Raison du rang, en langage métier NEUTRE : « instrument, étape ».
 * Ex. « Refonte, projet de règlement » / « PPCMOI, avis de motion » /
 * « Dérogation, entrée en vigueur ». C'est ce qui explique POURQUOI un signal
 * est haut (rezonage précoce) ou bas (étape tardive / instrument indirect).
 */
export function vivierRankReasonLabel(classification: VivierV2): string {
  const instrument = INSTRUMENT_LABELS[classification.instrument];
  const etape = ETAPE_LABELS[classification.etape];
  return `${instrument}, ${etape}`;
}

/**
 * Étapes telles qu'elles arrivent dans `node.props.etape` HORS vivier v2
 * (annotation graphify), vocabulaire plus large que `VivierEtape` : ajoute
 * `consultation`, `accorde`, `refuse`. `inconnu`/absent est volontairement
 * hors table → aucune bulle (repli honnête : jamais d'étape inventée).
 */
const SIGNAL_STAGE_LABELS: Record<string, string> = {
  avis_motion: "avis de motion",
  projet_reglement: "projet de règlement",
  consultation_publique: "consultation publique",
  consultation: "consultation publique",
  second_projet: "second projet",
  adoption: "adoption",
  entree_vigueur: "entrée en vigueur",
  accorde: "accordé",
  refuse: "refusé",
};

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Bulle d'ÉTAPE d'un signal, forme « Instrument, étape » (ex. « Rezonage, avis
 * de motion »), affichable en TOUT mode — c'est le sous-libellé de la carte
 * signal :
 *   - classification vivier v2 posée → forme validée `vivierRankReasonLabel`,
 *     sauf étape `inconnu` (→ aucune bulle) ;
 *   - sinon (hors vivier v2) → reconstruite depuis `props.etape` +
 *     `props.instrument` (vocabulaire graphify), même forme.
 * Étape inconnue/absente → `null` : la carte n'affiche AUCUNE bulle (repli
 * honnête, jamais une étape inventée). Instrument absent/`autre` → étape seule.
 */
export function signalStageLabel(node: GraphSignalNode): string | null {
  if (node.classification) {
    if (node.classification.etape === "inconnu") return null;
    return vivierRankReasonLabel(node.classification);
  }
  const stageToken = stringProp(node.props, "etape");
  const stageLabel = stageToken ? SIGNAL_STAGE_LABELS[stageToken] : undefined;
  if (!stageLabel) return null;
  const instrumentToken = stringProp(node.props, "instrument");
  const instrumentLabel =
    instrumentToken && instrumentToken !== "autre" && instrumentToken in INSTRUMENT_LABELS
      ? INSTRUMENT_LABELS[instrumentToken as VivierInstrument]
      : undefined;
  return instrumentLabel ? `${instrumentLabel}, ${stageLabel}` : capitalizeFirst(stageLabel);
}

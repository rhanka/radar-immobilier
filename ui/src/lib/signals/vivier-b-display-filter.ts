/**
 * Filtres d'exclusion de la vue B — AFFICHAGE UNIQUEMENT.
 *
 * B retire le garde-fou `m` (multifamilial 4+) de A : sans contrepoids, la vue
 * s'ouvre à tout le vivier qualifié et le bruit revient. Ces deux filtres,
 * COCHÉS par défaut et DÉCOCHABLES, remplacent ce garde-fou.
 *
 * Ce module NE CLASSIFIE RIEN. Il lit la classification `vivier_v2` déjà posée
 * par le serveur (`instrument`) et des PREUVES portées par le signal, puis
 * décide seulement de MASQUER. Aucun signal n'est jamais réécrit en « non
 * résidentiel » sans preuve : masquer n'est pas classer.
 */

import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export interface VivierBExclusions {
  /** « Exclure PIIA sans projet résidentiel » */
  piiaSansProjetResidentiel: boolean;
  /** « Exclure dérogations mineures » */
  derogationsMineures: boolean;
}

/**
 * Les deux exclusions sont ACTIVES par défaut (demande du 2026-07-13).
 * Décocher est un geste explicite de l'utilisateur, jamais un défaut.
 */
export const DEFAULT_VIVIER_B_EXCLUSIONS: VivierBExclusions = {
  piiaSansProjetResidentiel: true,
  derogationsMineures: true,
};

/**
 * Marqueurs d'un VRAI projet d'habitation cité dans le texte.
 *
 * Volontairement plus étroit que les marqueurs résidentiels du serveur : « en
 * zone résidentielle » suffit à rendre un PIIA `residentiel = oui` côté
 * serveur, mais ne prouve AUCUN logement. Ici on exige des logements (ou un
 * plex) réellement cités.
 */
const LOGEMENTS_CITES_RE =
  /\b(?:logements?|multilogements?|multi-logements?|unites? d(?:e |')habitation|(?:du|tri|quadru|multi)plex|\bplex\b)\b/;

function foldText(raw: string): string {
  return raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `props.properties` (forme graphify) avec repli sur `props` à plat. */
function propertyRecords(node: GraphSignalNode): Record<string, unknown>[] {
  const props = isRecord(node.props) ? node.props : {};
  const nested = isRecord(props.properties) ? props.properties : {};
  return [nested, props];
}

function readProperty(node: GraphSignalNode, key: string): unknown {
  for (const record of propertyRecords(node)) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** `nb_unites_max` présent ET numérique — la borne d'unités du projet. */
function hasNbUnitesMax(node: GraphSignalNode): boolean {
  const value = readProperty(node, "nb_unites_max");
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return Number.isFinite(Number(value));
  return false;
}

/**
 * Texte porteur de preuve : le libellé, la description et les EXTRAITS de
 * document (la citation est la preuve — c'est elle qui porte « quatre
 * logements » dans le cas Austin).
 */
function evidenceText(node: GraphSignalNode): string {
  const excerpts = (node.docRefs ?? [])
    .map((ref) => ref.excerpt ?? "")
    .join(" ");
  return foldText(`${node.label ?? ""} ${node.description ?? ""} ${excerpts}`);
}

/**
 * Preuve POSITIVE d'un projet résidentiel porté par le signal.
 *
 * Trois canaux, conformes à la règle produit :
 *   1. `nb_unites_max` présent (une borne d'unités = un projet chiffré) ;
 *   2. `residentiel === "oui"` annoté sur le signal (champ d'extraction) ;
 *   3. des logements CITÉS dans le libellé, la description ou la citation.
 *
 * NB : le canal 2 lit la PROPRIÉTÉ `residentiel` du signal, pas le verdict
 * `classification.residentiel.valeur`. Ce dernier vaut déjà `oui` pour tout
 * signal qualifié (c'est la définition de « qualifié ») : s'en servir comme
 * preuve rendrait la règle vacuously vraie et le filtre inopérant.
 */
export function hasResidentialProjectProof(node: GraphSignalNode): boolean {
  if (hasNbUnitesMax(node)) return true;
  const annotated = readProperty(node, "residentiel");
  if (typeof annotated === "string" && foldText(annotated) === "oui") return true;
  return LOGEMENTS_CITES_RE.test(evidenceText(node));
}

/** L'instrument tel que classé par le serveur — jamais redéduit ici. */
function instrumentOf(node: GraphSignalNode): string | null {
  return node.classification?.instrument ?? null;
}

/**
 * Un PIIA porteur d'un projet résidentiel prouvé : gardé, mais signalé pour ce
 * qu'il est — un instrument indirect, donc une confiance faible.
 */
export function isPiiaLie(node: GraphSignalNode): boolean {
  return instrumentOf(node) === "piia" && hasResidentialProjectProof(node);
}

export const PIIA_LIE_BADGE = "PIIA lié · confiance faible" as const;

/**
 * Le signal est-il masqué par les exclusions actives ?
 *
 * Un PIIA avec preuve positive de projet résidentiel est TOUJOURS gardé
 * (Austin : `nb_unites_max=4` + « quatre logements » cités ; Bedford :
 * « PIIA 4 plex »). Exclure tout PIIA les écarterait — ce serait un bug.
 */
export function isHiddenByVivierBExclusions(
  node: GraphSignalNode,
  exclusions: VivierBExclusions,
): boolean {
  const instrument = instrumentOf(node);
  if (
    exclusions.piiaSansProjetResidentiel &&
    instrument === "piia" &&
    !hasResidentialProjectProof(node)
  ) {
    return true;
  }
  return exclusions.derogationsMineures && instrument === "derogation";
}

export function applyVivierBExclusions(
  nodes: readonly GraphSignalNode[],
  exclusions: VivierBExclusions,
): GraphSignalNode[] {
  return nodes.filter((node) => !isHiddenByVivierBExclusions(node, exclusions));
}

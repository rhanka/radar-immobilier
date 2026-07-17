import type { VivierV2Counts } from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import {
  parseKey,
  type SelectionBucketState,
  type SelectionKey,
} from "$lib/maps/selection-bucket.js";
import type { GeoRoute } from "$lib/router/geo-route.js";

/** Les comptes bulk serveur d'une ville, tels que servis par /by-city. */
export interface VivierCityCountsEntry {
  subsetCounts: Record<string, number>;
  vivierV2Counts?: VivierV2Counts | null;
}

export const A_SUBSET_KEY = "z|m|p" as const;
/**
 * B n'est PAS un sous-ensemble {z,m,p} : c'est le vivier v2 classifié par le
 * serveur (zonage ∩ résidentiel, tri-état). Sa clé est donc un jeton opaque,
 * volontairement hors du vocabulaire z/m/p — aucune combinaison de flags ne
 * peut le produire par accident.
 */
export const B_SUBSET_KEY = "vivier-v2" as const;
export type VivierViewMode = "a" | "b";

/**
 * Seule la clé B explicite quitte le A immuable.
 *
 * Tout le reste — vide, hybride, ancienne URL/préférence `z|p` (la régression
 * de prod corrigée par #375) — résout vers A, qui reste le défaut.
 */
export function modeFromSubsetKey(raw: string | null | undefined): VivierViewMode {
  return raw?.trim() === B_SUBSET_KEY ? "b" : "a";
}

export function subsetKeyForMode(mode: VivierViewMode): string {
  return mode === "b" ? B_SUBSET_KEY : A_SUBSET_KEY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCompatibleMembership(node: GraphSignalNode): boolean {
  const membership = node.legacySubset;
  if (!isRecord(membership) || !isRecord(membership.flags)) return false;
  return membership.version === "legacy-zmp-v1" &&
    membership.signalId === node.id &&
    typeof membership.flags.z === "boolean" &&
    typeof membership.flags.m === "boolean" &&
    typeof membership.flags.p === "boolean";
}

/**
 * Le nœud porte-t-il une classification `vivier_v2` serveur exploitable ?
 * On ne valide que ce dont B a besoin (zonage/résidentiel tri-état +
 * `exclusion_reason`), sans dupliquer le schéma zod du contrat.
 */
function hasVivierClassification(node: GraphSignalNode): boolean {
  const classification = node.classification;
  if (!isRecord(classification)) return false;
  const { zonage, residentiel } = classification as Record<string, unknown>;
  const triState = (value: unknown): boolean =>
    isRecord(value) &&
    (value.valeur === "oui" || value.valeur === "non" || value.valeur === "indetermine");
  if (!triState(zonage) || !triState(residentiel)) return false;
  const reason = (classification as Record<string, unknown>).exclusion_reason;
  return reason === null || typeof reason === "string";
}

/**
 * Qualifié = la définition du contrat `countVivierClassifications` :
 * aucune raison d'exclusion ET zonage `oui` ET résidentiel `oui`.
 * Toute autre combinaison est « à confirmer » ou « exclus » — jamais masquée
 * en silence par une inférence client.
 */
function isQualifiedVivierNode(node: GraphSignalNode): boolean {
  const classification = node.classification!;
  return (
    classification.exclusion_reason === null &&
    classification.zonage.valeur === "oui" &&
    classification.residentiel.valeur === "oui"
  );
}

function parseProjectionMode(
  value: unknown,
): { count: number; signalIds: string[] } | null {
  if (!isRecord(value) || value.version !== "legacy-zmp-v1") return null;
  const selected = value["a"];
  if (!isRecord(selected) || !Number.isInteger(selected.count) || (selected.count as number) < 0) return null;
  if (!Array.isArray(selected.signalIds) || !selected.signalIds.every((id) => typeof id === "string")) return null;
  const signalIds = selected.signalIds as string[];
  if (new Set(signalIds).size !== signalIds.length || selected.count !== signalIds.length) return null;
  return { count: selected.count as number, signalIds };
}

export interface VivierProjectionResult {
  available: boolean;
  count: number | null;
  nodes: GraphSignalNode[];
}

export interface ValidatedVivierProjections {
  a: VivierProjectionResult;
  b: VivierProjectionResult;
}

/** Exact server-classified IDs; incompatible payloads never get a fallback. */
export function projectLegacyVivierA(
  nodes: GraphSignalNode[],
  authority: unknown,
): VivierProjectionResult {
  const selected = parseProjectionMode(authority);
  if (!selected || !nodes.every(hasCompatibleMembership)) {
    return { available: false, count: null, nodes: [] };
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expected = nodes
    .filter((node) => {
      const flags = node.legacySubset!.flags;
      return flags.z && flags.m && flags.p;
    })
    .map((node) => node.id);
  if (expected.length !== selected.count || expected.some((id, index) => id !== selected.signalIds[index])) {
    return { available: false, count: null, nodes: [] };
  }
  const projected = selected.signalIds.map((id) => byId.get(id));
  if (projected.some((node) => node === undefined)) {
    return { available: false, count: null, nodes: [] };
  }
  return { available: true, count: selected.count, nodes: projected as GraphSignalNode[] };
}

/**
 * B = les signaux QUALIFIÉS du vivier v2, tels que classés PAR LE SERVEUR.
 *
 * Anti-invention : on ne reclassifie rien côté client, on relit la
 * classification `vivier_v2` déjà portée par chaque nœud (même passe, même
 * donnée que `vivierV2Counts`). Un seul nœud sans classification exploitable
 * rend la projection indisponible plutôt que de produire un compte partiel.
 */
export function projectQualifiedVivierNodes(
  nodes: GraphSignalNode[],
): VivierProjectionResult {
  if (!nodes.every(hasVivierClassification)) {
    return { available: false, count: null, nodes: [] };
  }
  const qualified = nodes.filter(isQualifiedVivierNode);
  return { available: true, count: qualified.length, nodes: qualified };
}

export function projectNodesForVivierMode(
  nodes: GraphSignalNode[],
  authority: unknown,
  mode: VivierViewMode,
): VivierProjectionResult {
  return mode === "b"
    ? projectQualifiedVivierNodes(nodes)
    : projectLegacyVivierA(nodes, authority);
}

export function validateVivierProjectionAuthority(
  nodes: GraphSignalNode[],
  authority: unknown,
): ValidatedVivierProjections {
  return {
    a: projectLegacyVivierA(nodes, authority),
    b: projectQualifiedVivierNodes(nodes),
  };
}

/**
 * Compte affiché/trié par ville, TOUJOURS le compte bulk du serveur.
 *
 * Le bulk n'est pas une estimation : `listCitiesWithSignalNodes` et
 * `getSignalNodesForCity` lisent la même table `graph_nodes`, avec le même
 * filtre de type, et dérivent leurs flags du même `classifyLegacyZmpSignal` —
 * le détail n'ajoute qu'un `WHERE city_slug = X`. La projection détail
 * n'apporte que les `signalIds` (vérification item par item), utiles à la
 * LISTE et aux PREUVES, pas à un badge qui n'affiche qu'un nombre.
 *
 * Substituer la projection au bulk pour la ville sélectionnée rendait donc
 * `null` le temps du fetch, ce qui éjectait la ville du rail (tri à -1 sous
 * les villes à 0, puis coupe au plafond) avant son retour ~1 s plus tard.
 *
 * A lit `subsetCounts["z|m|p"]`, B lit `vivierV2Counts.qualified` : les DEUX
 * sortent de la même passe serveur (`aggregateGraphSignalProjectionRows`) sur
 * la même donnée — B n'est pas un fork, juste l'autre compteur déjà calculé.
 */
export function countForVivierCity(
  entry: VivierCityCountsEntry,
  mode: VivierViewMode,
): number {
  return mode === "b"
    ? entry.vivierV2Counts?.qualified ?? 0
    : entry.subsetCounts[A_SUBSET_KEY] ?? 0;
}

/**
 * Les trois compteurs B, sommés sur les villes affichées.
 *
 * On expose les trois SÉPARÉMENT (jamais un total qui absorbe l'indéterminé) :
 * `qualified` est le vivier, `residentialUnknown` reste à confirmer, et les
 * exclusions serveur sont comptées par leur somme.
 */
export function sumVivierBCounts(
  entries: readonly VivierCityCountsEntry[],
): { qualified: number; residentialUnknown: number; excluded: number } {
  return entries.reduce(
    (totals, entry) => {
      const counts = entry.vivierV2Counts;
      if (!counts) return totals;
      return {
        qualified: totals.qualified + counts.qualified,
        residentialUnknown: totals.residentialUnknown + counts.residentialUnknown,
        excluded:
          totals.excluded +
          Object.values(counts.excludedByReason).reduce((sum, value) => sum + value, 0),
      };
    },
    { qualified: 0, residentialUnknown: 0, excluded: 0 },
  );
}

export function routeSubsetKey(route: GeoRoute): string | null {
  const values = route.state.filters["subset"];
  if (!values || values.length === 0) return null;
  const raw = values.join("|");
  return subsetKeyForMode(modeFromSubsetKey(raw));
}

export function initialVivierSubsetKey(
  route: GeoRoute | null,
  storedSubsetKey: string | null,
): string {
  const explicit = route ? routeSubsetKey(route) : null;
  if (explicit !== null) return explicit;
  const stored = storedSubsetKey?.trim();
  return stored ? subsetKeyForMode(modeFromSubsetKey(stored)) : A_SUBSET_KEY;
}

export function reconcileVivierRouteSubset(
  route: GeoRoute,
  currentSubsetKey: string,
): string {
  return routeSubsetKey(route) ?? subsetKeyForMode(modeFromSubsetKey(currentSubsetKey));
}

export function vivierRouteKey(route: GeoRoute): string {
  const subset = routeSubsetKey(route) ?? "absent";
  if (route.level === "region") return `region:${route.region}:${route.state.mode}:${subset}`;
  if (route.level === "city") return `city:${route.citySlug}:${route.state.mode}:${subset}`;
  return `zone:${route.citySlug}:${route.zoneKey}:${route.state.mode}:${subset}`;
}

export interface VivierCityTransientState<TEvidence, TDocument> {
  activeEvidence: TEvidence | null;
  activeDocument: TDocument | null;
  hoveredEvidenceSignalId: string | null;
}

export function clearVivierCityTransientState<TEvidence, TDocument>(
  previousSlug: string | null,
  nextSlug: string,
  state: VivierCityTransientState<TEvidence, TDocument>,
): VivierCityTransientState<TEvidence, TDocument> {
  return previousSlug === nextSlug
    ? state
    : { activeEvidence: null, activeDocument: null, hoveredEvidenceSignalId: null };
}

function keepSelectionKey(key: SelectionKey, allowedIds: ReadonlySet<string>): boolean {
  const parsed = parseKey(key);
  return parsed?.kind !== "signal" || allowedIds.has(parsed.id);
}

export function reconcileVivierSelection(
  state: SelectionBucketState,
  allowedIds: ReadonlySet<string>,
): SelectionBucketState {
  const selectedKeys = new Set([...state.selectedKeys].filter((key) => keepSelectionKey(key, allowedIds)));
  const expandedKeys = new Set([...state.expandedKeys].filter((key) => keepSelectionKey(key, allowedIds)));
  const focusedKey = state.focusedKey && keepSelectionKey(state.focusedKey, allowedIds) ? state.focusedKey : null;
  const hoveredKey = state.hoveredKey && keepSelectionKey(state.hoveredKey, allowedIds) ? state.hoveredKey : null;
  return { selectedKeys, expandedKeys, focusedKey, hoveredKey };
}

export function retainProjectedSignalId(
  id: string | null,
  allowedIds: ReadonlySet<string>,
): string | null {
  return id !== null && allowedIds.has(id) ? id : null;
}

export function canOpenProjectedSignal(
  id: string,
  nodes: readonly GraphSignalNode[],
): boolean {
  return nodes.some((node) => node.id === id);
}

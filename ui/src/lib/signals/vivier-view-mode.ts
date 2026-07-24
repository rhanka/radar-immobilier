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
/**
 * B ∩ précoce : le vivier v2 qualifié RESTREINT aux étapes précoces
 * (avis_motion / projet_reglement). Jeton opaque dérivé de B — donc « b » aussi.
 * Le compte bulk correspondant = `stageCounts.avis_motion + projet_reglement`.
 */
export const B_PRECOCE_SUBSET_KEY = "vivier-v2|p" as const;
export type VivierViewMode = "a" | "b";

/** Les trois axes combinables de A, tous cochés par défaut → `z|m|p`. */
export interface AFlags {
  z: boolean;
  m: boolean;
  p: boolean;
}

/** Défaut A : les trois axes cochés → clé `z|m|p` (le vivier de référence). */
export const DEFAULT_A_FLAGS: AFlags = { z: true, m: true, p: true };

/**
 * Les trois axes combinables de B, tous côté AFFICHAGE (lecture serveur, jamais
 * une reclassification). `z`/`r` exigent respectivement zonage `oui` et
 * résidentiel `oui` ; `p` restreint aux étapes précoces. Cochés/décochés
 * librement, comme les axes de A.
 */
export interface BAxes {
  z: boolean;
  r: boolean;
  p: boolean;
}

/**
 * Défaut B : zonage ✓, résidentiel ✓, précoce ✓ — le vivier v2 qualifié
 * (zonage oui ∩ résidentiel oui ∩ sans exclusion serveur), RESTREINT aux
 * étapes précoces dès l'ouverture du tab. Décocher un axe RELÂCHE le filtre
 * (comme en A), sans jamais toucher la classification.
 *
 * m1 (RED confirmé en e2e) : le tab B s'ouvrait avec Précoce DÉCOCHÉ, ce qui
 * noyait l'utilisateur dans tout le vivier qualifié dès l'entrée dans B. Le
 * produit veut Précoce coché par défaut — cohérent avec le garde-fou attendu.
 */
export const DEFAULT_B_AXES: BAxes = { z: true, r: true, p: true };

/** Étapes considérées « précoces » par le vivier v2 (parité `isPrecoceSignal`). */
const PRECOCE_ETAPES = new Set(["avis_motion", "projet_reglement"]);

/**
 * Recompose la clé subsetCounts à partir des axes cochés de A.
 * Ordre canonique `z|m|p` ; aucun axe coché → `""` (tous les signaux).
 * C'est exactement le mécanisme d'avant #376 : la clé compose, puis on lit
 * `subsetCounts[clé]` (indexé par superset, cf. `computeLegacySubsetCounts`).
 */
export function keyFromAFlags(flags: AFlags): string {
  const parts: string[] = [];
  if (flags.z) parts.push("z");
  if (flags.m) parts.push("m");
  if (flags.p) parts.push("p");
  return parts.join("|");
}

/** Lit les axes REQUIS d'une clé A (`z|p` → {z:true,m:false,p:true}). */
export function aFlagsFromKey(key: string): AFlags {
  const parts = new Set(key.split("|").filter(Boolean));
  return { z: parts.has("z"), m: parts.has("m"), p: parts.has("p") };
}

/**
 * Clé LIVE composée de B à partir de ses trois axes.
 *
 * Grammaire OPAQUE, préfixe `vivier-v2`, rétro-compatible : le défaut reste
 * `vivier-v2` et l'axe précoce explicite reste `vivier-v2|p`. Un axe DÉcoché
 * ajoute un jeton de relâchement (`-z`, `-r`, `-p`). Comme tout le vocabulaire est préfixé
 * `vivier-v2`, aucune combinaison d'axes A (z/m/p) ne peut le produire par
 * accident, et la persistance (clé de MODE) l'écrase toujours à `vivier-v2`.
 */
export function keyForVivierB(axes: BAxes): string {
  const parts: string[] = [B_SUBSET_KEY];
  if (!axes.z) parts.push("-z");
  if (!axes.r) parts.push("-r");
  // `vivier-v2` alone is the canonical mode/default. `-p` is live-only: it
  // represents an explicit session opt-out and is collapsed before URL/storage.
  if (!axes.p) parts.push("-p");
  else parts.push("p");
  return parts.join("|");
}

/**
 * Lit les axes d'une clé B. `vivier-v2` est une clé de MODE, sans axes
 * explicites : elle prend donc le défaut produit courant (Précoce inclus).
 * Le suffixe `-p` exprime explicitement le relâchement de Précoce. Les clés
 * explicites historiques qui portent déjà des axes restent interprétables.
 */
export function bAxesFromVivierKey(key: string): BAxes {
  const parts = new Set(key.split("|").filter(Boolean));
  const hasExplicitAxes = [...parts].some((part) => part !== B_SUBSET_KEY);
  return {
    z: !parts.has("-z"),
    r: !parts.has("-r"),
    p: hasExplicitAxes ? parts.has("p") && !parts.has("-p") : DEFAULT_B_AXES.p,
  };
}

/**
 * A vs B, à partir de la clé LIVE (composée).
 *
 * Tout le vocabulaire z/m/p (y compris l'ancienne régression `z|p` de #375, et
 * la clé vide) reste A. Seules les clés du namespace opaque `vivier-v2` (défaut,
 * `vivier-v2|p`, `vivier-v2|-r`, …) basculent en B — aucune composition de flags
 * A (z/m/p) ne peut les produire par accident.
 */
export function modeFromSubsetKey(raw: string | null | undefined): VivierViewMode {
  const first = (raw?.trim() ?? "").split("|")[0];
  return first === B_SUBSET_KEY ? "b" : "a";
}

/**
 * Clé de MODE persistée (URL/localStorage) : toujours le défaut du tab.
 * A → `z|m|p`, B → `vivier-v2`. La sous-sélection LIVE (axes décochés, précoce)
 * n'est PAS persistée : au rechargement, le tab repart de son défaut — c'est
 * ce qui garantit « défaut A = z|m|p » et empêche `z|p` de redevenir collant.
 */
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
 * Périmètre de la vue B = « zonage résidentiel, indéterminé GARDÉ »
 * (SPEC_EVOL_FILTRAGE_VIVIER_v2 §9/§34) : aucune raison d'exclusion serveur, ET
 * zonage `oui`, ET résidentiel NON-franc (`oui` OU `indéterminé`). C'est la même
 * définition que le `stageCounts` serveur (`countVivierClassifications`) — un
 * signal résidentiel « à confirmer » (indéterminé) est GARDÉ, jamais masqué en
 * silence ; seul le franc-non-résidentiel (déjà porteur d'une exclusion) sort.
 */
function isQualifiedVivierNode(node: GraphSignalNode): boolean {
  const classification = node.classification!;
  return (
    classification.exclusion_reason === null &&
    classification.zonage.valeur === "oui" &&
    classification.residentiel.valeur !== "non"
  );
}

/**
 * Nœud QUALIFIÉ dont l'étape v2 est précoce (avis_motion / projet_reglement).
 * Même prédicat que le bucket `stageCounts` — le compte détail == le compte bulk
 * `stageCounts.avis_motion + projet_reglement`, jamais une reclassification.
 */
function isPrecoceVivierNode(node: GraphSignalNode): boolean {
  return PRECOCE_ETAPES.has(node.classification!.etape);
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
 * A avec sous-sélection : les axes DÉcochés relâchent le filtre.
 *
 * `z|m|p` (défaut) reste la projection EXACTE validée par l'autorité serveur
 * (aucune régression du vivier de référence). Toute autre composition filtre
 * les nœuds sur leurs flags legacy SERVEUR (`legacySubset.flags`) — on lit une
 * classification déjà posée, on n'en invente aucune. Un seul nœud sans flags
 * exploitables rend la projection indisponible plutôt que partielle.
 */
export function projectComposedVivierA(
  nodes: GraphSignalNode[],
  authority: unknown,
  subsetKey: string,
): VivierProjectionResult {
  const flags = aFlagsFromKey(subsetKey);
  if (flags.z && flags.m && flags.p) {
    return projectLegacyVivierA(nodes, authority);
  }
  if (!nodes.every(hasCompatibleMembership)) {
    return { available: false, count: null, nodes: [] };
  }
  const projected = nodes.filter((node) => {
    const f = node.legacySubset!.flags;
    return (!flags.z || f.z) && (!flags.m || f.m) && (!flags.p || f.p);
  });
  return { available: true, count: projected.length, nodes: projected };
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

/**
 * B ∩ précoce : les nœuds qualifiés dont l'étape v2 est précoce. Sous-ensemble
 * strict de `projectQualifiedVivierNodes` — masquer les étapes tardives ne
 * reclasse rien (le serveur garde `qualified` inchangé).
 */
export function projectPrecoceVivierNodes(
  nodes: GraphSignalNode[],
): VivierProjectionResult {
  if (!nodes.every(hasVivierClassification)) {
    return { available: false, count: null, nodes: [] };
  }
  const precoce = nodes.filter(
    (node) => isQualifiedVivierNode(node) && isPrecoceVivierNode(node),
  );
  return { available: true, count: precoce.length, nodes: precoce };
}

/**
 * B avec sous-sélection : les trois axes DÉcochés relâchent le filtre.
 *
 * Base = les nœuds classifiés NON exclus par le serveur (`exclusion_reason ===
 * null`) — les nœuds « exclus » restent hors de B en toutes circonstances.
 * Sur cette base, chaque axe COCHÉ ajoute une exigence lue sur la classification
 * serveur : `z` → zonage `oui`, `r` → résidentiel `oui`, `p` → étape précoce.
 *
 * Le défaut {z,r,p} = {✓,✓,✗} reproduit EXACTEMENT `projectQualifiedVivierNodes`
 * (le PÉRIMÈTRE de la vue B). L'axe `r` COCHÉ est PERMISSIF : il garde le
 * résidentiel `oui` ET l'indéterminé « à confirmer » (le franc-non-résidentiel
 * est déjà écarté par `exclusion_reason`). Décocher `z` révèle le hors-zonage
 * `oui` résidentiel : on RELIT des champs serveur, on n'en réécrit aucun. Un
 * seul nœud sans classification rend la projection indisponible plutôt que
 * partielle.
 */
export function projectComposedVivierB(
  nodes: GraphSignalNode[],
  axes: BAxes,
): VivierProjectionResult {
  if (!nodes.every(hasVivierClassification)) {
    return { available: false, count: null, nodes: [] };
  }
  const projected = nodes.filter((node) => {
    const c = node.classification!;
    if (c.exclusion_reason !== null) return false;
    if (axes.z && c.zonage.valeur !== "oui") return false;
    // Axe `r` PERMISSIF : « indéterminé GARDÉ » — seul le franc-non-résidentiel
    // (résidentiel `non`) est écarté, l'indéterminé « à confirmer » passe. C'est
    // ce qui fait remonter les refontes SANS gate « refonte→oui ».
    if (axes.r && c.residentiel.valeur === "non") return false;
    if (axes.p && !isPrecoceVivierNode(node)) return false;
    return true;
  });
  return { available: true, count: projected.length, nodes: projected };
}

/**
 * Projection LIVE à partir de la clé composée (axes de A / axes de B).
 * A : composition z/m/p ; B : composition zonage/résidentiel/précoce.
 */
export function projectNodesForVivierKey(
  nodes: GraphSignalNode[],
  authority: unknown,
  subsetKey: string,
): VivierProjectionResult {
  if (modeFromSubsetKey(subsetKey) === "b") {
    return projectComposedVivierB(nodes, bAxesFromVivierKey(subsetKey));
  }
  return projectComposedVivierA(nodes, authority, subsetKey);
}

export function projectNodesForVivierMode(
  nodes: GraphSignalNode[],
  authority: unknown,
  mode: VivierViewMode,
): VivierProjectionResult {
  return projectNodesForVivierKey(nodes, authority, subsetKeyForMode(mode));
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
 * A lit `subsetCounts[clé]` (clé composée par les axes cochés), B lit le
 * PÉRIMÈTRE serveur `stageCounts` (somme de toutes les étapes, ou des seules
 * étapes précoces quand l'axe est coché) : les DEUX sortent de la même passe
 * serveur (`aggregateGraphSignalProjectionRows`) sur la même donnée. Toujours
 * bulk : `subsetCounts[clé]` (0 si absent) et `vivierV2Counts` ne sont jamais
 * `null` le temps d'un fetch, donc une ville ne « saute » jamais du rail (#378).
 */
export function countForVivierCity(
  entry: VivierCityCountsEntry,
  subsetKey: string,
): number {
  if (modeFromSubsetKey(subsetKey) === "b") {
    const counts = entry.vivierV2Counts;
    if (!counts) return 0;
    // Le badge ville = le PÉRIMÈTRE serveur (zonage résidentiel, indéterminé
    // GARDÉ) via `stageCounts` : somme des étapes précoces quand l'axe précoce est
    // coché, sinon somme de TOUTES les étapes. `stageCounts` compte déjà le
    // périmètre (qualifié + indéterminé) — masquer/élargir est une lentille
    // d'affichage, jamais une reclassification.
    const stages = counts.stageCounts;
    return bAxesFromVivierKey(subsetKey).p
      ? stages.avis_motion + stages.projet_reglement
      : stages.avis_motion +
          stages.projet_reglement +
          stages.consultation_publique +
          stages.second_projet +
          stages.adoption +
          stages.entree_vigueur +
          stages.inconnu;
  }
  return entry.subsetCounts[subsetKey] ?? 0;
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
  const routeKey = routeSubsetKey(route);
  if (routeKey === null) {
    return subsetKeyForMode(modeFromSubsetKey(currentSubsetKey));
  }
  // La route ne porte QUE la clé de MODE (la sous-sélection LIVE — axes A
  // décochés, axes B relâchés / précoce — n'est jamais persistée). Une simple
  // navigation ville ne doit donc pas ÉCRASER cette sous-sélection vive : si la
  // clé LIVE courante relève DÉJÀ du même mode que la route, on la conserve
  // telle quelle (m1.8 : l'état des cases persiste au changement de ville). Un
  // vrai changement de mode (deep-link A↔B) repart, lui, du défaut du tab.
  return modeFromSubsetKey(currentSubsetKey) === modeFromSubsetKey(routeKey)
    ? currentSubsetKey
    : routeKey;
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

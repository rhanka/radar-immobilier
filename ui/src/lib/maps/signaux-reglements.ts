/**
 * signaux-reglements — agrégation des RÈGLEMENTS de la ville active à partir des
 * données DÉJÀ servies au panneau droit (aucun endpoint dédié n'expose une liste
 * de règlements par ville — cf. note PR : la vue source-coverage ne sert que des
 * compteurs, pas la liste). On DÉRIVE donc les règlements des signaux (numéro de
 * règlement cité + zones référencées + preuve documentaire) et on rattache la
 * grille de zonage PDF des zones liées quand la couche zonage l'expose.
 *
 * Rien n'est fabriqué : un règlement n'est listé que si un signal en porte le
 * numéro (`reglement_number` / `reglementNumber` / `reglement_numero` / `bylaw`
 * / `reglementNumbers`). Le « PDF ouvrable » d'un règlement = la source
 * documentaire du signal représentatif (rawRef same-origin en priorité).
 */
import {
  extractSignalEvidence,
  type GraphSignalNode,
  type SignalEvidence,
} from "$lib/signals/graph-signal-detail-client.js";
import type { GeoZoneFeature } from "$lib/maps/geo-zones-client.js";
import {
  extractSignalZoneRefs,
  zoneRefComparableKey,
} from "$lib/maps/signaux-map-geo.js";

export interface ReglementEntry {
  /** Numéro de règlement affiché VERBATIM (ex. "2008-102", "1926-26"). */
  number: string;
  /** Clé de dédup normalisée (casse + espaces ignorés). */
  key: string;
  /** Nombre de signaux de la ville citant ce règlement. */
  signalCount: number;
  /** Ids des signaux citant ce règlement, dans l'ordre d'apparition. */
  signalNodeIds: string[];
  /** Codes de zones (verbatim) référencés par ces signaux (dédup). */
  zoneCodes: string[];
  /** URLs de grille de zonage PDF des zones liées (dédup). */
  grillePdfUrls: string[];
  /**
   * Signal représentatif porteur d'une source documentaire OUVRABLE (rawRef
   * en priorité — rendu PDF same-origin — sinon documentUrl/sourceUrl). null
   * quand aucun signal citant n'expose de source ouvrable.
   */
  evidenceNodeId: string | null;
}

/** Numéros de règlement portés par un nœud (tableau ou scalaire), dédupés. */
export function readReglementNumbers(node: GraphSignalNode): string[] {
  const props = node.props;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    let str: string | null = null;
    if (typeof value === "string" && value.trim().length > 0) str = value.trim();
    else if (typeof value === "number" && Number.isFinite(value)) str = String(value);
    if (str === null) return;
    const norm = normalizeReglementKey(str);
    if (norm.length === 0 || seen.has(norm)) return;
    seen.add(norm);
    out.push(str);
  };
  for (const key of [
    "reglement_number",
    "reglementNumber",
    "reglement_numero",
    "bylaw",
    "reglementNumbers",
  ]) {
    const value = props[key];
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return out;
}

/** Clé de dédup d'un numéro de règlement : casse + espaces neutralisés. */
export function normalizeReglementKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** Une preuve est ouvrable si elle porte une source documentaire (rawRef/URL). */
function evidenceOpenable(evidence: SignalEvidence): boolean {
  return (
    evidence.rawRef !== null ||
    evidence.documentUrl !== null ||
    evidence.sourceUrl !== null
  );
}

interface MutableEntry extends ReglementEntry {
  _seenZone: Set<string>;
  _seenGrille: Set<string>;
  _hasRawEvidence: boolean;
}

/**
 * Agrège les règlements cités par les signaux de la ville. `zones` sert
 * uniquement à rattacher les grilles PDF des zones référencées (jointure par
 * clé comparable, comme signal↔zone). Tri : plus cité d'abord, puis numéro.
 */
export function aggregateReglements(
  nodes: GraphSignalNode[],
  zones: GeoZoneFeature[] = [],
): ReglementEntry[] {
  // Grilles PDF indexées par clé de zone comparable (premier lien retenu).
  const grilleByZoneKey = new Map<string, string>();
  for (const zone of zones) {
    const url = zone.properties.grillePdfUrl;
    if (!url) continue;
    const zoneKey = zoneRefComparableKey(zone.properties.code);
    if (zoneKey.length > 0 && !grilleByZoneKey.has(zoneKey)) {
      grilleByZoneKey.set(zoneKey, url);
    }
  }

  const byKey = new Map<string, MutableEntry>();
  const order: string[] = [];

  for (const node of nodes) {
    const numbers = readReglementNumbers(node);
    if (numbers.length === 0) continue;
    const zoneRefs = extractSignalZoneRefs(node);
    const evidence = extractSignalEvidence(node);
    const openable = evidenceOpenable(evidence);
    const hasRaw = evidence.rawRef !== null;

    for (const number of numbers) {
      const key = normalizeReglementKey(number);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          number,
          key,
          signalCount: 0,
          signalNodeIds: [],
          zoneCodes: [],
          grillePdfUrls: [],
          evidenceNodeId: null,
          _seenZone: new Set(),
          _seenGrille: new Set(),
          _hasRawEvidence: false,
        };
        byKey.set(key, entry);
        order.push(key);
      }
      if (!entry.signalNodeIds.includes(node.id)) {
        entry.signalNodeIds.push(node.id);
        entry.signalCount += 1;
      }
      for (const zoneRef of zoneRefs) {
        const zoneKey = zoneRefComparableKey(zoneRef);
        if (zoneKey.length === 0 || entry._seenZone.has(zoneKey)) continue;
        entry._seenZone.add(zoneKey);
        entry.zoneCodes.push(zoneRef);
        const grille = grilleByZoneKey.get(zoneKey);
        if (grille && !entry._seenGrille.has(grille)) {
          entry._seenGrille.add(grille);
          entry.grillePdfUrls.push(grille);
        }
      }
      // Représentant : préférer un signal à rawRef (rendu PDF same-origin),
      // sinon le premier signal à source ouvrable rencontré.
      if (openable) {
        if (hasRaw && !entry._hasRawEvidence) {
          entry.evidenceNodeId = node.id;
          entry._hasRawEvidence = true;
        } else if (entry.evidenceNodeId === null) {
          entry.evidenceNodeId = node.id;
        }
      }
    }
  }

  const entries: ReglementEntry[] = order.map((key) => {
    const entry = byKey.get(key)!;
    return {
      number: entry.number,
      key: entry.key,
      signalCount: entry.signalCount,
      signalNodeIds: entry.signalNodeIds,
      zoneCodes: entry.zoneCodes,
      grillePdfUrls: entry.grillePdfUrls,
      evidenceNodeId: entry.evidenceNodeId,
    };
  });
  entries.sort(
    (a, b) =>
      b.signalCount - a.signalCount || a.number.localeCompare(b.number, "fr"),
  );
  return entries;
}

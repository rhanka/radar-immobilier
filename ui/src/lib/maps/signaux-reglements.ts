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
  extractZoneReglements,
  type GraphSignalNode,
  type SignalEvidence,
} from "$lib/signals/graph-signal-detail-client.js";
import type {
  GeoZoneFeature,
  GeoZonesResponse,
} from "$lib/maps/geo-zones-client.js";
import {
  extractSignalZoneRefs,
  propRecords,
  zoneRefComparableKey,
} from "$lib/maps/signaux-map-geo.js";
import {
  isReglementAvisOnly,
  REGLEMENT_STAGES_FERMES,
} from "@radar/domain";

export { isReglementAvisOnly, REGLEMENT_STAGES_FERMES };

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

/**
 * Titre EXACT du document ouvert depuis le drawer Règlements dans le viewer
 * partagé. Ce document N'EST PAS le PDF du règlement lui-même : aucun texte de
 * règlement n'est modélisé ici. C'est le PROCÈS-VERBAL source du signal
 * représentatif — celui qui CITE ce règlement (cf. `ReglementEntry.evidenceNodeId`).
 *
 * Le titre doit donc marquer explicitement « PV source », distinct :
 *   (a) de la preuve d'un signal (fiche Signaux, « Voir la preuve »),
 *   (b) du PDF de règlement (non disponible),
 *   (c) de la grille de zonage (« Grille de zonage — … »).
 *
 * Sans ce marquage, le PV serait présenté comme s'il était le règlement — la
 * substitution que la spec §3.1 interdit (« distinguish a source document from
 * a regulation or zoning-grid PDF »).
 */
export function reglementSourceViewerTitle(number: string): string {
  return `PV source — règlement ${number}`;
}

/**
 * Numéros de règlement portés par un nœud (tableau ou scalaire), dédupés.
 *
 * Lit AUX DEUX niveaux — `node.props` (top-level) ET `node.props.properties`
 * (imbriqué) — via `propRecords`, car graphify range `reglement_number` sous
 * `props.properties` sur la majorité des villes (154 concernées). Sans cette
 * lecture imbriquée, le drawer Règlements restait vide alors que la donnée
 * existe. C'est exactement le pattern déjà utilisé par `extractSignalZoneRefs`
 * (source unique dans `signaux-map-geo`).
 */
export function readReglementNumbers(node: GraphSignalNode): string[] {
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
  for (const record of propRecords(node)) {
    for (const key of [
      "reglement_number",
      "reglementNumber",
      "reglement_numero",
      "bylaw",
      "reglementNumbers",
    ]) {
      const value = record[key];
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    }
  }
  return out;
}

/** Clé de dédup d'un numéro de règlement : casse + espaces neutralisés. */
export function normalizeReglementKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** Étape servie en 1re-classe, avec repli sur les props des anciens payloads. */
export function readNodeEtape(node: GraphSignalNode): string | null {
  const values = [node.etape, ...propRecords(node).map((record) => record.etape)];
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().toLowerCase();
    }
  }
  return null;
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
  _etapes: Set<string>;
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
    const etape = readNodeEtape(node);

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
          _etapes: new Set(),
        };
        byKey.set(key, entry);
        order.push(key);
      }
      if (etape !== null) entry._etapes.add(etape);
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

  const entries: ReglementEntry[] = order
    .filter((key) => !isReglementAvisOnly(byKey.get(key)!._etapes))
    .map((key) => {
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

/**
 * Injecte le règlement de zonage SOURCÉ DU GRAPHE-SIGNAL dans l'objet zone
 * (`GeoZoneFeature.properties`), keyé par `zoneRefComparableKey(zone.code)`.
 *
 * Contrat (cf. `extractZoneReglements`) :
 *   - LE GEO GAGNE : une zone qui porte déjà un `reglementNumero` servi par geo
 *     n'est JAMAIS écrasée — le graphe-signal ne fait que combler les zones que
 *     geo laisse muettes.
 *   - Rattachement HONNÊTE : seules les zones qu'un nœud co-localise avec un
 *     `reglement_number` (même-nœud) sont enrichies ; aucune zone sans match
 *     n'est touchée (« Règlement non renseigné » préservé).
 *   - `reglementUrl` = `sourceUrl` PUBLIQUE du nœud (nouvel onglet), jamais un
 *     lien d'archive.
 *
 * Non destructif : renvoie la MÊME référence quand rien ne change (aucun
 * règlement dérivable, ou toutes les zones déjà servies par geo).
 */
export function enrichGeoZonesWithSignalReglements(
  response: GeoZonesResponse | null,
  nodes: readonly GraphSignalNode[],
): GeoZonesResponse | null {
  if (!response) return response;
  const byZoneKey = extractZoneReglements(nodes);
  if (byZoneKey.size === 0) return response;

  let changed = false;
  const features = response.featureCollection.features.map((feature) => {
    // Le geo gagne : numéro déjà servi → on ne touche pas.
    if (feature.properties.reglementNumero) return feature;
    const key = zoneRefComparableKey(feature.properties.code);
    if (key.length === 0) return feature;
    const reg = byZoneKey.get(key);
    if (!reg) return feature;
    changed = true;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        reglementNumero: reg.numero,
        ...(reg.millesime !== null ? { reglementMillesime: reg.millesime } : {}),
        ...(reg.url !== null ? { reglementUrl: reg.url } : {}),
      },
    };
  });

  if (!changed) return response;
  return {
    ...response,
    featureCollection: { ...response.featureCollection, features },
  };
}

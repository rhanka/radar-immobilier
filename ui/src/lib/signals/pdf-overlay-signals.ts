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
  type SignalEvidence,
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
  /**
   * #4 — Vrai si le signal est DANS le filtre actif. Les signaux du même PV
   * HORS-FILTRE restent surlignés mais en SLATE désaturé + badge creux (le
   * viewer les peint différemment, et un toggle peut les masquer). Optionnel :
   * absent ⇒ traité comme dans-filtre (rétrocompat LOT 1/2).
   */
  inFilter?: boolean;
}

/**
 * Borne de signaux surlignés simultanément. Un PV à 56 signaux noierait la page
 * de badges illisibles ; on borne à un nombre raisonnable. Le signal courant
 * est TOUJOURS inclus (placé en tête), les autres complètent jusqu'à la borne.
 * Choix par défaut : 12 (lève l'essentiel du besoin « tous visibles » sans
 * saturer ; à ajuster après retour produit).
 */
export const MAX_OVERLAY_SIGNALS = 12;

/**
 * Un signal projeté pour la NAVIGATION (#91) du viewer de preuve. Distinct
 * d'`OverlaySignal` (surlignage du DOC courant) : `navSignals` est la liste
 * FILTRÉE COMPLÈTE du parent (ordre du pane droit), potentiellement MULTI-DOC.
 * Le viewer s'en sert pour la rangée nav (◀ Signal ▶, compteur i/N, menu « aller
 * à »), le passage intra-/cross-PDF et le reflet du filtre. Le viewer NE refiltre
 * PAS : il consomme cette liste + l'index courant et notifie le parent.
 */
export interface OverlayNavSignal {
  /** Identifiant technique du nœud (ancre de réconciliation parent ↔ viewer). */
  id: string;
  /** Libellé court (badge + menu). */
  label: string;
  /** Couleur stable du signal (hex) — cohérente pane droit ↔ overlay. */
  color: string;
  /** Page cible (1-based) ou null si inconnue. */
  page: number | null;
  /**
   * Identité du DOCUMENT du signal — clé de regroupement cross-PDF.
   * `rawRef ?? rawObjectKey ?? documentUrl ?? sourceUrl ?? docSha`.
   */
  docId: string;
  /** Titre lisible du document (pour le menu groupé + l'indicateur PDF i/N). */
  docTitle: string;
  /**
   * Vrai si le signal est DANS le filtre actif. Toujours true ici (navSignals =
   * liste filtrée), mais conservé pour les variantes où l'on injecte des
   * hors-filtre dans la nav. Le surlignage hors-filtre (#4) vit dans `signals`.
   */
  inFilter: boolean;
  /** Évidence complète — sert au parent pour rouvrir/cross-charger le doc. */
  evidence: SignalEvidence;
}

/**
 * Identité du document d'un signal, pour le regroupement/passage cross-PDF. On
 * préfère `rawRef` (clé de la route interne /api/documents/raw, stable et
 * CORS-safe) puis les autres ancres, et en dernier `docSha`. Jamais null (au
 * pire le docSha synthétique de `extractSignalEvidence`).
 */
export function docIdentityOf(ev: SignalEvidence): string {
  return (
    ev.rawRef ??
    ev.rawObjectKey ??
    ev.documentUrl ??
    ev.sourceUrl ??
    ev.sourceRef ??
    ""
  );
}

/**
 * Projette la liste FILTRÉE de nœuds (ordre du pane droit) en navSignals pour le
 * viewer. La couleur est attribuée par RANG dans cette liste (déterministe), de
 * sorte que le pane droit puisse réutiliser le même rang pour sa pastille.
 * Le `docTitle` reprend le label du 1er signal d'un doc à défaut d'un meilleur
 * intitulé (un PV n'a pas de titre propre dans le DTO).
 */
export function buildNavSignals(
  filteredNodes: readonly GraphSignalNode[],
): OverlayNavSignal[] {
  const seenDocTitle = new Map<string, string>();
  return filteredNodes.map((node, index) => {
    const ev = extractSignalEvidence(node);
    const docId = docIdentityOf(ev);
    if (docId && !seenDocTitle.has(docId)) {
      // Titre du doc : on prend une forme lisible du rawRef (nom de fichier) à
      // défaut d'un intitulé fourni par le DTO.
      seenDocTitle.set(docId, docTitleFromEvidence(ev) ?? shortLabel(node));
    }
    return {
      id: node.id,
      label: shortLabel(node),
      color: signalColorAt(index),
      page: ev.page,
      docId,
      docTitle: docId ? (seenDocTitle.get(docId) ?? "") : "",
      inFilter: true,
      evidence: ev,
    };
  });
}

/** Nombre de documents DISTINCTS couverts par une liste de navSignals. */
export function distinctDocCount(navSignals: readonly OverlayNavSignal[]): number {
  const docs = new Set<string>();
  for (const s of navSignals) if (s.docId) docs.add(s.docId);
  return docs.size;
}

/**
 * #4 — Données de la HOVER-CARD d'un signal (popover non-modal au survol d'un
 * signal HORS-FILTRE). Miroir compact de la fiche du pane droit : titre, type,
 * règlement, zone, dates, page, citation, chips de complétude. Projection pure
 * d'un nœud → la carte est rendue par le viewer sans connaître la forme du DTO.
 */
export interface HoverCardData {
  id: string;
  title: string;
  typeLabel: string;
  color: string;
  reglement: string | null;
  zoneRef: string | null;
  publishedAt: string | null;
  documentDate: string | null;
  page: number | null;
  citation: string | null;
  completeness: { label: string; ok: boolean }[];
}

function readPropString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Projette un nœud en données de hover-card (#4). `color` = teinte du signal. */
export function buildHoverCard(
  node: GraphSignalNode,
  color: string,
): HoverCardData {
  const ev = extractSignalEvidence(node);
  const p = node.props;
  const reglement =
    readPropString(p.reglement_number) ??
    readPropString(p.reglementNumber) ??
    readPropString(p.bylaw) ??
    null;
  const zoneRaw = p.zone_ref ?? p.zoneRef ?? p.zone ?? p.zones;
  const zoneRef = Array.isArray(zoneRaw)
    ? zoneRaw.map(String).join(", ")
    : readPropString(zoneRaw);
  const citation = ev.excerpt ?? ev.citation ?? null;
  return {
    id: node.id,
    title: node.label,
    typeLabel:
      node.type === "DesignationEvent" ? "Événement de désignation" : node.type,
    color,
    reglement,
    zoneRef,
    publishedAt: node.publishedAt ?? null,
    documentDate: ev.documentDate,
    page: ev.page,
    citation: citation && citation.length > 260 ? `${citation.slice(0, 260)}…` : citation,
    completeness: [
      { label: "Description", ok: ev.completeness.hasDescription },
      { label: "Citation", ok: ev.completeness.hasCitationExcerpt },
      { label: "PDF/source", ok: ev.completeness.hasPdfLink },
      { label: "Page", ok: ev.completeness.hasPage },
      { label: "BBox", ok: ev.completeness.hasBbox },
    ],
  };
}

/** Titre lisible d'un doc : nom de fichier du rawRef, sinon hôte du sourceUrl. */
function docTitleFromEvidence(ev: SignalEvidence): string | null {
  if (ev.rawRef) {
    const tail = ev.rawRef.split("/").pop() ?? ev.rawRef;
    return tail.replace(/\.pdf$/i, "");
  }
  if (ev.sourceUrl) {
    try {
      return new URL(ev.sourceUrl).pathname.split("/").pop() ?? ev.sourceUrl;
    } catch {
      return ev.sourceUrl;
    }
  }
  return null;
}

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
 * @param isInFilter   #4 — prédicat « ce nœud est-il dans le filtre actif ? ».
 *   Tous les signaux du PV sont surlignés ; ceux HORS-FILTRE seront peints en
 *   slate désaturé par le viewer. Absent ⇒ tous traités comme dans-filtre.
 */
export function buildOverlaySignals(
  currentNode: GraphSignalNode,
  allNodes: readonly GraphSignalNode[],
  targetRawRef: string | null,
  isInFilter?: (node: GraphSignalNode) => boolean,
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
    // Le courant est toujours dans-filtre (on l'a ouvert depuis la liste).
    const inFilter =
      node.id === currentNode.id || !isInFilter || isInFilter(node);
    return {
      id: node.id,
      label: shortLabel(node),
      excerpt: ev.excerpt ?? ev.citation ?? null,
      page: ev.page,
      color: signalColorAt(index),
      current: node.id === currentNode.id,
      inFilter,
    };
  });
}

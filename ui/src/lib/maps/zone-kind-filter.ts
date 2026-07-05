/**
 * zone-kind-filter — filtre par TYPE de zone (kind) de la vue Signaux.
 *
 * En-tête de l'accordéon ZONES du drawer droit : chips additives par famille
 * de zonage (Habitation, Commercial, Industriel…) — MÊMES catégories que la
 * légende zonage (`zone-kind-style`), aucune liste dupliquée : les groupes
 * sont DÉRIVÉS de `ZONE_KIND_STYLES` (libellés compris).
 *
 * Sémantique identique au filtre lots (`eval-lot-filters`) :
 * - sélection ADDITIVE : ensemble vide = toutes les zones ;
 * - ZÉRO refetch : chaque changement ne fait que recalculer la peinture
 *   MapLibre (zones matchées accentuées, hors-filtre estompées mais
 *   toujours visibles) ;
 * - dégradé honnête : une zone au kind irrésolu appartient au groupe
 *   « Type non déterminé » — on n'invente pas de famille.
 */

import {
  canonicalZoneKind,
  ZONE_KIND_STYLES,
  ZONE_KIND_NEUTRAL,
  type StyledZoneKind,
} from "./zone-kind-style.js";

/**
 * Groupe de filtre = entrée de légende. CONS et REC partagent teinte ET
 * libellé (« Conservation / récréation ») → un seul groupe `CONS_REC`.
 * `UNRESOLVED` = zones au kind irrésolu (« Type non déterminé »).
 */
export type ZoneKindGroupId =
  | "H"
  | "MIXTE"
  | "C"
  | "I"
  | "P"
  | "A"
  | "CONS_REC"
  | "U"
  | "UNRESOLVED";

export interface ZoneKindGroup {
  id: ZoneKindGroupId;
  /** Libellé client — repris tel quel de la légende zonage (zone-kind-style). */
  label: string;
}

/** Groupes dans l'ordre stable de la légende (labels dérivés, pas dupliqués). */
export const ZONE_KIND_GROUPS: ReadonlyArray<ZoneKindGroup> = [
  { id: "H", label: ZONE_KIND_STYLES.H.label },
  { id: "MIXTE", label: ZONE_KIND_STYLES.MIXTE.label },
  { id: "C", label: ZONE_KIND_STYLES.C.label },
  { id: "I", label: ZONE_KIND_STYLES.I.label },
  { id: "P", label: ZONE_KIND_STYLES.P.label },
  { id: "A", label: ZONE_KIND_STYLES.A.label },
  { id: "CONS_REC", label: ZONE_KIND_STYLES.CONS.label },
  { id: "U", label: ZONE_KIND_STYLES.U.label },
  { id: "UNRESOLVED", label: ZONE_KIND_NEUTRAL.label },
];

/** Filtre TYPE de zone : groupes retenus (additif). Vide = toutes les zones. */
export type ZoneKindFilter = ReadonlySet<ZoneKindGroupId>;

export const DEFAULT_ZONE_KIND_FILTER: ZoneKindFilter = new Set<ZoneKindGroupId>();

export function isDefaultZoneKindFilter(filter: ZoneKindFilter): boolean {
  return filter.size === 0;
}

/**
 * Groupe de filtre d'une zone, résolu depuis son affectation/kind/code via la
 * MÊME résolution tolérante que la légende (`canonicalZoneKind`).
 */
export function zoneKindGroupId(
  kind: string | null | undefined,
  code: string | null | undefined,
  affectation?: string | null,
): ZoneKindGroupId {
  const canonical: StyledZoneKind | null = canonicalZoneKind(kind, code, affectation);
  if (canonical === null) return "UNRESOLVED";
  if (canonical === "CONS" || canonical === "REC") return "CONS_REC";
  return canonical;
}

/** true si la zone matche le filtre (filtre vide = tout matche). */
export function zoneMatchesKindFilter(
  kind: string | null | undefined,
  code: string | null | undefined,
  filter: ZoneKindFilter,
  affectation?: string | null,
): boolean {
  if (filter.size === 0) return true;
  return filter.has(zoneKindGroupId(kind, code, affectation));
}

/** Compte les zones matchées (compteur « N / M » de l'en-tête de filtre). */
export function countZoneKindMatches(
  zones: ReadonlyArray<{ kind?: string | null; code: string; affectation?: string | null }>,
  filter: ZoneKindFilter,
): number {
  let count = 0;
  for (const zone of zones) {
    if (zoneMatchesKindFilter(zone.kind ?? null, zone.code, filter, zone.affectation ?? null)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Compte de zones PAR groupe (chips avec compteurs). Seuls les groupes
 * réellement présents apparaissent — même contrat que la légende
 * (`zoneKindLegend`) : on ne propose pas de filtre sans zone derrière.
 */
export function zoneKindGroupCounts(
  zones: ReadonlyArray<{ kind?: string | null; code: string; affectation?: string | null }>,
): ReadonlyMap<ZoneKindGroupId, number> {
  const counts = new Map<ZoneKindGroupId, number>();
  for (const zone of zones) {
    const id = zoneKindGroupId(zone.kind ?? null, zone.code, zone.affectation ?? null);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ── Peinture pilotée par le filtre TYPE ──────────────────────────────────────
// Même mécanique que le filtre lots (#315) : matchées accentuées, hors-filtre
// estompées (JAMAIS masquées), zéro refetch.

/** Zone hors-filtre : estompée mais toujours visible (parité mécanique lots). */
export const ZONE_KIND_FILTER_DIMMED_OPACITY = 0.06;
/** Zone matchée : teinte accentuée (ressort de la base 0.25). */
export const ZONE_KIND_FILTER_MATCH_OPACITY = 0.45;

/**
 * Opacité pilotée par le filtre TYPE — `null` quand le filtre est inactif
 * (la hiérarchie d'opacité existante s'applique alors sans changement).
 */
export function zoneKindFilterOpacity(
  kind: string | null | undefined,
  code: string | null | undefined,
  filter: ZoneKindFilter,
  affectation?: string | null,
): number | null {
  if (filter.size === 0) return null;
  return zoneMatchesKindFilter(kind, code, filter, affectation)
    ? ZONE_KIND_FILTER_MATCH_OPACITY
    : ZONE_KIND_FILTER_DIMMED_OPACITY;
}

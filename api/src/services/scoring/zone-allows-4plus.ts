/**
 * Dérivation « la zone permet-elle le multifamilial 4 logements et plus ? »
 * — calcul pur, sans accès DB ni réseau.
 *
 * ## Problème
 * Les flags `multifamilial4plus` n'étaient peuplés qu'en mode simulation
 * carte-Steve (copiés des fixtures). Cette fonction les dérive des données de
 * zone RÉELLEMENT disponibles, en étant honnête sur la source :
 *
 *   - `confidence: "grille"`      — dérivé de données de grille réelles
 *     (densiteLogHa et/ou usages fournis par la source de zonage).
 *   - `confidence: "heuristique"` — dérivé du kind de zone uniquement
 *     (aucune donnée de grille disponible), via la MÊME table de densités
 *     estimées que le mode carte-Steve (`densiteLogHaFromKind`, zone-kind.ts).
 *
 * ## Seuil (aligné sur la logique existante)
 * `MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA = 20` log/ha, STRICTEMENT dépassé.
 * Justification tracée :
 *   - zone-kind.ts documente 20 log/ha = « R unifamilial dense à bifamilial »
 *     (donc PAS de 4 logements+) et 40 log/ha (mixte) = « immeuble + commerce
 *     en RDC » (4 logements+ plausible).
 *   - lot-potential.ts borne sa bande « très faible, rural » à d ≤ 20.
 * Donc : d > 20 → multifamilial 4+ permis ; d ≤ 20 → non.
 *
 * ## Anti-invention
 * - `densiteLogHa` / `usages` doivent être des données de grille RÉELLES.
 *   Ne PAS passer ici des valeurs déjà estimées par heuristique (sinon la
 *   confidence "grille" mentirait) — passer null / [] à la place.
 * - Sans donnée de grille, seule la zone MIXTE (densité estimée 40 > 20)
 *   ressort true. Les zones H sans grille ressortent false : c'est une
 *   SOUS-couverture assumée (beaucoup de zones H permettent le 4+ via leur
 *   grille, mais on ne l'invente pas tant que la grille n'est pas branchée).
 */

import type { ZoneKind } from "./lot-potential.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZoneAllows4PlusInput {
  /** Type de zone canonique (SPEC_DESIGN_DATA_MODEL §1.1). */
  kind: ZoneKind;
  /**
   * Densité RÉELLE de la grille en logements/hectare.
   * null = non disponible (ne pas passer une estimation heuristique ici).
   */
  densiteLogHa: number | null;
  /**
   * Usages permis RÉELS de la grille (codes ou libellés).
   * [] = non disponibles (ne pas passer des usages estimés par kind ici).
   */
  usages: string[];
}

export interface ZoneAllows4PlusResult {
  /** true si la zone permet le multifamilial 4 logements et plus. */
  allows4Plus: boolean;
  /**
   * Source de la dérivation :
   *   - "grille"      : densiteLogHa et/ou usages réels fournis.
   *   - "heuristique" : kind de zone seul (table alignée sur le mode Steve).
   */
  confidence: "grille" | "heuristique";
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Densité (log/ha) au-delà de laquelle (STRICTEMENT) le multifamilial 4+
 * est considéré permis. Voir justification dans l'en-tête du fichier.
 */
export const MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA = 20;

/**
 * Densités estimées par kind canonique — MIROIR de DENSITE_BY_KIND
 * (services/geo/simulation/zone-kind.ts) après mapping canonique
 * (canonicalKindFromSimKind). La cohérence est verrouillée par test
 * (zone-allows-4plus.test.ts) plutôt que par import, pour ne pas faire
 * dépendre la couche scoring de la couche simulation.
 */
const HEURISTIC_DENSITE_BY_KIND: Record<ZoneKind, number> = {
  H: 20, // habitation — unifamilial dense à bifamilial
  MIXTE: 40, // mixte — immeuble + commerce en RDC
  C: 0,
  U: 0,
  I: 0,
  P: 0,
  A: 0,
  CONS: 0,
  REC: 0,
  AUTRE: 0,
};

/**
 * Motif d'usage de grille indiquant explicitement le multi-logements.
 * Couvre les libellés rencontrés dans les grilles QC et les fixtures Steve :
 * « multi-logements », « multifamilial », « multifamiliale 4 logements + »,
 * « triplex/quadruplex » (plex 4+ traité au niveau du 4).
 */
const MULTI_USAGE_RE = /multi[\s-]?logement|multifamilial|quadruplex|4\s*(logements?|log\.?)\s*(et\s*)?(\+|plus)/i;

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Dérive « la zone permet le 4 logements et plus » depuis les données de zone
 * disponibles. Voir l'en-tête du fichier pour la sémantique complète.
 *
 * Règles :
 *   1. Donnée de grille présente (densiteLogHa non-null OU usages non vides)
 *      → confidence "grille" ; true si densité > 20 log/ha OU si un usage
 *      matche explicitement le multi-logements. Une grille présente qui ne
 *      matche pas → false (la grille fait foi, y compris négativement).
 *   2. Aucune donnée de grille → confidence "heuristique" ; densité estimée
 *      par kind (H=20, MIXTE=40, autres=0 — table Steve) comparée au même
 *      seuil → seul MIXTE ressort true.
 */
export function zoneAllows4Plus(
  zone: ZoneAllows4PlusInput,
): ZoneAllows4PlusResult {
  const hasGrilleDensite =
    zone.densiteLogHa !== null && Number.isFinite(zone.densiteLogHa);
  const hasGrilleUsages = zone.usages.length > 0;

  if (hasGrilleDensite || hasGrilleUsages) {
    const byDensite =
      hasGrilleDensite &&
      (zone.densiteLogHa as number) > MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA;
    const byUsages =
      hasGrilleUsages && zone.usages.some((u) => MULTI_USAGE_RE.test(u));
    return { allows4Plus: byDensite || byUsages, confidence: "grille" };
  }

  const estimated = HEURISTIC_DENSITE_BY_KIND[zone.kind] ?? 0;
  return {
    allows4Plus: estimated > MULTIFAMILIAL_4PLUS_MIN_DENSITE_LOG_HA,
    confidence: "heuristique",
  };
}

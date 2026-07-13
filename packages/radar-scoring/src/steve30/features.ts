/**
 * Steve-30 convergence — FEATURE BOOK (transparent, rule-based, NO ML).
 *
 * Steve Chaperon rated 30 pilot cities on a /10 scale that measures the
 * ACQUISITION INTEREST of an opportunity — NOT the detection quality
 * (his own words, §3 intro of the cahier). This module turns each of the
 * criteria he applies by hand into a small set of MEASURABLE features, and
 * defines the named, documented weights that map those features to a score.
 *
 * Design constraints (docs/reports/steve-analyse-complete-planifiee §4):
 *  - Explicable: every point of the score traces to one named weight and one
 *    sourced feature value.
 *  - No invention: a feature Steve did not state is `null`, never guessed. A
 *    null core feature triggers an uncertainty penalty, never a made-up value.
 *  - 30 labels are enough to CALIBRATE weights and catch gross inversions —
 *    NOT enough to train a robust ML model. Hence a weighted rule function.
 *
 * The output score is on a 0..10 scale to be directly comparable to Steve's
 * /10. Only the RANK matters for convergence (Spearman), so the absolute
 * scale is a readability choice, not a claim of point-for-point equivalence.
 */

// ── Feature vocabularies ────────────────────────────────────────────────
// Each vocabulary traces to the taxonomy in §4.3 of the planned analysis and
// to the verbatim verdicts of §3 (steve-eval-analyse-plan).

/** Is the signal about residential densification (Steve's target) or noise? */
export type ResidentialRelevance = "residential" | "non_residential";

/**
 * Substantive nature of the regulatory change. Ordered by acquisition value
 * in Steve's cahier: a full rezoning (refonte complète) is "often the best
 * source of opportunities" (§2.1) and the only 10/10s; a mere assouplissement
 * or petition is weak context.
 */
export type ChangeNature =
  | "refonte_complete" // full zoning overhaul (Saint-Stanislas, Sutton, Saint-Raphaël)
  | "levee_rci" // lifting an interim control bylaw / moratorium (Sutton)
  | "densification_multi" // strong multi-unit densification (HC zones, forte densité)
  | "ppcmoi" // project-specific bylaw creating a zone-wide precedent (Coaticook)
  | "cptaq" // agricultural exclusion/authorization request (Neuville)
  | "densification_mineure" // minor densification (unifamilial → duplex)
  | "assouplissement" // general loosening, not a direct opportunity (Champlain)
  | "petition" // citizen petition, no bylaw number (Saint-Côme-Linière)
  | "non_residentiel"; // industrial / commercial / camping / environmental (noise)

/**
 * Regulatory stage at which the signal was captured. Earlier = more advance
 * ("longueur d'avance", §2.1). Ordre du jour precedes the PV (Neuville);
 * avis de motion is "the very first regulatory step" (Rosemère).
 */
export type Earliness =
  | "ordre_du_jour"
  | "avis_de_motion"
  | "projet"
  | "consultation"
  | "adopte"
  | "en_vigueur";

/** How much of the regulatory substrate (grille/zone) is already usable. */
export type RegulatoryExploitability =
  | "grille_et_lot" // grid AND lots already carved by the city (Saint-Raphaël)
  | "grille_ou_zone" // grid or zone found/identified (Saint-Boniface, Sutton)
  | "zone_seule" // only the zone reference (Coaticook RD-104, lots missing)
  | "aucune"; // nothing usable yet (bylaw not even online)

/** Whether candidate lots are usable for the analysis. */
export type LandExploitability =
  | "lots_confirmes" // lots present and usable
  | "lots_candidats" // subdividable/candidate lots to confirm (Saint-Gilbert)
  | "lots_manquants"; // lots missing from the radar map (Coaticook)

/**
 * Owner status. Steve: "a private individual is more likely to sell than a
 * holding company" (§5 E7). A promoter/firm/holding/city owner is a strong
 * negative on acquisition interest.
 */
export type OwnerType =
  | "particulier"
  | "ferme"
  | "investisseur"
  | "promoteur"
  | "firme_immobiliere"
  | "societe_portefeuille"
  | "ville";

/**
 * Project scale relative to a small developer. "Too massive" (Rosemère) or
 * "tailor-made for a promoter" (Mont-Saint-Hilaire S1) are disqualifying.
 */
export type ProjectScale = "exploitable" | "trop_massif" | "sur_mesure_promoteur";

/** Distance to Montréal — a hypothesis to validate with Steve (S20). */
export type DistanceMtl = "proche" | "eloigne";

/**
 * The measurable feature vector for one signal. Every field is nullable:
 * a feature Steve did not state is `null` (never invented). Null core
 * features (nature, earliness, residentialRelevance) drive the uncertainty
 * penalty.
 */
export interface SteveFeatures {
  residentialRelevance: ResidentialRelevance | null;
  changeNature: ChangeNature | null;
  earliness: Earliness | null;
  regulatoryExploitability: RegulatoryExploitability | null;
  landExploitability: LandExploitability | null;
  zonePrecedent: boolean | null; // PPCMOI / prior derogation in the same zone
  ownerType: OwnerType | null;
  projectScale: ProjectScale | null;
  distanceMtl: DistanceMtl | null;
}

// ── Named, documented weights (the v0 calibration) ──────────────────────
// These weights were calibrated ONCE against Steve's 30 notes (a weighted
// rule fit, not a post-hoc fudge): the ordering they induce is validated by
// the Spearman metric in convergence.ts. Adjusting them is a deliberate,
// traceable act — bump STEVE30_SCORE_VERSION when you do.

export const STEVE30_SCORE_VERSION = "v0";

/** Positive contribution of the substantive change nature (0..5). */
export const NATURE_POINTS: Record<ChangeNature, number> = {
  refonte_complete: 5.0,
  levee_rci: 4.5,
  densification_multi: 4.0,
  ppcmoi: 3.5,
  cptaq: 2.5,
  densification_mineure: 2.5,
  assouplissement: 1.5,
  petition: 1.0,
  non_residentiel: 0.0,
};

/** Positive contribution of earliness (0..1.5) — the "longueur d'avance". */
export const EARLINESS_POINTS: Record<Earliness, number> = {
  ordre_du_jour: 1.5,
  avis_de_motion: 1.5,
  projet: 1.0,
  consultation: 0.8,
  adopte: 0.5,
  en_vigueur: 0.3,
};

/** Positive contribution of regulatory exploitability (0..2). */
export const REG_EXPLOIT_POINTS: Record<RegulatoryExploitability, number> = {
  grille_et_lot: 2.0,
  grille_ou_zone: 1.2,
  zone_seule: 0.6,
  aucune: 0.0,
};

/** Positive contribution of land exploitability (0..1.5). */
export const LAND_EXPLOIT_POINTS: Record<LandExploitability, number> = {
  lots_confirmes: 1.5,
  lots_candidats: 0.7,
  lots_manquants: 0.0,
};

/** Positive contribution of a zone precedent (PPCMOI/derogation). */
export const PRECEDENT_POINTS = 1.0;

/** Positive contribution of proximity to Montréal. */
export const DISTANCE_POINTS: Record<DistanceMtl, number> = {
  proche: 1.0,
  eloigne: 0.0,
};

/** Negative contribution (penalty ≤ 0) of the owner status. */
export const OWNER_PENALTY: Record<OwnerType, number> = {
  particulier: 0.0,
  ferme: 0.0,
  investisseur: -0.5,
  promoteur: -2.5,
  firme_immobiliere: -3.0,
  societe_portefeuille: -3.0,
  ville: -2.0,
};

/** Negative contribution (penalty ≤ 0) of the project scale. */
export const SCALE_PENALTY: Record<ProjectScale, number> = {
  exploitable: 0.0,
  trop_massif: -3.5,
  sur_mesure_promoteur: -4.0,
};

/**
 * Core features whose absence yields an uncertainty penalty. Kept to the
 * three features Steve always states in his cahier, so the penalty is inert
 * on the calibration set but ACTIVE when the same model is applied to the
 * 1104 municipalities where these may be missing (§4.6).
 */
export const CORE_FEATURES = [
  "residentialRelevance",
  "changeNature",
  "earliness",
] as const satisfies readonly (keyof SteveFeatures)[];

/** Penalty per missing core feature (applied after the positive build-up). */
export const UNCERTAINTY_PER_MISSING = -0.1;

/** Score bounds (mirrors Steve's /10). */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

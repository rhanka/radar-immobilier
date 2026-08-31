import { z } from "zod";
import { TemporalSpan } from "../temporal.js";
import { OntoRelationType } from "./relations-generated.js";

/**
 * LOT 1 — cycle de vie règlement (avis de motion → projet → adoption → en vigueur).
 * Contrat gelé geo↔immo `5f7ca0a9` (§2.1 en_vigueur 3-états, §3.1 relations α discriminées).
 *
 * Ce fichier héberge les briques RÉUTILISÉES par les nœuds d'ontologie (entities.ts)
 * ET par les projections (relations.ts), sans cycle d'import : il n'importe NI
 * entities.ts NI relations.ts (seulement temporal.ts + le fichier généré).
 * `RegulatoryStageKind`/`RegulatoryStageOutcome` y sont DÉPLACÉS depuis relations.ts
 * (réutilisés comme `statut` de nœud) ; relations.ts les ré-exporte (back-compat).
 */

// ── RegulatoryStageKind / Outcome — cycle de vie légal QC (8 étapes) ──────────
// Le 3-étapes owner (avis→projet→adopté) est un SOUS-ENSEMBLE/groupement de ces 8.
export const RegulatoryStageKind = z.enum([
  "avis-motion",
  "1er-projet",
  "consultation-publique",
  "2e-projet",
  "registre-referendaire",
  "adopte",
  "entree-vigueur",
  "abandonne",
]);
export type RegulatoryStageKindT = z.infer<typeof RegulatoryStageKind>;

export const RegulatoryStageOutcome = z.enum(["passed", "failed", "pending", "non-disponible"]);
export type RegulatoryStageOutcomeT = z.infer<typeof RegulatoryStageOutcome>;

// ── EnVigueurProvenance — 3 ÉTATS (contrat §2.1, anti-invention) ──────────────
// La dérivation est elle-même verbatim-ou-UNKNOWN : une date d'entrée en vigueur
// n'est `derived` que si le DÉLAI légal est connu/verbatim ; délai absent → `unknown`,
// JAMAIS une date fabriquée (adoption + X-jours-devinés = invention).
export const EnVigueurProvenance = z.enum([
  "verbatim", // date d'entrée en vigueur servie verbatim par geo
  "derived",  // dérivée d'un délai légal CONNU/verbatim
  "unknown",  // délai absent → non-dérivable, jamais devinée
]);
export type EnVigueurProvenanceT = z.infer<typeof EnVigueurProvenance>;

// ── OntoRelation — relation TYPÉE-IMMO discriminée (α, contrat §3.1) ──────────
// Les libellés-relation sont émis VERBATIM par geo ; immo TYPE la relation.
// `relationType` = z.string() (PAS z.enum) → §9 : un type INCONNU est ignoré/passé,
// pas un crash ; toute ADDITION de valeur = minor-version. Le set CONNU =
// `KNOWN_RELATION_TYPES` (dérivé de `OntoRelationType`, généré depuis le YAML
// single-source, DETTE #54) — le consommateur switch dessus et ignore le reste.
export const KNOWN_RELATION_TYPES = OntoRelationType.options;

export const OntoRelation = z.object({
  relationType: z.string().min(1),
  target: z.union([
    // A1-safe : le n° de règlement vit dans la CIBLE, jamais dans l'identité d'event (§5).
    z.object({ reglementNumero: z.string().min(1) }),
    z.object({ nodeId: z.string().uuid() }),
  ]),
  /** Libellé verbatim émis par geo (matériau du typage) ; null pour lifecycle_predecessor (dérivé n°+ordre-stages). */
  fromLibelle: z.string().nullable().default(null),
  typingConfidence: z.enum(["certain", "uncertain"]).default("certain"),
  /** Libellé peu clair / `amends` incertain → flaggé pour revue, JAMAIS deviné (S6/§8). */
  flagged: z.boolean().default(false),
});
export type OntoRelationT = z.infer<typeof OntoRelation>;

// ── type_instrument — famille d'instrument réglementaire (contrat §10, owner (b)+plan surface-distincte) ──
// geo émet `type_instrument: string|null` DÉCLARÉ-SOURCE verbatim (connu-ou-toléré §9), OU le littéral
// "unknown" (titre absent/ambigu), OU null (legacy/non-peuplé). geo NE CLASSIFIE PAS ; immo consomme le
// déclaré-source. z.string() (PAS z.enum) → §9 tolère-inconnu : une valeur hors set connu est
// ignorée/bucketée par le consommateur, jamais un crash. Le set CONNU = KNOWN_TYPE_INSTRUMENTS
// (routage : bylaw-family→contrainte ferme, plan-urbanisme→surface intention-grade distincte, case→par-cas).
// ⚠ AXE INSTRUMENT, ORTHOGONAL AU RÉGIME : le régime (bylaw vs case) est document_type-driven, PAS
// type_instrument — un règlement HABILITANT (« sur les dérogations mineures ») est un bylaw à cycle
// complet portant type_instrument=derogation. D'où typeInstrument sur les DEUX nœuds (Bylaw + DesignationEvent).
export const KNOWN_TYPE_INSTRUMENTS = [
  "zonage",
  "lotissement",
  "construction",
  "plan-urbanisme",
  "piia",
  "derogation",
] as const;
export type KnownTypeInstrument = (typeof KNOWN_TYPE_INSTRUMENTS)[number];

/** Champ partagé type_instrument : string|null §9-tolérant (miroir exact de l'émission geo `type_instrument`). */
const typeInstrumentField = z.string().nullable().default(null);

// ── regulatoryStatus — axe FERME vs ANTICIPATION dérivé-immo (LOT 1 serving, invariant §3) ───────────
// DÉRIVÉ par immo (PAS émis geo) via `deriveRegulatoryStatus` = source UNIQUE de classification (D1) :
// firm iff statut ∈ {adopte, entree-vigueur} ; sinon anticipation. PERSISTÉ à la matérialisation
// (`upsertGraphAtomic`) = source unique de vérité DATA, lue par TOUS les consommateurs (0 re-classification
// serve-time = la cause racine de « 026-508 »). `null` = legacy non-dérivé → le consommateur applique le
// fallback anticipation-conservateur (JAMAIS firm sans preuve). Binaire (pas de 3e bucket) :
// abrogé = firm + `temporal.validTo` fermé ; abandonné = anticipation + `statut=abandonne`.
export const RegulatoryStatus = z.enum(["firm", "anticipation"]);
export type RegulatoryStatusT = z.infer<typeof RegulatoryStatus>;
const regulatoryStatusField = RegulatoryStatus.nullable().default(null);

/** D1/D2 (LOT 1 serving invariant §3) — LE classifieur UNIQUE ferme/anticipation. Appelé à la
 *  matérialisation (`upsertGraphAtomic`) pour PERSISTER `regulatoryStatus`, et réutilisé (MÊME fn)
 *  comme fallback serve-time pour un nœud legacy sans champ — jamais une re-dérivation indépendante.
 *  Ordre de preuve : `statut` (LOT 1.b autoritatif) → sinon `etape` legacy structuré → JAMAIS un
 *  mot-clé. Aucune preuve (statut ET etape absents) → `anticipation` FAIL-SAFE (jamais firm sans
 *  preuve = anti-invention). Binaire : un bylaw abrogé reste firm (statut adopté/en-vigueur) avec
 *  `temporal.validTo` fermé ; abandonné = anticipation (statut=abandonne). */
const FIRM_STATUTS: ReadonlySet<RegulatoryStageKindT> = new Set(["adopte", "entree-vigueur"]);
const FIRM_ETAPES: ReadonlySet<string> = new Set(["adoption", "entree_vigueur"]);
export function deriveRegulatoryStatus(input: {
  statut?: RegulatoryStageKindT | null;
  etape?: string | null;
}): RegulatoryStatusT {
  if (input.statut != null) return FIRM_STATUTS.has(input.statut) ? "firm" : "anticipation";
  if (input.etape != null) return FIRM_ETAPES.has(input.etape) ? "firm" : "anticipation";
  return "anticipation";
}

// ── Champs de cycle de vie ajoutés aux nœuds (appliqués dans entities.ts) ─────
/** DesignationEvent (avis/projet) : statut + cible + bitemporel + relations + instrument. */
export const designationLifecycleFields = {
  /** Statut de cycle DÉRIVÉ-immo (réutilise RegulatoryStageKind ; plus une annotation lâche). */
  statut: RegulatoryStageKind.nullable().default(null),
  /** n° du FUTUR règlement annoncé par l'avis = clé de corrélation cross-stage (verbatim-ou-null, jamais inféré). */
  cibleReglementNumero: z.string().nullable().default(null),
  /** Bitemporel (validFrom/validTo VERBATIM-ou-UNKNOWN ; validTo ferme à l'arrivée du successeur lifecycle_predecessor). */
  temporal: TemporalSpan.nullable().default(null),
  /** Relations discriminées typées-immo (lifecycle_predecessor/replaces/amends/supersedes). */
  relations: z.array(OntoRelation).default([]),
  /** Famille d'instrument (déclaré-source geo ou "unknown"/null ; §9-tolérant ; routage surface via KNOWN_TYPE_INSTRUMENTS). */
  typeInstrument: typeInstrumentField,
  /** Ferme vs anticipation DÉRIVÉ-immo (firm iff statut adopté/en-vigueur ; null=legacy→fallback anticipation à la lecture). */
  regulatoryStatus: regulatoryStatusField,
} as const;

/** Bylaw (adoption/en_vigueur) : bitemporel + provenance en_vigueur + relations + instrument. */
export const bylawLifecycleFields = {
  temporal: TemporalSpan.nullable().default(null),
  enVigueurProvenance: EnVigueurProvenance.nullable().default(null),
  relations: z.array(OntoRelation).default([]),
  /** Famille d'instrument (déclaré-source geo ou "unknown"/null ; §9-tolérant ; ex. règlement habilitant type_instrument=derogation). */
  typeInstrument: typeInstrumentField,
  /** Ferme vs anticipation DÉRIVÉ-immo (firm iff statut adopté/en-vigueur ; null=legacy→fallback anticipation à la lecture). */
  regulatoryStatus: regulatoryStatusField,
} as const;

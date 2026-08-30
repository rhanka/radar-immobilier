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

// ── Champs de cycle de vie ajoutés aux nœuds (appliqués dans entities.ts) ─────
/** DesignationEvent (avis/projet) : statut + cible + bitemporel + relations. */
export const designationLifecycleFields = {
  /** Statut de cycle DÉRIVÉ-immo (réutilise RegulatoryStageKind ; plus une annotation lâche). */
  statut: RegulatoryStageKind.nullable().default(null),
  /** n° du FUTUR règlement annoncé par l'avis = clé de corrélation cross-stage (verbatim-ou-null, jamais inféré). */
  cibleReglementNumero: z.string().nullable().default(null),
  /** Bitemporel (validFrom/validTo VERBATIM-ou-UNKNOWN ; validTo ferme à l'arrivée du successeur lifecycle_predecessor). */
  temporal: TemporalSpan.nullable().default(null),
  /** Relations discriminées typées-immo (lifecycle_predecessor/replaces/amends/supersedes). */
  relations: z.array(OntoRelation).default([]),
} as const;

/** Bylaw (adoption/en_vigueur) : bitemporel + provenance en_vigueur + relations. */
export const bylawLifecycleFields = {
  temporal: TemporalSpan.nullable().default(null),
  enVigueurProvenance: EnVigueurProvenance.nullable().default(null),
  relations: z.array(OntoRelation).default([]),
} as const;

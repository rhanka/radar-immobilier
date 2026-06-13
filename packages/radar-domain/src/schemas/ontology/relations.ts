import { z } from "zod";
import { isoDateSchema } from "../common.js";
import { EvidenceItem } from "../opportunity.js";
import { ConstraintKind, ConstraintConfidence } from "./entities.js";

/**
 * V2.0 relation types (SPEC_ONTOLOGY §1.2) and the relational PROJECTIONS that are
 * NOT graphify nodes (RegulatoryStage, ConstraintHit) — they are computed, not
 * reconciled (§1.1 deferral note, §4.2, §4.3).
 *
 * DETTE TECHNIQUE : cet enum est une DEUXIÈME source de vérité hardcodée,
 * distincte du YAML radar/ontology/ontology-profile.yaml v2.0. Idéalement,
 * cette liste serait dérivée automatiquement du YAML au build (génération de code
 * ou lecture dynamique). En attendant, garder synchronisé manuellement.
 * Ref: ontology-profile.yaml relation_types (25 relations v2.0).
 *
 * Suppressions vs v1 : renames (0 arêtes), valued_by (0 arêtes, dépend de
 * Valuation supprimé).
 * Ajouts vs v1 : supports, references, concerns, applies_to, flags, has_source,
 * issued_for, defines, subject_of.
 * Consolidation : has_signal → raises_signal (synonyme v2.0).
 */

/** The 25 v2.0 relation types of the graphify profile (§1.2 / §8.1). */
export const OntoRelationType = z.enum([
  // ── Localisation ──────────────────────────────────────────────────────────
  "located_in",
  "located_at",
  // ── Gouvernance réglementaire ─────────────────────────────────────────────
  "governed_by",
  "amends",
  "defines",
  // ── Événements de désignation ─────────────────────────────────────────────
  "rezones",
  "splits",
  "merges",
  "subdivides",
  "supersedes",
  "targets_zone",
  "targets_lot",
  "raises_signal",
  "concerns",
  // ── Lots ──────────────────────────────────────────────────────────────────
  "assigned_zone",
  "issued_for",
  "subject_of",
  // ── Contraintes ───────────────────────────────────────────────────────────
  "constrains",
  "applies_to",
  // ── Sources / preuves ─────────────────────────────────────────────────────
  "mentions",
  "supports",
  "references",
  "flags",
  "derived_from",
  "has_source",
]);
export type OntoRelationTypeT = z.infer<typeof OntoRelationType>;

// ─────────────────────────────────────────────────────────────────────────────
// RegulatoryStage — relational projection of the legal lifecycle of a Bylaw
// (§4.2). In V1 this is NOT a graphify node; HAS_STAGE is a relational FK edge.
// ─────────────────────────────────────────────────────────────────────────────
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
export const RegulatoryStage = z.object({
  id: z.string().uuid(),
  /** HAS_STAGE = relational FK to the Bylaw (§4.2). */
  bylawId: z.string().uuid(),
  kind: RegulatoryStageKind,
  occurredOn: isoDateSchema,
  outcome: RegulatoryStageOutcome.default("non-disponible"),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});
export type RegulatoryStageT = z.infer<typeof RegulatoryStage>;

// ─────────────────────────────────────────────────────────────────────────────
// ConstraintHit — projection of a CONSTRAINS relation onto a Lot/Zone, read by
// the risk axis (§4.3, §7.3). Always carries {source, date, confidence,
// evidence_refs} so the risk score is traceable to the source (≥1 ref required).
// ─────────────────────────────────────────────────────────────────────────────
export const ConstraintHitTarget = z.enum(["lot", "zone"]);
export type ConstraintHitTargetT = z.infer<typeof ConstraintHitTarget>;
export const ConstraintHit = z.object({
  constraintId: z.string().uuid(),
  targetKind: ConstraintHitTarget,
  targetId: z.string().uuid(),
  kind: ConstraintKind,
  source: z.string().min(1),
  date: isoDateSchema.nullable().default(null),
  confidence: ConstraintConfidence,
  /** The risk axis (20 %) is auditable: ≥1 evidence ref (§7.3). */
  evidenceRefs: z.array(z.string().min(1)).min(1),
});
export type ConstraintHitT = z.infer<typeof ConstraintHit>;

import { z } from "zod";
import { isoDateSchema } from "../common.js";
import { EvidenceItem } from "../opportunity.js";
import { ConstraintKind, ConstraintConfidence } from "./entities.js";

/**
 * V1 relation types (SPEC_ONTOLOGY §1.2) and the relational PROJECTIONS that are
 * NOT graphify nodes (RegulatoryStage, ConstraintHit) — they are computed, not
 * reconciled (§1.1 deferral note, §4.2, §4.3).
 */

/** The 18 V1 relation types of the graphify profile (§1.2 / §8.1). */
export const OntoRelationType = z.enum([
  "located_in",
  "located_at",
  "governed_by",
  "amends",
  "rezones",
  "splits",
  "renames",
  "merges",
  "subdivides",
  "targets_zone",
  "targets_lot",
  "assigned_zone",
  "valued_by",
  "constrains",
  "derived_from",
  "mentions",
  "supersedes",
  "raises_signal",
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

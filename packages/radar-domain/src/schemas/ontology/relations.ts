import { z } from "zod";
import { isoDateSchema } from "../common.js";
import { EvidenceItem } from "../opportunity.js";
import { ConstraintKind, ConstraintConfidence } from "./entities.js";

/**
 * V2.0 relation types (SPEC_ONTOLOGY §1.2) et projections relationnelles
 * (RegulatoryStage, ConstraintHit) — calculées, non réconciliées (§4.2, §4.3).
 *
 * DETTE #54 RÉSOLUE : OntoRelationType est désormais GÉNÉRÉ depuis
 * radar/ontology/ontology-profile.yaml via `npm run gen:onto`.
 * Source unique → plus de dérive possible.
 * Ref : packages/radar-domain/scripts/gen-relation-types.ts
 */

// Ré-export depuis le fichier généré (source : relations-generated.ts, dérivée du YAML)
export { OntoRelationType, YAML_RELATION_KEYS } from "./relations-generated.js";
export type { OntoRelationTypeT } from "./relations-generated.js";

// ─────────────────────────────────────────────────────────────────────────────
// RegulatoryStage — projection relationnelle du cycle de vie légal d'un Bylaw
// (§4.2). En V1 ce n'est PAS un nœud graphify ; HAS_STAGE est un FK edge.
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
  /** HAS_STAGE = FK relational vers le Bylaw (§4.2). */
  bylawId: z.string().uuid(),
  kind: RegulatoryStageKind,
  occurredOn: isoDateSchema,
  outcome: RegulatoryStageOutcome.default("non-disponible"),
  rawRef: z.string().min(1),
  evidence: z.array(EvidenceItem).default([]),
});
export type RegulatoryStageT = z.infer<typeof RegulatoryStage>;

// ─────────────────────────────────────────────────────────────────────────────
// ConstraintHit — projection d'une relation CONSTRAINS sur un Lot/Zone, lue par
// l'axe risque (§4.3, §7.3). Toujours accompagnée de {source, date, confidence,
// evidence_refs} pour que le score soit traçable (≥1 ref obligatoire).
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
  /** L'axe risque (20 %) est auditable : ≥1 ref d'évidence obligatoire (§7.3). */
  evidenceRefs: z.array(z.string().min(1)).min(1),
});
export type ConstraintHitT = z.infer<typeof ConstraintHit>;

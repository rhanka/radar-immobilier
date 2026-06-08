import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

/**
 * graphify reconciliation lifecycle statuses (SPEC_ONTOLOGY §1.3
 * `hardening.statuses`). Only `validated` rows (that also passed the radar
 * validator, §3.5) are visible to the exploitation / scoring layer.
 */
export const OntologyStatus = z.enum([
  "candidate",
  "attached",
  "needs_review",
  "validated",
  "rejected",
  "superseded",
]);
export type OntologyStatusT = z.infer<typeof OntologyStatus>;

/**
 * Canonical bridge (SPEC_ONTOLOGY §4.1, Delta 1). Every materialised reconciled
 * entity carries the link to its graphify canonical node, the patch that
 * validated it (audit), and the knowledge-time window opened by that patch /
 * closed by a compensating patch (D5 bitemporal).
 */
export const ReconBridge = z.object({
  /** Stable graphify canonical_id, e.g. "zone::salaberry::2026::H-609-4". */
  canonicalId: z.string().min(1),
  /** Reconciliation status; default "validated" since only validated rows materialise. */
  reconStatus: OntologyStatus.default("validated"),
  /** Patch that validated this row (audit trail); null before/without a patch. */
  reconPatchId: z.string().nullable().default(null),
  /** Knowledge-time open = validating patch.created_at (D5). */
  knownFrom: isoDateTimeSchema,
  /** Knowledge-time close = compensating patch.created_at; null = still believed. */
  knownTo: isoDateTimeSchema.nullable().default(null),
});
export type ReconBridgeT = z.infer<typeof ReconBridge>;

/** Evaluate pending choices against qualified server state, before any transaction. */
import type { LotCommandBody } from "./lot-command-schemas.js";
import type { SemanticProfileOptions, UnavailableReason } from "./semantic-profile.js";

export type QualifiedProgression = "sollicite" | "lettre_envoyee" | "unresolved" | null;
export type SemanticDenial = UnavailableReason | "reason_code_required";
export function lotSemanticDenial(
  profile: SemanticProfileOptions, mutation: LotCommandBody["mutation"],
  previousProgression?: QualifiedProgression,
): SemanticDenial | null {
  if (mutation.action === "discard" && profile.lotReason === "undecided") return "pending_lot_reason";
  if (mutation.action === "discard" && profile.lotReason === "required" && !mutation.reasonCode) {
    return "reason_code_required";
  }
  if (profile.correspondence !== "undecided") return null;
  if (mutation.action === "set_pipeline" && mutation.status === "lettre_envoyee") return "pending_correspondence";
  if ((mutation.action === "set_pipeline" || mutation.action === "clear_pipeline")
    && previousProgression !== null && previousProgression !== "sollicite") return "pending_correspondence";
  return null;
}
export function batchSemanticDenial(profile: SemanticProfileOptions,
  items: readonly { mutation: LotCommandBody["mutation"]; previousProgression?: QualifiedProgression }[],
): SemanticDenial | null {
  for (const item of items) {
    const denial = lotSemanticDenial(profile, item.mutation, item.previousProgression);
    if (denial) return denial;
  }
  return null;
}

/** Existing sent evidence keeps its meaning regardless of the pending choice. */
export function correspondenceDisplayLabel(value: "lettre_envoyee" | "a_lettre"): string {
  return value === "lettre_envoyee" ? "Lettre envoyée" : "À lettre";
}

/**
 * S0 semantic-profile boundary (design v3 sections 1, 2 and 9).
 *
 * Display labels use Steve vocabulary. Technical codes stay internal:
 * generated labels and controls must not expose them. The three open
 * arbitrations are profile options; while undecided, the concerned
 * successor operations are unavailable on every transport.
 */

export const LOT_DISPLAY_LABELS = {
  favori: "Favori",
  non_retenu: "Non retenu",
  sollicite: "Sollicité",
  a_lettre: "À lettre",
  en_vente: "En vente",
} as const;

export type LotDisplayKey = keyof typeof LOT_DISPLAY_LABELS;

export const SIGNAL_DISPLAY_LABELS = {
  pertinent: "Pertinent",
  a_surveiller: "À surveiller",
  non_pertinent: "Non pertinent",
} as const;

export type SignalDisplayKey = keyof typeof SIGNAL_DISPLAY_LABELS;

export const LOT_INTERNAL_CODES = {
  favori: "selection basket membership",
  non_retenu: "active personal/common archive",
  sollicite: "pipeline sollicite value",
  a_lettre: "reserved pending correspondence value",
  en_vente: "market en_vente state",
} as const;

export const SIGNAL_INTERNAL_CODES = {
  pertinent: "selection basket pertinent",
  a_surveiller: "selection basket a_surveiller",
  non_pertinent: "archive state",
} as const;

/** Technical tokens that must never appear in generated labels. */
export const FORBIDDEN_LABEL_TOKENS = ["pipeline", "archive", "market", "selection"] as const;

export type LotReasonPolicy = "required" | "optional" | "undecided";
export type CorrespondencePolicy = "to_send" | "sent" | "undecided";
export type SignalClassificationPolicy = "unique" | "separate_action" | "undecided";

export interface SemanticProfileOptions {
  readonly lotReason: LotReasonPolicy;
  readonly correspondence: CorrespondencePolicy;
  readonly signalClassification: SignalClassificationPolicy;
  readonly semanticContractVersion: string;
}

export type UnavailableReason = "pending_lot_reason" | "pending_correspondence" | "pending_signal_classification";

export function unavailableLotOperations(profile: SemanticProfileOptions): ReadonlyMap<string, UnavailableReason> {
  const out = new Map<string, UnavailableReason>();
  if (profile.lotReason === "undecided") {
    out.set("personal_discard", "pending_lot_reason");
    out.set("common_discard", "pending_lot_reason");
    out.set("composite_discard_deselect", "pending_lot_reason");
    out.set("batch_with_discard", "pending_lot_reason");
  }
  if (profile.correspondence === "undecided") {
    out.set("correspondence_write", "pending_correspondence");
    out.set("correspondence_clear", "pending_correspondence");
    out.set("pipeline_clear_over_correspondence", "pending_correspondence");
    out.set("pipeline_replace_over_correspondence", "pending_correspondence");
  }
  return out;
}

export function unavailableSignalOperations(
  profile: SemanticProfileOptions,
): ReadonlyMap<string, UnavailableReason> {
  const out = new Map<string, UnavailableReason>();
  if (profile.signalClassification === "undecided") {
    out.set("personal_select", "pending_signal_classification");
    out.set("personal_deselect", "pending_signal_classification");
    out.set("selection_reason_edit", "pending_signal_classification");
    out.set("personal_discard", "pending_signal_classification");
    out.set("personal_restore", "pending_signal_classification");
    out.set("common_discard", "pending_signal_classification");
    out.set("common_restore", "pending_signal_classification");
  }
  return out;
}

export function isLotOperationCoveredByPendingChoice(
  profile: SemanticProfileOptions,
  operation: string,
): boolean {
  return unavailableLotOperations(profile).has(operation);
}

/** Display text never leaks technical tokens; returns false when clean. */
export function displayLeaksTechnicalToken(display: string): boolean {
  const lower = display.toLowerCase();
  return FORBIDDEN_LABEL_TOKENS.some((token) => lower.includes(token));
}

import { describe, expect, it } from "vitest";
import {
  LOT_DISPLAY_LABELS,
  SIGNAL_DISPLAY_LABELS,
  displayLeaksTechnicalToken,
  isLotOperationCoveredByPendingChoice,
  unavailableLotOperations,
  unavailableSignalOperations,
  type SemanticProfileOptions,
} from "./semantic-profile.js";

const undecided: SemanticProfileOptions = {
  lotReason: "undecided",
  correspondence: "undecided",
  signalClassification: "undecided",
  semanticContractVersion: "semantic-v0",
};

const decided: SemanticProfileOptions = {
  lotReason: "required",
  correspondence: "sent",
  signalClassification: "separate_action",
  semanticContractVersion: "semantic-v1",
};

describe("semantic profile boundary", () => {
  it("uses Steve display vocabulary for lots and signals", () => {
    expect(LOT_DISPLAY_LABELS.favori).toBe("Favori");
    expect(LOT_DISPLAY_LABELS.non_retenu).toBe("Non retenu");
    expect(LOT_DISPLAY_LABELS.sollicite).toBe("Sollicité");
    expect(LOT_DISPLAY_LABELS.a_lettre).toBe("À lettre");
    expect(LOT_DISPLAY_LABELS.en_vente).toBe("En vente");
    expect(SIGNAL_DISPLAY_LABELS.pertinent).toBe("Pertinent");
    expect(SIGNAL_DISPLAY_LABELS.a_surveiller).toBe("À surveiller");
    expect(SIGNAL_DISPLAY_LABELS.non_pertinent).toBe("Non pertinent");
  });

  it("marks new discards unavailable while the lot reason stays undecided", () => {
    const blocked = unavailableLotOperations(undecided);
    expect(blocked.get("personal_discard")).toBe("pending_lot_reason");
    expect(blocked.get("common_discard")).toBe("pending_lot_reason");
    expect(blocked.get("composite_discard_deselect")).toBe("pending_lot_reason");
    expect(blocked.get("batch_with_discard")).toBe("pending_lot_reason");
    expect(isLotOperationCoveredByPendingChoice(undecided, "personal_discard")).toBe(true);
  });

  it("keeps restoration, favori and en_vente eligible during the lot reason pause", () => {
    const blocked = unavailableLotOperations(undecided);
    expect(blocked.has("restore")).toBe(false);
    expect(blocked.has("favori_write")).toBe(false);
    expect(blocked.has("en_vente_write")).toBe(false);
    expect(unavailableLotOperations(decided).size).toBe(0);
  });

  it("marks correspondence writes unavailable while the meaning stays undecided", () => {
    const blocked = unavailableLotOperations(undecided);
    expect(blocked.get("correspondence_write")).toBe("pending_correspondence");
    expect(blocked.get("correspondence_clear")).toBe("pending_correspondence");
    expect(blocked.get("pipeline_clear_over_correspondence")).toBe("pending_correspondence");
    expect(unavailableLotOperations(decided).has("correspondence_write")).toBe(false);
  });

  it("marks every signal successor write unavailable while classification stays undecided", () => {
    const blocked = unavailableSignalOperations(undecided);
    expect(blocked.get("personal_select")).toBe("pending_signal_classification");
    expect(blocked.get("personal_discard")).toBe("pending_signal_classification");
    expect(blocked.get("personal_restore")).toBe("pending_signal_classification");
    expect(blocked.get("selection_reason_edit")).toBe("pending_signal_classification");
    expect(unavailableSignalOperations(decided).size).toBe(0);
  });

  it("rejects technical tokens in display text", () => {
    expect(displayLeaksTechnicalToken("Favori")).toBe(false);
    expect(displayLeaksTechnicalToken("Non retenu")).toBe(false);
    expect(displayLeaksTechnicalToken("pipeline status")).toBe(true);
    expect(displayLeaksTechnicalToken("archive state")).toBe(true);
    expect(displayLeaksTechnicalToken("market flag")).toBe(true);
    expect(displayLeaksTechnicalToken("selection basket")).toBe(true);
  });
});

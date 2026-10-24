import { describe, expect, it } from "vitest";
import { batchSemanticDenial, correspondenceDisplayLabel, lotSemanticDenial } from "./semantic-availability.js";
import type { SemanticProfileOptions } from "./semantic-profile.js";
import { lotDenial, signalDenial, type StatusRights } from "./rights.js";

const pending: SemanticProfileOptions = { lotReason: "undecided", correspondence: "undecided",
  signalClassification: "undecided", semanticContractVersion: "v0" };
const noRights: StatusRights = { select: false, moderateArchive: false, changePipeline: false,
  changeMarket: false, discardPersonally: false };

describe("qualified semantic availability", () => {
  it("should refuse pending discards including an atomic batch with an otherwise eligible favorite", () => {
    expect(lotSemanticDenial(pending, { action: "discard" })).toBe("pending_lot_reason");
    expect(batchSemanticDenial(pending, [{ mutation: { action: "select", basket_id: "favorites" } },
      { mutation: { action: "discard", reasonCode: "X" } }])).toBe("pending_lot_reason");
    expect(lotSemanticDenial(pending, { action: "restore" })).toBeNull();
    expect(lotSemanticDenial(pending, { action: "select", basket_id: "favorites" })).toBeNull();
    expect(lotSemanticDenial(pending, { action: "set_market", status: "en_vente",
      asking_price: null, listing_url: null })).toBeNull();
  });

  it("should require qualified evidence that Sollicité cannot remove correspondence", () => {
    for (const action of ["set_pipeline", "clear_pipeline"] as const) {
      const mutation = action === "set_pipeline" ? { action, status: "sollicite" as const } : { action };
      for (const previous of [undefined, "lettre_envoyee", "unresolved"] as const) {
        expect(lotSemanticDenial(pending, mutation, previous)).toBe("pending_correspondence");
      }
      expect(lotSemanticDenial(pending, mutation, null)).toBeNull();
      expect(lotSemanticDenial(pending, mutation, "sollicite")).toBeNull();
    }
    expect(lotSemanticDenial(pending, { action: "set_pipeline", status: "lettre_envoyee" }, null))
      .toBe("pending_correspondence");
    expect(correspondenceDisplayLabel("lettre_envoyee")).toBe("Lettre envoyée");
    expect(correspondenceDisplayLabel("a_lettre")).toBe("À lettre");
  });

  it("should keep personal archive capabilities and common moderation independent", () => {
    for (const action of ["discard", "restore"] as const) {
      expect(lotDenial("personal", action, noRights)).toBe("workspace_capability_required");
      expect(signalDenial("personal", action, noRights)).toBe("workspace_capability_required");
      expect(lotDenial("common", action, { ...noRights, moderateArchive: true })).toBeNull();
      expect(signalDenial("common", action, { ...noRights, moderateArchive: true })).toBeNull();
    }
  });

  it("should distinguish decided reason policies without removing the signal reason requirement", () => {
    expect(lotSemanticDenial({ ...pending, lotReason: "required" }, { action: "discard" }))
      .toBe("reason_code_required");
    expect(lotSemanticDenial({ ...pending, lotReason: "optional" }, { action: "discard" })).toBeNull();
    expect(lotSemanticDenial({ ...pending, lotReason: "required" }, { action: "discard", reasonCode: "X" }))
      .toBeNull();
  });
});

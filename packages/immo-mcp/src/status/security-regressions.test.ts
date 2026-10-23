import { describe, expect, it } from "vitest";
import { validateSignalCommand, type SignalCommandBody } from "./command-contracts.js";
import { validateLotBatchShape } from "./command-contracts.js";
import { unavailableLotOperations } from "./semantic-profile.js";
import { validateContextOutputClean } from "./read-contracts.js";

const workspaceId = "11111111-2222-4333-8444-555555555555";

describe("S0 integration regressions", () => {
  it("should reject unsupported signal targets and absent deselection baskets", () => {
    const body = { target: { citySlug: "longueuil", type: "Lot", id: "s1" },
      expectedHeadId: null, displayedFingerprint: "a".repeat(64) };
    expect(validateSignalCommand(body as SignalCommandBody, "restore")).toBe("target_malformed");
    expect(validateSignalCommand({ ...body, target: { ...body.target, type: "Signal" } },
      "deselect")).toBe("target_malformed");
  });

  it("should reject missing batch contexts and invented modes", () => {
    const items = [{ citySlug: "longueuil", canonicalId: "L1" },
      { citySlug: "longueuil", canonicalId: "L2" }];
    expect(validateLotBatchShape(items, [{ workspaceId, scope: "common", mode: "real" }]))
      .toBe("batch_mixed_context");
    expect(validateLotBatchShape(items.slice(0, 1),
      [{ workspaceId, scope: "common", mode: "invented" }])).toBe("batch_mixed_context");
  });

  it("should prevent replacing unresolved correspondence with Sollicité", () => {
    expect(unavailableLotOperations({ lotReason: "optional", correspondence: "undecided",
      signalClassification: "separate_action", semanticContractVersion: "v1" })
      .get("pipeline_replace_over_correspondence")).toBe("pending_correspondence");
  });

  it("should reject heads nested in context diagnostics", () => {
    expect(validateContextOutputClean({ selectedWorkspace: { heads: [] } }))
      .toBe("heads_leaked_in_context");
  });
});

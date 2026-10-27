import { describe, expect, it } from "vitest";
import {
  effectiveHidden,
  isDisplayedFingerprint,
  validateContextOutputClean,
  validateContinuationBinding,
  validateLotFacetsInput,
  validatePageContinuation,
  validateSignalFacetsInput,
} from "./read-contracts.js";

const WORKSPACE = "11111111-2222-4333-8444-555555555555";

describe("status read contracts", () => {
  it("requires explicit workspace and city on signal reads", () => {
    expect(
      validateSignalFacetsInput({ workspaceId: "", city: "longueuil" }),
    ).toBe("workspace_missing");
    expect(
      validateSignalFacetsInput({ workspaceId: "not-a-uuid", city: "longueuil" }),
    ).toBe("workspace_malformed");
    expect(validateSignalFacetsInput({ workspaceId: WORKSPACE, city: "" })).toBe("city_missing");
    expect(validateSignalFacetsInput({ workspaceId: WORKSPACE, city: "Longueuil!" })).toBe(
      "city_malformed",
    );
    expect(validateSignalFacetsInput({ workspaceId: WORKSPACE, city: "longueuil" })).toBeNull();
  });

  it("requires workspace and mode on lot reads and bounds pages to 100", () => {
    expect(
      validateLotFacetsInput({ workspaceId: WORKSPACE, mode: "real", city: " Valleyfield " }),
    ).toBe("city_malformed");
    expect(
      validateLotFacetsInput({
        workspaceId: WORKSPACE,
        mode: "simulation",
        city: "longueuil",
        limit: 101,
      }),
    ).toBe("page_overflow");
    expect(
      validateLotFacetsInput({ workspaceId: WORKSPACE, mode: "real", city: "longueuil", limit: 100 }),
    ).toBeNull();
  });

  it("refuses silent truncation and foreign continuation reuse", () => {
    expect(validatePageContinuation(101, false, null)).toBe("page_overflow");
    expect(validatePageContinuation(100, true, null)).toBe("truncation_without_continuation");
    expect(validatePageContinuation(100, true, "cursor-a")).toBeNull();
    expect(validateContinuationBinding("ctx-a", "ctx-b")).toBe("incompatible_continuation");
    expect(validateContinuationBinding("ctx-a", "ctx-a")).toBeNull();
    expect(validateContinuationBinding("ctx-a", undefined)).toBeNull();
  });

  it("keeps context answers free of heads, history and receipts", () => {
    expect(validateContextOutputClean({ workspaces: [] })).toBeNull();
    expect(validateContextOutputClean({ workspaces: [], heads: [] })).toBe(
      "heads_leaked_in_context",
    );
    expect(validateContextOutputClean({ history: [] })).toBe("heads_leaked_in_context");
    expect(validateContextOutputClean({ receipt: {} })).toBe("heads_leaked_in_context");
  });

  it("computes effective hiding as personal OR common and checks fingerprints", () => {
    expect(effectiveHidden(false, false)).toBe(false);
    expect(effectiveHidden(true, false)).toBe(true);
    expect(effectiveHidden(false, true)).toBe(true);
    expect(isDisplayedFingerprint("0".repeat(64))).toBe(true);
    expect(isDisplayedFingerprint("xyz")).toBe(false);
    expect(isDisplayedFingerprint(null)).toBe(false);
  });
});

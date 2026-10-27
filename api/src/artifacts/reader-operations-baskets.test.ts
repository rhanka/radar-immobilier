import { describe, expect, it } from "vitest";
import { isBasketOperation, validateOperationParams } from "./reader-operations.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

describe("basket reader operations", () => {
  it("should accept only the three versioned basket operations", () => {
    expect(isBasketOperation("baskets.context.v1")).toBe(true);
    expect(isBasketOperation("baskets.search.v1")).toBe(true);
    expect(isBasketOperation("baskets.state.v1")).toBe(true);
    expect(isBasketOperation("geo.read.v1")).toBe(false);
  });

  it("should require an explicit workspace without a default", () => {
    expect(validateOperationParams("baskets.context.v1", { workspaceId: WORKSPACE }).ok).toBe(true);
    expect(validateOperationParams("baskets.context.v1", {}).ok).toBe(false);
    expect(validateOperationParams("baskets.search.v1",
      { workspaceId: WORKSPACE, citySlug: "valleyfield" }).ok).toBe(true);
    expect(validateOperationParams("baskets.search.v1", { citySlug: "valleyfield" }).ok).toBe(false);
    expect(validateOperationParams("baskets.state.v1",
      { workspaceId: WORKSPACE, citySlug: "valleyfield", type: "Signal", id: "sig-1" }).ok).toBe(true);
    expect(validateOperationParams("baskets.state.v1",
      { workspaceId: "not-a-uuid", citySlug: "valleyfield", type: "Signal", id: "sig-1" }).ok).toBe(false);
  });
});

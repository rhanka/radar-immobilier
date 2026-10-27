import { describe, expect, it } from "vitest";
import { isGeneralActivation } from "./activation.js";
import { closed, general, NOW } from "./general-harness.js";

describe("general activation identity", () => {
  it("marks the resolved general config as general", () => {
    expect(isGeneralActivation(general())).toBe(true);
    expect(isGeneralActivation({ enabled: true, subjects: ["alice"], expiresAtMs: NOW + 1 })).toBe(false);
    expect(isGeneralActivation(closed)).toBe(false);
  });
});

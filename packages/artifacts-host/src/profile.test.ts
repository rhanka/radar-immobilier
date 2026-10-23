import { describe, expect, it } from "vitest";
import { assertFrozenSelection, FROZEN_CAPABILITIES, RADAR_EFFECTIVE_PROFILE } from "./profile.js";

describe("provider-neutral Radar profile preparation", () => {
  it("prevents mutation of operation selection and nested limits", () => {
    expect(Object.isFrozen(FROZEN_CAPABILITIES)).toBe(true);
    expect(() => (FROZEN_CAPABILITIES as unknown as string[]).pop()).toThrow(TypeError);
    const limit = RADAR_EFFECTIVE_PROFILE.limits.publishBytes.maxDecodedTotal;
    expect(Reflect.set(RADAR_EFFECTIVE_PROFILE.limits.publishBytes, "maxDecodedTotal", 1)).toBe(false);
    expect(RADAR_EFFECTIVE_PROFILE.limits.publishBytes.maxDecodedTotal).toBe(limit);
    expect(Reflect.set(RADAR_EFFECTIVE_PROFILE.defaults.profile, "injected", true)).toBe(false);
  });

  it("requires exactly the approved four operations regardless of ordering", () => {
    const selected = ["artifacts_ensure", "artifacts_get", "artifacts_list", "artifacts_publish"];
    expect(() => assertFrozenSelection(selected)).not.toThrow();
    expect(() => assertFrozenSelection([...selected].reverse())).not.toThrow();
    expect(() => assertFrozenSelection(selected.slice(1))).toThrow("[contract-violation]");
    expect(() => assertFrozenSelection([...selected, "artifacts_extra"])).toThrow("[contract-violation]");
    expect(() => assertFrozenSelection([...selected.slice(1), selected[1]])).toThrow("[contract-violation]");
  });

  it("rejects nested arrays and objects that stringify to valid names", () => {
    expect(() => assertFrozenSelection(FROZEN_CAPABILITIES.map((name) => [name])))
      .toThrow("[contract-violation]");
    expect(() => assertFrozenSelection(FROZEN_CAPABILITIES.map((name) => ({ toString: () => name }))))
      .toThrow("[contract-violation]");
  });
});

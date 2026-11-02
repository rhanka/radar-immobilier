import { describe, expect, it } from "vitest";
import { FROZEN_CAPABILITIES } from "@radar/artifacts-host";
import { requireSelectedProfile } from "./artifacts-provider-contract.helpers.js";

// Structural guard tests only; no compiler or provider qualification is implied.
describe("provider selection structural guard", () => {
  const digest = "a".repeat(64);

  it("accepts a frozen primitive selection with its expected digest", () => {
    expect(requireSelectedProfile({ selectedCapabilities: Object.freeze([...FROZEN_CAPABILITIES]),
      profileDigest: digest }, digest, FROZEN_CAPABILITIES)).toBe(digest);
  });

  it.each([
    { kind: "arrays", names: FROZEN_CAPABILITIES.map((name) => [name]) },
    { kind: "objects", names: FROZEN_CAPABILITIES.map((name) => ({ toString: () => name })) },
  ])("rejects non-string selection values: $kind", ({ names }) => {
    expect(() => requireSelectedProfile({ selectedCapabilities: Object.freeze(names),
      profileDigest: digest }, digest, FROZEN_CAPABILITIES)).toThrow("[contract-violation]");
  });

  it.each([
    { kind: "missing", names: FROZEN_CAPABILITIES.slice(1) },
    { kind: "extra", names: [...FROZEN_CAPABILITIES, "artifacts_restore"] },
    { kind: "duplicate", names: [...FROZEN_CAPABILITIES, FROZEN_CAPABILITIES[0]] },
  ])("rejects an incorrect active selection: $kind", ({ names }) => {
    expect(() => requireSelectedProfile({ selectedCapabilities: Object.freeze(names),
      profileDigest: digest }, digest, FROZEN_CAPABILITIES)).toThrow("[contract-violation]");
  });
});

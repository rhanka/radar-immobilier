import { describe, expect, it } from "vitest";
import {
  isReaderOperation,
  operationMethod,
  syntheticGeoItems,
  syntheticSignals,
  validateOperationParams,
} from "./reader-operations.js";

describe("named reader operations", () => {
  it("should accept only the three versioned operations over GET", () => {
    expect(isReaderOperation("geo.read.v1")).toBe(true);
    expect(isReaderOperation("signals.protected-read.v1")).toBe(true);
    expect(isReaderOperation("status.closed.v1")).toBe(true);
    expect(isReaderOperation("geo.write.v1")).toBe(false);
    expect(isReaderOperation("https://api.example.test/x")).toBe(false);
    expect(operationMethod("geo.read.v1")).toBe("GET");
  });

  it("should validate parameters and bound collection ids", () => {
    expect(validateOperationParams("geo.read.v1", { collectionId: "qc-zonage-valleyfield", limit: 5 }).ok).toBe(true);
    expect(validateOperationParams("geo.read.v1", { collectionId: "https://evil.example/x" }).ok).toBe(false);
    expect(validateOperationParams("geo.read.v1", { collectionId: "qc-zonage-valleyfield", limit: 500 }).ok).toBe(false);
    expect(validateOperationParams("signals.protected-read.v1", { city: "" }).ok).toBe(false);
  });

  it("should distinguish two readers on the protected read", () => {
    const alice = syntheticSignals("valleyfield", "reader-alice");
    const bob = syntheticSignals("valleyfield", "reader-bob");
    expect(alice).toHaveLength(2);
    expect(bob).toHaveLength(1);
    expect(bob[0]?.detail).toBeNull();
    expect(alice[0]?.detail).not.toBeNull();
    expect(syntheticSignals("unknown-city", "reader-alice")).toHaveLength(0);
    expect(syntheticGeoItems("qc-zonage-valleyfield", 10)).toHaveLength(2);
  });
});

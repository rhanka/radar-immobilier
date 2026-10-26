import { describe, expect, it } from "vitest";
import { validateReaderResponse } from "./reader-responses.js";

describe("reader API response validation", () => {
  it("should refuse publisher identity substituted for the reader", () => {
    expect(() => validateReaderResponse("signals.protected-read.v1",
      { reader: "publisher", city: "valleyfield", signals: [] }, "reader-alice")).toThrow();
  });
  it("should reject malformed responses and authority-bearing fields", () => {
    for (const body of [{}, { type: "FeatureCollection", features: [], credential: "secret" }]) {
      expect(() => validateReaderResponse("geo.read.v1", body, "reader-alice")).toThrow();
    }
  });
  it("should preserve a valid reader response", () => {
    const body = { reader: "reader-alice", city: "valleyfield", signals: [] };
    expect(validateReaderResponse("signals.protected-read.v1", body, "reader-alice")).toEqual(body);
  });
});

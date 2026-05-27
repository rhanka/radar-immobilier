import { describe, it, expect } from "vitest";
import { GRID_VERSION } from "./index.js";
describe("@radar/scoring", () => {
  it("exposes a grid version", () => { expect(GRID_VERSION).toBe("v1"); });
});

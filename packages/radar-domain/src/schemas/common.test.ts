import { describe, it, expect } from "vitest";
import { Mode } from "./common.js";
describe("Mode", () => {
  it("accepts real and simulation, rejects others", () => {
    expect(Mode.safeParse("real").success).toBe(true);
    expect(Mode.safeParse("simulation").success).toBe(true);
    expect(Mode.safeParse("prod").success).toBe(false);
  });
});

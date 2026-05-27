import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { appMode, toggleMode } from "./mode.js";

describe("appMode store", () => {
  it("defaults to 'real'", () => {
    expect(get(appMode)).toBe("real");
  });

  it("toggleMode flips real → simulation", () => {
    // Reset to known state
    appMode.set("real");
    toggleMode();
    expect(get(appMode)).toBe("simulation");
  });

  it("toggleMode flips simulation → real", () => {
    appMode.set("simulation");
    toggleMode();
    expect(get(appMode)).toBe("real");
  });
});

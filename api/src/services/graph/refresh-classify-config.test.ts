import { describe, expect, it } from "vitest";
import { refreshClassifyConfig, refreshClassifyMode } from "./refresh-classify-config.js";

describe("refresh classification configuration", () => {
  it("should default to off and accept the deprecated binary switch only without a mode", () => {
    expect(refreshClassifyMode({})).toBe("off");
    expect(refreshClassifyMode({ REFRESH_SINGLE_PASS: "0" })).toBe("off");
    expect(refreshClassifyMode({ REFRESH_SINGLE_PASS: "1" })).toBe("single-pass");
    for (const mode of ["off", "two-step", "single-pass"] as const) {
      expect(refreshClassifyMode({ REFRESH_CLASSIFY_MODE: mode, REFRESH_SINGLE_PASS: "1" })).toBe(mode);
    }
    expect(() => refreshClassifyMode({ REFRESH_CLASSIFY_MODE: "invalid" })).toThrow("REFRESH_CLASSIFY_MODE");
    expect(() => refreshClassifyMode({ REFRESH_SINGLE_PASS: "invalid" })).toThrow("REFRESH_SINGLE_PASS");
  });

  it("should select independent Astra low and Gemini low models with bounded concurrency and retry caps", () => {
    expect(refreshClassifyConfig({ REFRESH_MODEL: "other", REFRESH_REASONING_EFFORT: "medium" }))
      .toEqual({ primary: { provider: "openai", model: "gpt-6-astra", effort: "low" },
        fallback: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
        concurrency: 2, retryLimit: 20, retryWindowDays: 31 });
    expect(refreshClassifyConfig({ REFRESH_CLASSIFY_MODEL: "custom", REFRESH_CLASSIFY_REASONING_EFFORT: "high",
      REFRESH_CLASSIFY_FALLBACK_MODEL: "fallback", REFRESH_CLASSIFY_CONCURRENCY: "3",
      REFRESH_CLASSIFY_RETRY_LIMIT: "0", REFRESH_CLASSIFY_RETRY_WINDOW_DAYS: "14" }))
      .toMatchObject({ primary: { model: "custom", effort: "high" }, fallback: { model: "fallback" },
        concurrency: 3, retryLimit: 0, retryWindowDays: 14 });
    expect(refreshClassifyConfig({ REFRESH_CLASSIFY_RETRY_LIMIT: "", REFRESH_CLASSIFY_RETRY_WINDOW_DAYS: "  " }))
      .toMatchObject({ retryLimit: 20, retryWindowDays: 31 });
    for (const concurrency of ["0", "17", "1.5", "no"]) {
      expect(() => refreshClassifyConfig({ REFRESH_CLASSIFY_CONCURRENCY: concurrency })).toThrow("CONCURRENCY");
    }
    for (const limit of ["-1", "501", "1.5", "no"]) {
      expect(() => refreshClassifyConfig({ REFRESH_CLASSIFY_RETRY_LIMIT: limit })).toThrow("RETRY_LIMIT");
    }
    for (const days of ["0", "366", "1.5", "no"]) {
      expect(() => refreshClassifyConfig({ REFRESH_CLASSIFY_RETRY_WINDOW_DAYS: days })).toThrow("RETRY_WINDOW_DAYS");
    }
    expect(() => refreshClassifyConfig({ REFRESH_CLASSIFY_PROVIDER: "other" })).toThrow("configuration");
  });

  it("should accept a Muse seat as the classification fallback", () => {
    expect(refreshClassifyConfig({ REFRESH_CLASSIFY_FALLBACK_PROVIDER: "muse",
      REFRESH_CLASSIFY_FALLBACK_MODEL: "muse-wonder-1.0" }))
      .toMatchObject({ fallback: { provider: "muse", model: "muse-wonder-1.0", effort: "low" } });
  });
});

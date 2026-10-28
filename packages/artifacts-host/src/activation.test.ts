import { describe, expect, it } from "vitest";
import {
  readActivationEnv,
  resolveActivationConfig,
  type ActivationConfigInput,
} from "./activation.js";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const FUTURE = "2026-10-22T00:00:00Z";
const PAST = "2026-10-20T00:00:00Z";

const FULL: ActivationConfigInput = {
  controlMode: "validation",
  validationSubjects: "alice,bob",
  validationUntil: FUTURE,
};

describe("resolveActivationConfig closed by default", () => {
  it("stays closed when every variable is absent or empty", () => {
    expect(resolveActivationConfig({}, NOW)).toEqual({
      enabled: false,
      reason: "activation_absent",
    });
    expect(
      resolveActivationConfig({ controlMode: "  ", validationSubjects: "", validationUntil: "   " }, NOW),
    ).toEqual({ enabled: false, reason: "activation_absent" });
  });

  it("stays closed when the mode is off, even with a complete cohort and window", () => {
    expect(resolveActivationConfig({ controlMode: "off" }, NOW)).toEqual({
      enabled: false,
      reason: "activation_off",
    });
    expect(resolveActivationConfig({ ...FULL, controlMode: "  off " }, NOW)).toEqual({
      enabled: false,
      reason: "activation_off",
    });
  });

  it("closes on a partial config and names only the missing variables", () => {
    expect(resolveActivationConfig({ controlMode: "validation" }, NOW)).toEqual({
      enabled: false,
      reason: "activation_incomplete",
      missing: ["ARTIFACTS_VALIDATION_SUBJECTS", "ARTIFACTS_VALIDATION_UNTIL"],
    });
    const result = resolveActivationConfig(
      { controlMode: "validation", validationSubjects: "alice" }, NOW,
    );
    expect(result).toEqual({
      enabled: false,
      reason: "activation_incomplete",
      missing: ["ARTIFACTS_VALIDATION_UNTIL"],
    });
    expect(JSON.stringify(result)).not.toContain("alice");
  });

  it("closes an expired window, including the exact expiration instant", () => {
    expect(resolveActivationConfig({ ...FULL, validationUntil: PAST }, NOW)).toEqual({
      enabled: false,
      reason: "activation_expired",
    });
    expect(
      resolveActivationConfig(
        { ...FULL, validationUntil: "2026-10-21T00:00:00Z" }, NOW,
      ),
    ).toEqual({ enabled: false, reason: "activation_expired" });
  });
});

describe("resolveActivationConfig validation mode", () => {
  it("enables a complete cohort inside its window and dedupes subjects", () => {
    expect(
      resolveActivationConfig({ ...FULL, validationSubjects: " alice ,bob,alice " }, NOW),
    ).toEqual({ enabled: true, subjects: ["alice", "bob"], expiresAtMs: Date.parse(FUTURE),
      mode: "validation" });
  });

  it("accepts an absolute timestamp with milliseconds and an explicit offset", () => {
    expect(resolveActivationConfig({ ...FULL,
      validationUntil: "2026-10-21T19:00:00.123-05:00",
    }, NOW)).toEqual({ enabled: true, subjects: ["alice", "bob"],
      expiresAtMs: Date.parse("2026-10-22T00:00:00.123Z"), mode: "validation" });
  });

  it("stops on a malformed mode, even when the rest is missing", () => {
    for (const controlMode of ["bogus", "Validation", "ON", "o ff"]) {
      expect(() => resolveActivationConfig({ controlMode }, NOW), controlMode).toThrow(
        "invalid ARTIFACTS_CONTROL_MODE",
      );
    }
    expect(() => resolveActivationConfig({ controlMode: "bogus" }, NOW)).toThrow(
      "invalid ARTIFACTS_CONTROL_MODE",
    );
  });

  it("stops on malformed subjects, even when the rest is missing", () => {
    for (const validationSubjects of ["alice,,bob", "alice, ,bob", ",alice", "alice,", "has space"]) {
      expect(() => resolveActivationConfig({ ...FULL, validationSubjects }, NOW), validationSubjects).toThrow(
        "invalid ARTIFACTS_VALIDATION_SUBJECTS",
      );
      expect(() => resolveActivationConfig({ validationSubjects }, NOW), validationSubjects).toThrow(
        "invalid ARTIFACTS_VALIDATION_SUBJECTS",
      );
    }
  });

  it("stops on a malformed expiration, even when the rest is missing", () => {
    for (const validationUntil of [
      "not-a-date", "2026-13-01", "2099-01-01", "2099-01-01T00:00:00",
      "January 1, 2099", "2099-02-29T00:00:00Z", "2099-04-31T00:00:00Z",
    ]) {
      expect(() => resolveActivationConfig({ ...FULL, validationUntil }, NOW), validationUntil).toThrow(
        "invalid ARTIFACTS_VALIDATION_UNTIL",
      );
      expect(() => resolveActivationConfig({ validationUntil }, NOW), validationUntil).toThrow(
        "invalid ARTIFACTS_VALIDATION_UNTIL",
      );
    }
  });
});

describe("readActivationEnv", () => {
  it("maps the three ARTIFACTS_* activation variables and ignores the rest", () => {
    expect(
      readActivationEnv({
        ARTIFACTS_CONTROL_MODE: "validation",
        ARTIFACTS_VALIDATION_SUBJECTS: "alice",
        ARTIFACTS_VALIDATION_UNTIL: FUTURE,
        UNRELATED: "x",
      }),
    ).toEqual({
      controlMode: "validation",
      validationSubjects: "alice",
      validationUntil: FUTURE,
    });
  });
});

describe("resolveActivationConfig general mode", () => {
  it("opens with the mode alone: no cohort, no expiry", () => {
    expect(resolveActivationConfig({ controlMode: "general" }, NOW)).toEqual({
      enabled: true, subjects: [], expiresAtMs: Number.POSITIVE_INFINITY, mode: "general",
    });
  });

  it("accepts a padded mode and keeps supplied cohort details without requiring them", () => {
    expect(resolveActivationConfig({ controlMode: "  general ", validationSubjects: "alice",
      validationUntil: FUTURE }, NOW)).toEqual({ enabled: true, subjects: ["alice"],
      expiresAtMs: Date.parse(FUTURE), mode: "general" });
  });

  it("stops on malformed cohort details even in general mode", () => {
    expect(() => resolveActivationConfig({ controlMode: "general", validationSubjects: "a,,b" }, NOW))
      .toThrow("invalid ARTIFACTS_VALIDATION_SUBJECTS");
    expect(() => resolveActivationConfig({ controlMode: "general", validationUntil: "not-a-date" }, NOW))
      .toThrow("invalid ARTIFACTS_VALIDATION_UNTIL");
  });
});

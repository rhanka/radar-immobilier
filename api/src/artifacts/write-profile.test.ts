// PW-A PWA-01: closed write profile, no wildcards, read intact.
import { describe, expect, it } from "vitest";
import {
  SIGNAL_WRITE_OPERATIONS,
  WRITE_GRANT_AUDIENCE,
  WRITE_GRANT_TTL_SECONDS,
  WRITE_PROFILE_NAME,
  assertWriteOperationsClosed,
  isWriteOperation,
  writeCapabilityForOperation,
} from "./write-profile.js";

describe("write profile", () => {
  it("should name the write-v2 profile with six closed operations", () => {
    expect(WRITE_PROFILE_NAME).toBe("h5-signal-write-v2");
    expect(WRITE_GRANT_AUDIENCE).toBe("radar-artifact-write");
    expect(WRITE_GRANT_TTL_SECONDS).toBe(120);
    expect(SIGNAL_WRITE_OPERATIONS).toHaveLength(6);
    expect(writeCapabilityForOperation("facets.signals.personal.select.v1"))
      .toBe("facets.signals.personal.select");
  });

  it("should refuse wildcards, unknown operations, and duplicates", () => {
    expect(() => assertWriteOperationsClosed([...SIGNAL_WRITE_OPERATIONS])).not.toThrow();
    expect(() => assertWriteOperationsClosed(["*"])).toThrow();
    expect(() => assertWriteOperationsClosed(["facets.signals.personal.select.v1", "facets.signals.personal.select.v1"]))
      .toThrow();
    expect(() => assertWriteOperationsClosed([])).toThrow();
    expect(isWriteOperation("facets.signals.personal.select.v1")).toBe(true);
    expect(isWriteOperation("facets.signals.read.v1")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseA1, columnIndexToLetters } from "./cell-ref.js";
import { SteveCaptureError } from "./types.js";

describe("workbook coordinates", () => {
  it("round-trips the final Excel column", () => {
    expect(parseA1("XFD1048576")).toEqual({ row: 1048576, col: 16384 });
    expect(columnIndexToLetters(16384)).toBe("XFD");
  });
  it.each(["A0", "A1048577", "XFE1", "A9007199254740992"])("rejects %s", (ref) => {
    expect(() => parseA1(ref)).toThrow(SteveCaptureError);
  });
});

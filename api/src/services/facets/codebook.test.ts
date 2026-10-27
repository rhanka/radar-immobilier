import { describe, expect, it } from "vitest";
import { compareCodebook } from "./codebook.js";

const codes = [
  { code: "TEST-A", verdict: "pertinent" },
  { code: "TEST-B", verdict: "non_pertinent" },
];
describe("compareCodebook", () => {
  it("should compare complete classified sets regardless of order", () => {
    expect(compareCodebook(codes, [...codes].reverse()).equal).toBe(true);
    expect(compareCodebook([], []).equal).toBe(true);
  });
  it("should reject missing, substituted, misspelled and reclassified codes", () => {
    expect(compareCodebook(codes, codes.slice(0, 1)).equal).toBe(false);
    expect(compareCodebook(codes, [codes[0]!, { code: "TEST-C", verdict: "non_pertinent" }]).equal).toBe(false);
    expect(compareCodebook(codes, [codes[0]!, { code: "test-b", verdict: "non_pertinent" }]).equal).toBe(false);
    expect(compareCodebook(codes, codes.map((row) => ({ ...row, verdict: "pertinent" }))).equal).toBe(false);
  });
  it("should reject duplicates on either side", () => {
    expect(compareCodebook([...codes, codes[0]!], codes).duplicates).toEqual([1, 0]);
    expect(compareCodebook(codes, [...codes, codes[0]!]).equal).toBe(false);
  });
});

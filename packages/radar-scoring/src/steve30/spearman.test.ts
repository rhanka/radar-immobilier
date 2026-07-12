import { describe, it, expect } from "vitest";
import {
  averageRanks,
  pearson,
  spearman,
  grossInversions,
} from "./spearman.js";

describe("averageRanks", () => {
  it("assigns 1-based ranks to distinct values", () => {
    expect(averageRanks([10, 30, 20])).toEqual([1, 3, 2]);
  });
  it("averages ranks within a tie group", () => {
    expect(averageRanks([10, 10, 30])).toEqual([1.5, 1.5, 3]);
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe("pearson", () => {
  it("is 1 for a perfect positive linear relation", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });
  it("throws on zero variance", () => {
    expect(() => pearson([1, 1, 1], [1, 2, 3])).toThrow();
  });
  it("throws on length mismatch", () => {
    expect(() => pearson([1, 2], [1])).toThrow();
  });
});

describe("spearman (tie-aware)", () => {
  it("is 1 for a strictly monotonic increasing pair", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
  });
  it("is -1 for a strictly monotonic decreasing pair", () => {
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });
  it("matches the textbook no-tie value 0.6", () => {
    // ρ = 1 - 6Σd²/(n(n²-1)) = 1 - 6·8/(5·24) = 0.6
    expect(spearman([1, 2, 3, 4, 5], [2, 3, 1, 5, 4])).toBeCloseTo(0.6, 10);
  });
  it("handles ties via the Pearson-on-average-ranks identity", () => {
    // ranks x = [1.5,1.5,3,4], ranks y = [1,2,3,4] → ρ = 0.94868…
    expect(spearman([1, 1, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.94868, 4);
  });
});

describe("grossInversions", () => {
  it("flags a high-band item scored at/below a low-band item", () => {
    const inv = grossInversions([
      { id: "good", reference: 10, candidate: 2 },
      { id: "bad", reference: 1, candidate: 5 },
    ]);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.highId).toBe("good");
    expect(inv[0]!.lowId).toBe("bad");
  });
  it("returns none when the score separates the bands correctly", () => {
    const inv = grossInversions([
      { id: "good", reference: 10, candidate: 8 },
      { id: "bad", reference: 1, candidate: 2 },
    ]);
    expect(inv).toHaveLength(0);
  });
  it("ignores mid-band pairs (reference 4 to 7)", () => {
    const inv = grossInversions([
      { id: "a", reference: 7, candidate: 1 },
      { id: "b", reference: 4, candidate: 9 },
    ]);
    expect(inv).toHaveLength(0);
  });
});

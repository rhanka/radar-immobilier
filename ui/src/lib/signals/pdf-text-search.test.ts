import { describe, expect, it } from "vitest";
import {
  buildTextIndex,
  findMatches,
  nextMatchIndex,
  prevMatchIndex,
} from "./pdf-text-search.js";

describe("recherche plein-texte PDF", () => {
  it("normalise et ordonne les occurrences par page puis position", () => {
    const index = buildTextIndex(
      new Map([
        [3, "Terme final"],
        [1, "Terme initial puis terme répété"],
        [2, "Aucune occurrence"],
      ]),
    );

    expect(findMatches(index, "terme")).toEqual([
      { page: 1, index: 0 },
      { page: 1, index: 19 },
      { page: 3, index: 0 },
    ]);
  });

  it("ignore la casse et les accents", () => {
    const index = buildTextIndex(new Map([[2, "DÉROGATION accordée"]]));
    expect(findMatches(index, "derogation")).toEqual([{ page: 2, index: 0 }]);
  });

  it("retourne une liste vide sans résultat ou avec une requête vide", () => {
    const index = buildTextIndex(new Map([[1, "Texte municipal"]]));
    expect(findMatches(index, "zonage")).toEqual([]);
    expect(findMatches(index, "   ")).toEqual([]);
  });

  it("navigue cycliquement dans les deux sens", () => {
    expect(nextMatchIndex(0, 3)).toBe(1);
    expect(nextMatchIndex(2, 3)).toBe(0);
    expect(prevMatchIndex(0, 3)).toBe(2);
    expect(prevMatchIndex(2, 3)).toBe(1);
    expect(nextMatchIndex(0, 0)).toBe(-1);
    expect(prevMatchIndex(0, 0)).toBe(-1);
  });
});

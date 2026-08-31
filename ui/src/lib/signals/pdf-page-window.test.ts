import { describe, expect, it } from "vitest";
import { mostVisiblePage, pagesInWindow } from "./pdf-page-window.js";

describe("pagesInWindow", () => {
  it("bounds the rendering window at the document edges", () => {
    expect(pagesInWindow(1, 5, 1)).toEqual([1, 2]);
    expect(pagesInWindow(3, 5, 1)).toEqual([2, 3, 4]);
    expect(pagesInWindow(5, 5, 2)).toEqual([3, 4, 5]);
  });

  it("clamps invalid centers and empty documents", () => {
    expect(pagesInWindow(0, 3, 1)).toEqual([1, 2]);
    expect(pagesInWindow(8, 3, 0)).toEqual([3]);
    expect(pagesInWindow(1, 0, 2)).toEqual([]);
  });
});

describe("mostVisiblePage", () => {
  it("selects the page with the greatest visible height", () => {
    expect(
      mostVisiblePage([
        { page: 1, visiblePixels: 80, distanceFromViewportTop: 0 },
        { page: 2, visiblePixels: 520, distanceFromViewportTop: 90 },
        { page: 3, visiblePixels: 0, distanceFromViewportTop: 700 },
      ]),
    ).toBe(2);
  });

  it("breaks visibility ties using proximity to the viewport top", () => {
    expect(
      mostVisiblePage([
        { page: 2, visiblePixels: 300, distanceFromViewportTop: 240 },
        { page: 3, visiblePixels: 300, distanceFromViewportTop: 20 },
      ]),
    ).toBe(3);
    expect(mostVisiblePage([])).toBeNull();
  });
});

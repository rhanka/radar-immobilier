export type PageVisibility = {
  page: number;
  visiblePixels: number;
  distanceFromViewportTop: number;
};

/** Returns the bounded page numbers kept mounted around the visible page. */
export function pagesInWindow(
  current: number,
  total: number,
  radius: number,
): number[] {
  if (total < 1) return [];
  const center = Math.min(Math.max(Math.trunc(current), 1), total);
  const safeRadius = Math.max(0, Math.trunc(radius));
  const first = Math.max(1, center - safeRadius);
  const last = Math.min(total, center + safeRadius);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** Selects the page with the largest viewport intersection, then the nearest top. */
export function mostVisiblePage(pages: readonly PageVisibility[]): number | null {
  if (pages.length === 0) return null;
  return [...pages].sort(
    (a, b) =>
      b.visiblePixels - a.visiblePixels ||
      a.distanceFromViewportTop - b.distanceFromViewportTop ||
      a.page - b.page,
  )[0]!.page;
}

import { normalizeForMatch } from "./pdf-citation-match.js";

export type PdfTextIndex = ReadonlyMap<number, string>;

export type PdfTextMatch = {
  page: number;
  index: number;
};

/** Normalise le texte déjà extrait de chaque page, sans dépendance à pdf.js. */
export function buildTextIndex(pages: ReadonlyMap<number, string>): PdfTextIndex {
  return new Map(
    [...pages.entries()]
      .sort(([pageA], [pageB]) => pageA - pageB)
      .map(([page, text]) => [page, normalizeForMatch(text)]),
  );
}

/** Retourne toutes les occurrences, ordonnées par page puis position. */
export function findMatches(index: PdfTextIndex, query: string): PdfTextMatch[] {
  const needle = normalizeForMatch(query);
  if (!needle) return [];

  const matches: PdfTextMatch[] = [];
  for (const [page, text] of [...index.entries()].sort(([a], [b]) => a - b)) {
    let from = 0;
    while (from <= text.length - needle.length) {
      const position = text.indexOf(needle, from);
      if (position < 0) break;
      matches.push({ page, index: position });
      from = position + Math.max(needle.length, 1);
    }
  }
  return matches;
}

export function nextMatchIndex(current: number, count: number): number {
  return count > 0 ? (current + 1 + count) % count : -1;
}

export function prevMatchIndex(current: number, count: number): number {
  return count > 0 ? (current - 1 + count) % count : -1;
}

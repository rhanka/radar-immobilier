/** The selected document clock, independent of event dates and signal creation. */
export type DocumentDateBasis = "document" | "scrap";

export interface DocumentDateWindow {
  dateBasis?: DocumentDateBasis;
  dateFrom?: string;
  dateTo?: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Reads persisted refs only; display DTO/S3 enrichment is not membership data. */
export function persistedDocumentRefs(props: unknown): Record<string, unknown>[] {
  const root = record(props);
  const nested = record(root.properties);
  return [root.refs, nested.refs].flatMap((refs) =>
    Array.isArray(refs) ? refs.filter((ref) => Object.keys(record(ref)).length > 0).map(record) : []);
}

function civilDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value : null;
}

const scrapeCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
});

export function documentRefCivilDate(ref: unknown, basis: DocumentDateBasis): string | null {
  const metadata = record(ref);
  if (basis === "scrap") {
    const value = metadata.fetchedAt;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !civilDate(value.slice(0, 10))) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : scrapeCalendar.format(timestamp);
  }
  if (metadata.documentDate !== undefined) {
    const date = record(metadata.documentDate);
    if (date.status !== "known" || date.precision !== "day") return null;
    const value = civilDate(date.value);
    // Contradictory projections are not silently resolved by choosing one.
    return value && (metadata.publishedAt === undefined || metadata.publishedAt === value) ? value : null;
  }
  return civilDate(metadata.publishedAt);
}

/** Inclusive civil days. Any matching bound reference includes a result once. */
export function matchesDocumentDateWindow(props: unknown, window: DocumentDateWindow = {}): boolean {
  if (!window.dateFrom && !window.dateTo) return true;
  const lower = window.dateFrom === undefined ? null : civilDate(window.dateFrom);
  const upper = window.dateTo === undefined ? null : civilDate(window.dateTo);
  if ((window.dateFrom !== undefined && !lower) || (window.dateTo !== undefined && !upper)
    || (lower && upper && lower > upper)) return false;
  return persistedDocumentRefs(props).some((ref) => {
    const date = documentRefCivilDate(ref, window.dateBasis ?? "document");
    return date !== null && (!lower || date >= lower) && (!upper || date <= upper);
  });
}

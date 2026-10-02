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

/**
 * Signal stage keys: the business date read in the document itself (meeting, stage).
 * Nested `properties` win over root props; the first non-empty value is authoritative.
 */
export const SIGNAL_DATE_KEYS = [
  "etapeDate",
  "etape_date",
  "meetingDate",
  "meeting_date",
  "documentDate",
  "date",
] as const;

/** Civil day of the signal stage date, or null when absent/unreadable. Never node creation. */
export function signalStageCivilDate(props: unknown): string | null {
  const root = record(props);
  for (const values of [record(root.properties), root]) {
    for (const key of SIGNAL_DATE_KEYS) {
      const value = values[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      const trimmed = value.trim();
      // A date-time stage keeps the civil day as written; partial dates are not days.
      return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(trimmed) ? civilDate(trimmed.slice(0, 10)) : null;
    }
  }
  return null;
}

/**
 * Civil days a result can be placed on for one clock.
 * - `scrap`: only the collection day of each reference (`fetchedAt`).
 * - `document`: each reference's documentary date; a reference without one (or a result
 *   without references) falls back to the signal stage date. Never `createdAt`.
 */
export function resultCivilDates(props: unknown, basis: DocumentDateBasis = "document"): string[] {
  const refs = persistedDocumentRefs(props);
  if (basis === "scrap") {
    return refs.map((ref) => documentRefCivilDate(ref, "scrap")).filter((date): date is string => date !== null);
  }
  const dates = refs.map((ref) => documentRefCivilDate(ref, "document"));
  const stage = dates.length === 0 || dates.includes(null) ? signalStageCivilDate(props) : null;
  return [...new Set([...dates.filter((date): date is string => date !== null), ...(stage ? [stage] : [])])];
}

/** Inclusive civil days. Any matching date (reference or stage fallback) includes a result once. */
export function matchesDocumentDateWindow(props: unknown, window: DocumentDateWindow = {}): boolean {
  if (!window.dateFrom && !window.dateTo) return true;
  const lower = window.dateFrom === undefined ? null : civilDate(window.dateFrom);
  const upper = window.dateTo === undefined ? null : civilDate(window.dateTo);
  if ((window.dateFrom !== undefined && !lower) || (window.dateTo !== undefined && !upper)
    || (lower && upper && lower > upper)) return false;
  return resultCivilDates(props, window.dateBasis ?? "document")
    .some((date) => (!lower || date >= lower) && (!upper || date <= upper));
}

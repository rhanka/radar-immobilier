import type { GraphSignalNode } from "./graph-signal-detail-client.js";

/** Compatible with the design-system DatePicker range value. */
export interface SignalDateRange {
  start: Date | null;
  end: Date | null;
}

/** The canonical DatePicker starts open, so the initial view stays unfiltered. */
export function defaultDateRange(): SignalDateRange {
  return { start: null, end: null };
}

export function sameRange(a: SignalDateRange, b: SignalDateRange): boolean {
  const timestamp = (date: Date | null): number | null => date?.getTime() ?? null;
  return timestamp(a.start) === timestamp(b.start) && timestamp(a.end) === timestamp(b.end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateValue(node: GraphSignalNode): string | null {
  const props = isRecord(node.props) ? node.props : {};
  const nested = isRecord(props.properties) ? props.properties : {};
  const keys = [
    "etapeDate",
    "etape_date",
    "meetingDate",
    "meeting_date",
    "documentDate",
    "date",
  ];

  for (const record of [nested, props]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }

  return node.publishedAt ?? node.createdAt ?? null;
}

function parseSignalDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
      ? parsed
      : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Unknown or invalid dates remain visible: the filter never invents recency. */
export function signalEtapeDate(node: GraphSignalNode): Date | null {
  const value = dateValue(node);
  if (!value) return null;
  return parseSignalDate(value);
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

function endOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();
}

export function isWithinRange(date: Date | null, range: SignalDateRange): boolean {
  if (!date) return true;
  const timestamp = date.getTime();
  const lower = range.start ? startOfDay(range.start) : Number.NEGATIVE_INFINITY;
  const upper = range.end ? endOfDay(range.end) : Number.POSITIVE_INFINITY;
  return timestamp >= lower && timestamp <= upper;
}

/** Applies the date lens after the server-authoritative A/B projection. */
export function filterNodesByEtapeDate(
  nodes: readonly GraphSignalNode[],
  range: SignalDateRange,
): GraphSignalNode[] {
  return nodes.filter((node) => isWithinRange(signalEtapeDate(node), range));
}

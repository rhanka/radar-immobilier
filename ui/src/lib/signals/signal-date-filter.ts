import type { GraphSignalNode } from "./graph-signal-detail-client.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SignalTimeRange {
  mode: "relative" | "absolute";
  relative?: string;
  from: number;
  to: number;
}

export interface SignalTimeRangePreset {
  token: string;
  label: string;
  durationMs: number;
}

/**
 * Domain labels for the canonical DS TimeRangePicker. Its preset resolver
 * needs a duration, while Radar normalizes the selected range to calendar
 * months below before it reaches the display lens.
 */
export const SIGNAL_TIME_RANGE_PRESETS: SignalTimeRangePreset[] = [
  { token: "3mo", label: "3 derniers mois", durationMs: 90 * DAY_MS },
  { token: "6mo", label: "6 derniers mois", durationMs: 180 * DAY_MS },
  { token: "12mo", label: "12 derniers mois", durationMs: 365 * DAY_MS },
];

const MONTHS_BY_PRESET: Record<string, number> = {
  "3mo": 3,
  "6mo": 6,
  "12mo": 12,
};

function calendarMonthsAgo(to: number, months: number): number {
  const end = new Date(to);
  const targetYear = end.getFullYear();
  const targetMonth = end.getMonth() - months;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

  return new Date(
    targetYear,
    targetMonth,
    Math.min(end.getDate(), lastDayOfTargetMonth),
    end.getHours(),
    end.getMinutes(),
    end.getSeconds(),
    end.getMilliseconds(),
  ).getTime();
}

function signalTimeRangeForPreset(token: string, to: number): SignalTimeRange | null {
  const months = MONTHS_BY_PRESET[token];
  if (!months) return null;

  return {
    mode: "relative",
    relative: token,
    from: calendarMonthsAgo(to, months),
    to,
  };
}

/** The Radar opens on its established six-calendar-month temporal lens. */
export function defaultSignalTimeRange(now = Date.now()): SignalTimeRange {
  return signalTimeRangeForPreset("6mo", now)!;
}

/**
 * The DS resolves custom presets as a duration. Convert Radar's relative
 * month presets to their calendar-month equivalent before filtering data.
 */
export function normalizeSignalTimeRange(
  range: SignalTimeRange,
  now = Date.now(),
): SignalTimeRange {
  if (range.mode !== "relative" || !range.relative) return range;
  return signalTimeRangeForPreset(range.relative, now) ?? range;
}

/** Accessible trigger text for the DS New Relic-style time range picker. */
export function formatSignalTimeRange(range: SignalTimeRange, locale: string): string {
  if (range.mode === "relative" && range.relative) {
    const preset = SIGNAL_TIME_RANGE_PRESETS.find(({ token }) => token === range.relative);
    if (preset) return preset.label;
  }

  // The filter is date-based, so a time-of-day in the trigger only creates
  // noise and makes the compact rail field overflow. `fr-CA` yields the
  // familiar ISO-like local date format while other locales keep their own
  // compact date order.
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${formatter.format(new Date(range.from))} – ${formatter.format(new Date(range.to))}`;
}

/** Internal date-only range consumed by the Signals projection lens. */
export interface SignalDateRange {
  start: Date | null;
  end: Date | null;
}

function localDate(timestamp: number): Date {
  const source = new Date(timestamp);
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

/** Adapts the DS epoch range to inclusive local civil dates for graph data. */
export function dateRangeFromSignalTimeRange(range: SignalTimeRange): SignalDateRange {
  return { start: localDate(range.from), end: localDate(range.to) };
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

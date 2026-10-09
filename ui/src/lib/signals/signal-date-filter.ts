import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import { matchesDocumentDateWindow, type DocumentDateBasis, type DocumentDateWindow } from "@radar/domain";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SignalTimeRange {
  mode: "relative" | "absolute";
  relative?: string;
  from: number;
  to: number;
}

/**
 * The acquisition clock only applies to a custom (absolute) period: every
 * relative preset, `Illimité` included, always reads document dates.
 */
export function dateBasisForTimeRange(range: SignalTimeRange, basis: DocumentDateBasis): DocumentDateBasis {
  return range.mode === "absolute" ? basis : "document";
}

export interface SignalTimeRangePreset {
  token: string;
  label: string;
  durationMs: number;
}

/**
 * Domain labels for the canonical DS TimeRangePicker, in display order. Its
 * preset resolver needs a duration, while Radar normalizes the selected range
 * to calendar days/months below before it reaches the display lens.
 */
export const SIGNAL_TIME_RANGE_PRESETS: SignalTimeRangePreset[] = [
  { token: "7d", label: "Dernière semaine", durationMs: 7 * DAY_MS },
  { token: "1mo", label: "Dernier mois", durationMs: 30 * DAY_MS },
  { token: "3mo", label: "3 derniers mois", durationMs: 90 * DAY_MS },
  { token: "6mo", label: "6 derniers mois", durationMs: 180 * DAY_MS },
  { token: "12mo", label: "12 derniers mois", durationMs: 365 * DAY_MS },
  // « Illimité » — aucune borne temporelle. La durée nourrit seulement le
  // résolveur du picker DS ; le filtrage réel passe par des bornes NULLES
  // (dateRangeFromSignalTimeRange), qu'isWithinRange traite comme ±∞.
  { token: "all", label: "Illimité", durationMs: 100 * 365 * DAY_MS },
];

const DAYS_BY_PRESET: Record<string, number> = {
  "7d": 7,
};

const MONTHS_BY_PRESET: Record<string, number> = {
  "1mo": 1,
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

/** Same local time-of-day, N calendar days earlier (DST-safe, unlike N × 24 h). */
function calendarDaysAgo(to: number, days: number): number {
  const end = new Date(to);
  return new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() - days,
    end.getHours(),
    end.getMinutes(),
    end.getSeconds(),
    end.getMilliseconds(),
  ).getTime();
}

function signalTimeRangeForPreset(token: string, to: number): SignalTimeRange | null {
  const days = DAYS_BY_PRESET[token];
  const months = MONTHS_BY_PRESET[token];
  if (!days && !months) return null;

  return {
    mode: "relative",
    relative: token,
    from: days ? calendarDaysAgo(to, days) : calendarMonthsAgo(to, months),
    to,
  };
}

/** The Radar opens on the last week (owner decision 2026-10-09). */
export const DEFAULT_SIGNAL_TIME_RANGE_PRESET = "7d";

export function defaultSignalTimeRange(now = Date.now()): SignalTimeRange {
  return signalTimeRangeForPreset(DEFAULT_SIGNAL_TIME_RANGE_PRESET, now)!;
}

/**
 * The DS resolves custom presets as a duration. Convert Radar's relative
 * presets to their calendar-day/month equivalent before filtering data.
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
  // Preset « Illimité » : aucune borne (isWithinRange lit null comme ±∞).
  if (range.mode === "relative" && range.relative === "all") {
    return { start: null, end: null };
  }
  return { start: localDate(range.from), end: localDate(range.to) };
}

/** The API and client consume identical civil-date boundaries and date basis. */
export function signalDocumentDateWindow(range: SignalDateRange, dateBasis: DocumentDateBasis = "document"): DocumentDateWindow {
  const civil = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return {
    dateBasis,
    ...(range.start ? { dateFrom: civil(range.start) } : {}),
    ...(range.end ? { dateTo: civil(range.end) } : {}),
  };
}

/** Presentation metadata never changes the persisted-reference membership. */
export function filterNodesByDocumentDate(
  nodes: readonly GraphSignalNode[],
  range: SignalDateRange,
  dateBasis: DocumentDateBasis = "document",
): GraphSignalNode[] {
  const window = signalDocumentDateWindow(range, dateBasis);
  return nodes.filter((node) => matchesDocumentDateWindow(node.props, window));
}

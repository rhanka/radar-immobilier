/**
 * Pure feed helpers for the Radar T1 signals view.
 *
 * Value and confidence are SEPARATE sort dimensions — never multiplied.
 * Confidence ordering: high > medium > low (numeric map 3 > 2 > 1).
 */

import type { SignalT, SignalStatusT } from "@radar/domain";

export type SortKey = "value" | "confidence";
export type SortDir = "asc" | "desc";

/** Map confidence string to a numeric rank for sorting (high=3, medium=2, low=1). */
const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Filter by status — "tous" passes all rows. */
export function filterByStatus(
  signals: SignalT[],
  status: SignalStatusT | "tous",
): SignalT[] {
  if (status === "tous") return signals;
  return signals.filter((s) => s.status === status);
}

/** Sort by a single key (value or confidence), in the given direction. */
export function sortSignals(
  signals: SignalT[],
  key: SortKey,
  dir: SortDir,
): SignalT[] {
  const sorted = [...signals].sort((a, b) => {
    let aVal: number;
    let bVal: number;
    if (key === "value") {
      aVal = a.value;
      bVal = b.value;
    } else {
      aVal = CONFIDENCE_RANK[a.confidence] ?? 0;
      bVal = CONFIDENCE_RANK[b.confidence] ?? 0;
    }
    return dir === "desc" ? bVal - aVal : aVal - bVal;
  });
  return sorted;
}

/** Immutably set the status of one signal to "à-approfondir". */
export function markApprofondir(signals: SignalT[], id: string): SignalT[] {
  return signals.map((s) =>
    s.id === id ? { ...s, status: "à-approfondir" as SignalStatusT } : s,
  );
}

/** Apply status filter then sort — pure composition. */
export function buildFeed(
  signals: SignalT[],
  statusFilter: SignalStatusT | "tous",
  sortKey: SortKey,
  sortDir: SortDir,
): SignalT[] {
  return sortSignals(filterByStatus(signals, statusFilter), sortKey, sortDir);
}

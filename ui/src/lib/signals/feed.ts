/**
 * Pure feed helpers for the Radar T1 signals view.
 *
 * Value and confidence are SEPARATE sort dimensions — never multiplied.
 * Confidence ordering: high > medium > low (numeric map 3 > 2 > 1).
 *
 * S1.4: two sort modes —
 *   "value"         : tri par score /10 (desc)
 *   "vision-priority": tri par priorité VISION (ordre Priorité 1→4)
 *   Note: la VISION est contradictoire (CPTAQ « Priorité 4 » = 8/10 > PPCMOI 7).
 *   D'où les deux tris disponibles.
 */

import type { SignalT, SignalStatusT, SignalTypeT } from "@radar/domain";

export type SortKey = "value" | "confidence" | "vision-priority";
export type SortDir = "asc" | "desc";

/**
 * VISION Priorité 1→4 ordering for signal types (S1.4).
 * Priorité 1 = la plus importante → rang 1 (apparaît en premier en desc).
 * Types non listés → rang 99.
 */
export const VISION_PRIORITY_RANK: Partial<Record<SignalTypeT, number>> = {
  "residential-rezoning": 1, // Priorité 1 VISION
  "ppcmoi": 2,               // Priorité 2 VISION
  "plan-urbanisme": 3,       // Priorité 3 VISION
  "cptaq": 4,                // Priorité 4 VISION (mais 8/10 > PPCMOI 7/10 — voir bulle d'aide)
  "grid-cos-modification": 4, // même rang que CPTAQ dans VISION
  "derogation-relevant": 5,  // filtre pur — placé après les types scorés
  "public-consultation": 6,
  "derogation-irrelevant": 99,
};

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

/** Sort by a single key (value, confidence, or vision-priority), in the given direction. */
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
    } else if (key === "vision-priority") {
      // Rang VISION : 1 = plus prioritaire → ordre asc = plus important d'abord
      aVal = VISION_PRIORITY_RANK[a.type] ?? 99;
      bVal = VISION_PRIORITY_RANK[b.type] ?? 99;
      // Pour "vision-priority" on inverse la logique : asc met les Priorité 1 en tête
      return dir === "desc" ? aVal - bVal : bVal - aVal;
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

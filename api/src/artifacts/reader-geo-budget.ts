/**
 * Per-reader budget for the governed geo items operation (J1 zonage, field
 * review j1-2b §13: `geo.collection-items.v1` 30 req/min per (reader,
 * artifact), overrun = typed 429 with `Retry-After`).
 *
 * Process-local fixed windows: every API replica enforces its own window,
 * which only makes the effective budget tighter. Validation errors and
 * catalogue refusals count (the hit is recorded before param validation),
 * so probing unknown collections spends the same budget. Nothing is recorded
 * on a refused (over-budget) call.
 *
 * Kept in its own file so the J1.2d/e general budget store can absorb it
 * without touching the geo block twice.
 */

export const GEO_ITEMS_BUDGET_PER_MINUTE = 30;
export const GEO_ITEMS_BUDGET_WINDOW_MS = 60_000;

export interface GeoReaderBudget {
  /** Record one hit for (reader, artifact), or refuse with seconds until reset. */
  consume(readerSub: string, artifactId: string, nowMs: number): { ok: true } | { ok: false; retryAfterSec: number };
}

export function createGeoReaderBudget(
  limit: number = GEO_ITEMS_BUDGET_PER_MINUTE,
  windowMs: number = GEO_ITEMS_BUDGET_WINDOW_MS,
): GeoReaderBudget {
  const hits = new Map<string, number[]>();
  return {
    consume(readerSub, artifactId, nowMs) {
      const key = `${readerSub}\u0000${artifactId}`;
      const recent = (hits.get(key) ?? []).filter((at) => at > nowMs - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const oldest = Math.min(...recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000)) };
      }
      recent.push(nowMs);
      hits.set(key, recent);
      // Bound memory: drop idle keys opportunistically.
      if (hits.size > 10_000) {
        for (const [other, times] of hits) {
          if (times.every((at) => at <= nowMs - windowMs)) hits.delete(other);
        }
      }
      return { ok: true };
    },
  };
}

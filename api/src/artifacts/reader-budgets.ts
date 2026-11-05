/**
 * J1.2d/e wagon 2 — per-reader budgets (§13). In-memory fixed windows keyed
 * by (reader, artifact, op), plus the global per-(reader, artifact) budget
 * and the per-workspace admission budget. Overrun answers 429 with
 * `Retry-After` and is journaled without business data; validation failures
 * and resolution misses count against the same budget (anti-enumeration).
 *
 * The store is process-local: every API replica enforces its own windows,
 * which only makes the effective budget tighter, never looser.
 */
export interface BudgetWindow {
  /** Max hits inside the window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface ReaderBudgetStore {
  /**
   * Record one hit of `key` when every window allows it. Returns `ok: true`
   * and records the hit, or `ok: false` with the seconds until the most
   * restrictive window resets (for `Retry-After`). Nothing is recorded on
   * refusal, so a refused client is not pushed further over.
   */
  consume(key: string, windows: readonly BudgetWindow[], nowMs: number): { ok: true } | { ok: false; retryAfterSec: number };
  /** Enter a bounded-concurrency section (`documents`, `coherent-city`). */
  tryEnter(key: string, maxConcurrent: number): boolean;
  /** Leave a bounded-concurrency section entered with `tryEnter`. */
  leave(key: string): void;
}

export function minute(limit: number): BudgetWindow {
  return { limit, windowMs: 60_000 };
}

export function burst(limit: number, windowMs = 10_000): BudgetWindow {
  return { limit, windowMs };
}

export function hour(limit: number): BudgetWindow {
  return { limit, windowMs: 3_600_000 };
}

/** §13 budgets per (reader, artifact, op): minute cap + burst cap. */
export const READER_OP_BUDGETS: Record<string, readonly BudgetWindow[]> = {
  "app.me.v1": [minute(20), burst(5)],
  "workspaces.list.v1": [minute(10), burst(3)],
  "signals.by-city.v1": [minute(10), burst(3)],
  "signals.coherent-city.v1": [minute(20), burst(3)],
  "documents.pv.v1": [minute(10), burst(2), hour(100)],
};

/** §13 global budget per (reader, artifact), all reader ops together. */
export const READER_GLOBAL_BUDGET: readonly BudgetWindow[] = [minute(180)];

/** §13 per-workspace admission budget for the two signal enumeration ops. */
export const READER_WORKSPACE_BUDGET: readonly BudgetWindow[] = [minute(200)];

/** §13 concurrency caps per (reader, artifact, op). */
export const READER_CONCURRENCY: Record<string, number> = {
  "signals.coherent-city.v1": 2,
  "documents.pv.v1": 2,
};

export function budgetKey(readerSub: string, artifactId: string, op: string): string {
  return `${readerSub}\u0000${artifactId}\u0000${op}`;
}

export function createBudgetStore(): ReaderBudgetStore {
  const hits = new Map<string, number[]>();
  const inflight = new Map<string, number>();
  return {
    consume(key, windows, nowMs) {
      // One recorded hit per call, evaluated against every window: the 60 s
      // window of a [minute(20), burst(5)] pair sees 5 hits after 5 calls,
      // not 10.
      const horizon = windows.reduce((max, window) => Math.max(max, window.windowMs), 0);
      const seen = (hits.get(key) ?? []).filter((at) => at > nowMs - horizon);
      let retryAfterSec = 0;
      for (const window of windows) {
        const inWindow = seen.filter((at) => at > nowMs - window.windowMs);
        if (inWindow.length >= window.limit) {
          const oldest = Math.min(...inWindow);
          retryAfterSec = Math.max(retryAfterSec, Math.ceil((oldest + window.windowMs - nowMs) / 1000));
        }
      }
      if (retryAfterSec > 0) {
        hits.set(key, seen);
        return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
      }
      seen.push(nowMs);
      hits.set(key, seen);
      return { ok: true };
    },
    tryEnter(key, maxConcurrent) {
      const current = inflight.get(key) ?? 0;
      if (current >= maxConcurrent) return false;
      inflight.set(key, current + 1);
      return true;
    },
    leave(key) {
      const current = inflight.get(key) ?? 0;
      if (current <= 1) inflight.delete(key);
      else inflight.set(key, current - 1);
    },
  };
}

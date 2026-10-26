import {
  EXCHANGE_CACHE_TTL_S,
  EXCHANGE_EARLY_MARGIN_S,
  EXCHANGE_MAX_ENTRIES,
  EXCHANGE_MAX_INFLIGHT,
} from "./exchange-config.js";
import type { ValidatedExchange } from "./exchange-token.js";

export interface ExchangeCacheKeyParts {
  readonly issuer: string;
  readonly subjectIdentity: string;
  readonly human: string;
  readonly client: string;
  readonly workloadSub: string;
  readonly environment: string;
  readonly membership: string;
  readonly target: string;
  readonly effectiveScopes: string;
  readonly confirmation: string;
  readonly policyRevision: string;
}

/** Stable cache key over every authority dimension (H4 contract). */
export function buildCacheKey(parts: ExchangeCacheKeyParts): string {
  return JSON.stringify([
    parts.issuer,
    parts.subjectIdentity,
    parts.human,
    parts.client,
    parts.workloadSub,
    parts.environment,
    parts.membership,
    parts.target,
    parts.effectiveScopes,
    parts.confirmation,
    parts.policyRevision,
  ]);
}

export interface CachedExchange {
  readonly validated: ValidatedExchange;
  readonly subjectExp: number;
  readonly insertedAtMs: number;
  readonly deadlineMs: number;
}

export interface ExchangeCacheOptions {
  readonly maxEntries?: number | undefined;
  readonly ttlMs?: number | undefined;
  readonly earlyMarginMs?: number | undefined;
  readonly clock?: (() => number) | undefined;
}

/**
 * Bounded delegated-token cache. The deadline is
 * `min(issued.exp, subject.exp, insertedAt + ttl) - margin`. Entries at or
 * past the deadline are never returned (no stale reuse).
 */
export class ExchangeCache {
  private readonly entries = new Map<string, CachedExchange>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly earlyMarginMs: number;
  private readonly clock: () => number;

  constructor(opts: ExchangeCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? EXCHANGE_MAX_ENTRIES;
    this.ttlMs = opts.ttlMs ?? EXCHANGE_CACHE_TTL_S * 1000;
    this.earlyMarginMs = opts.earlyMarginMs ?? EXCHANGE_EARLY_MARGIN_S * 1000;
    this.clock = opts.clock ?? (() => Date.now());
  }

  size(): number {
    return this.entries.size;
  }

  getIfFresh(key: string, now: number = this.clock()): CachedExchange | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now >= entry.deadlineMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Touch for LRU order without changing the deadline.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  store(key: string, validated: ValidatedExchange, subjectExp: number, now: number = this.clock()): CachedExchange {
    const deadlineMs =
      Math.min(validated.exp * 1000, Math.floor(subjectExp) * 1000, now + this.ttlMs) -
      this.earlyMarginMs;
    if (deadlineMs <= now) throw new Error("exchange_cache_entry_expired");
    const entry: CachedExchange = { validated, subjectExp, insertedAtMs: now, deadlineMs };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return entry;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Single-flight gate with a bound on concurrent exchanges. Concurrent
 * callers for one key share one issuer call; a rejected exchange never
 * poisons later callers.
 */
export class SingleFlightExchange {
  private readonly inflight = new Map<string, Promise<ValidatedExchange>>();
  private readonly maxInflight: number;

  constructor(maxInflight: number = EXCHANGE_MAX_INFLIGHT) {
    this.maxInflight = maxInflight;
  }

  pendingCount(): number {
    return this.inflight.size;
  }

  async getOrExchange(
    key: string,
    exchange: () => Promise<ValidatedExchange>,
  ): Promise<ValidatedExchange> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    if (this.inflight.size >= this.maxInflight) {
      throw new Error("exchange_concurrency_exceeded");
    }
    const pending = exchange().finally(() => {
      if (this.inflight.get(key) === pending) this.inflight.delete(key);
    });
    this.inflight.set(key, pending);
    return pending;
  }
}

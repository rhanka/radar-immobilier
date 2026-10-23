import { describe, expect, it } from "vitest";
import { buildCacheKey, ExchangeCache, SingleFlightExchange } from "./exchange-cache.js";
import type { ValidatedExchange } from "./exchange-token.js";

function validated(overrides: Partial<ValidatedExchange> = {}): ValidatedExchange {
  const now = Math.floor(Date.now() / 1000);
  return {
    token: "ex-1",
    sub: "user-1",
    exp: now + 120,
    iat: now,
    scopes: ["immo:search"],
    tokenIdentity: "jti-1",
    actSub: "immo-mcp-workload",
    clientId: "immo-mcp-workload",
    ...overrides,
  };
}

const KEY = {
  issuer: "iss",
  subjectIdentity: "jti-1",
  human: "user-1",
  client: "immo-cli",
  workloadSub: "immo-mcp-workload",
  environment: "test-artefacts-mcp-a2",
  membership: "radar:default",
  target: "https://immo.test.local",
  effectiveScopes: "immo:search",
  confirmation: "none",
  policyRevision: "p4-v1",
};

describe("buildCacheKey", () => {
  it("separates users, clients, scopes and policy revisions", () => {
    const a = buildCacheKey(KEY);
    expect(buildCacheKey({ ...KEY, subjectIdentity: "jti-2" })).not.toBe(a);
    expect(buildCacheKey({ ...KEY, human: "user-2" })).not.toBe(a);
    expect(buildCacheKey({ ...KEY, client: "other" })).not.toBe(a);
    expect(buildCacheKey({ ...KEY, effectiveScopes: "immo:read" })).not.toBe(a);
    expect(buildCacheKey({ ...KEY, policyRevision: "p4-v2" })).not.toBe(a);
    for (const field of Object.keys(KEY) as (keyof typeof KEY)[]) {
      expect(buildCacheKey({ ...KEY, [field]: `${KEY[field]}-changed` })).not.toBe(a);
    }
  });
});

describe("ExchangeCache", () => {
  it.each([[10, 120, 5_000], [120, 20, 15_000]])(
    "expires at the delegated or subject deadline (%s/%s seconds)", (issued, subject, expected) => {
      const now = 1_000_000;
      const cache = new ExchangeCache({ clock: () => now });
      const entry = cache.store("key", validated({ exp: now / 1000 + issued }), now / 1000 + subject);
      expect(entry.deadlineMs).toBe(now + expected);
      expect(cache.getIfFresh("key", now + expected - 1)).toBeDefined();
      expect(cache.getIfFresh("key", now + expected)).toBeUndefined();
    },
  );
  it("honours min(issued, subject, inserted+60s) minus margin and never serves stale entries", () => {
    let now = 1_000_000;
    const cache = new ExchangeCache({ clock: () => now });
    const key = buildCacheKey(KEY);
    const fresh = validated({ exp: Math.floor(now / 1000) + 600 });
    const entry = cache.store(key, fresh, Math.floor(now / 1000) + 600, now);
    expect(entry.deadlineMs).toBe(now + 60_000 - 5_000);
    expect(cache.getIfFresh(key, now)?.validated.token).toBe("ex-1");
    now += 55_001;
    expect(cache.getIfFresh(key, now)).toBeUndefined();
  });

  it("bounds capacity with LRU eviction and supports invalidation", () => {
    const now = 2_000_000;
    const cache = new ExchangeCache({ maxEntries: 2, clock: () => now });
    const keys = ["a", "b", "c"].map((human) => buildCacheKey({ ...KEY, human }));
    for (const [i, key] of keys.entries()) {
      cache.store(key, validated({ token: `ex-${i}`, tokenIdentity: `j-${i}` }), Math.floor(now / 1000) + 600, now);
    }
    expect(cache.size()).toBe(2);
    expect(cache.getIfFresh(keys[0] as string, now)).toBeUndefined();
    cache.invalidate(keys[1] as string);
    expect(cache.getIfFresh(keys[1] as string, now)).toBeUndefined();
  });
});

describe("SingleFlightExchange", () => {
  it("shares one issuer call across concurrent requests and bounds concurrency", async () => {
    const flight = new SingleFlightExchange(1);
    let calls = 0;
    const slow = () => new Promise<ValidatedExchange>((resolve) => {
      calls += 1;
      setTimeout(() => resolve(validated()), 5);
    });
    const [a, b] = await Promise.all([flight.getOrExchange("k", slow), flight.getOrExchange("k", slow)]);
    expect(a.token).toBe(b.token);
    expect(calls).toBe(1);
    const gate = flight.getOrExchange("busy", () => new Promise<ValidatedExchange>(() => {}));
    await expect(flight.getOrExchange("other", async () => validated())).rejects.toThrow(/exchange_concurrency_exceeded/);
    void gate;
  });
});

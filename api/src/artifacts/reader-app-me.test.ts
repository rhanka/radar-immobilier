import { describe, expect, it } from "vitest";
import { buildAppMeResponse, deriveUserRef } from "./reader-me.js";
import { budgetKey, burst, createBudgetStore, hour, minute } from "./reader-budgets.js";

const SECRET = "session-secret-32-bytes-long-pad!!";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ARTIFACT = "123e4567-e89b-12d3-a456-426614174009";

describe("app.me userRef (§2.3)", () => {
  it("should derive a stable opaque ref per artifact and reader", () => {
    const first = deriveUserRef(SECRET, ARTIFACT, "reader-alice");
    expect(first).toMatch(/^usr_[A-Za-z0-9_-]{32}$/);
    expect(deriveUserRef(SECRET, ARTIFACT, "reader-alice")).toBe(first);
  });

  it("should separate readers and artifacts without exposing the subject", () => {
    const alice = deriveUserRef(SECRET, ARTIFACT, "reader-alice");
    const bob = deriveUserRef(SECRET, ARTIFACT, "reader-bob");
    const elsewhere = deriveUserRef(SECRET, OTHER_ARTIFACT, "reader-alice");
    expect(new Set([alice, bob, elsewhere]).size).toBe(3);
    for (const ref of [alice, bob, elsewhere]) {
      expect(ref).not.toContain("reader-alice");
      expect(ref).not.toContain("reader-bob");
      expect(ref).not.toContain(ARTIFACT);
    }
  });

  it("should serve exactly the §2.3 contract and nothing else", () => {
    const body = buildAppMeResponse(SECRET, ARTIFACT, "reader-alice");
    expect(body).toEqual({ authenticated: true,
      user: { sub: deriveUserRef(SECRET, ARTIFACT, "reader-alice"), name: "Lecteur", status: "approved" } });
    expect(Object.keys(body).sort()).toEqual(["authenticated", "user"]);
    expect(Object.keys(body.user).sort()).toEqual(["name", "status", "sub"]);
  });
});

describe("reader budgets (§13)", () => {
  it("should refuse past the minute cap with a Retry-After hint", () => {
    const store = createBudgetStore();
    const key = budgetKey("reader-alice", ARTIFACT, "app.me.v1");
    for (let at = 0; at < 20; at += 1) expect(store.consume(key, [minute(20)], at * 1_000).ok).toBe(true);
    const refused = store.consume(key, [minute(20)], 20_000);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSec).toBeGreaterThan(0);
    // The window slides: the first hit expires and the call passes again.
    expect(store.consume(key, [minute(20)], 61_000).ok).toBe(true);
  });

  it("should refuse bursts even under the minute cap", () => {
    const store = createBudgetStore();
    const key = budgetKey("reader-alice", ARTIFACT, "app.me.v1");
    for (let at = 0; at < 5; at += 1) expect(store.consume(key, [minute(20), burst(5)], 1_000).ok).toBe(true);
    expect(store.consume(key, [minute(20), burst(5)], 1_000).ok).toBe(false);
  });

  it("should bound documents to 100 resolutions an hour", () => {
    const store = createBudgetStore();
    const key = budgetKey("reader-alice", ARTIFACT, "documents.pv.v1");
    for (let at = 0; at < 100; at += 1) expect(store.consume(key, [minute(10), hour(100)], at * 30_000).ok).toBe(true);
    // The minute window is clear again, but the hour window is spent.
    expect(store.consume(key, [minute(10), hour(100)], 3_100_000).ok).toBe(false);
  });

  it("should bound concurrency without leaking permits", () => {
    const store = createBudgetStore();
    expect(store.tryEnter("doc", 2)).toBe(true);
    expect(store.tryEnter("doc", 2)).toBe(true);
    expect(store.tryEnter("doc", 2)).toBe(false);
    store.leave("doc");
    expect(store.tryEnter("doc", 2)).toBe(true);
    store.leave("doc");
    store.leave("doc");
    expect(store.tryEnter("doc", 2)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  coverRefreshDocument,
  emptyRefreshCoverage,
  failRefreshDocument,
  planRefreshCoverage,
  readRefreshCoverage,
  refreshCoverageKey,
  requeueAbandonedRefreshDocuments,
  summarizeRefreshCoverage,
  writeRefreshCoverage,
  type RefreshCoverageCandidate,
} from "./refresh-coverage.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
    return { key };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    return this.objects.has(key) ? { key } : null;
  }
}

const sha = (digit: string) => digit.repeat(64);
const clock = (iso: string) => () => new Date(iso);

function candidate(digit: string, publishedAt?: string): RefreshCoverageCandidate {
  return { sha: sha(digit), sourceId: "proces-verbaux-city",
    representationKey: `raw/proces-verbaux-city/cas/${sha(digit)}.pdf`,
    ...(publishedAt ? { publishedAt } : {}) };
}

const plan = (
  ledger: Parameters<typeof planRefreshCoverage>[0],
  candidates: readonly RefreshCoverageCandidate[],
  primeExisting: boolean,
  at = "2026-09-20T00:00:00.000Z",
) => planRefreshCoverage(ledger, "city", candidates, { primeExisting, maxFailures: 3, now: clock(at) });

describe("planRefreshCoverage", () => {
  it("primes a city's existing corpus as covered, so a first sweep pays for nothing", () => {
    // The owner's decision of 2026-09-20: new documents only. The 4 166 minutes
    // already in the graph keep the extraction they were built with.
    const primed = plan(null, [candidate("a", "2026-09-01"), candidate("b", "2026-08-01")], true);

    expect(primed.workItems).toEqual([]);
    expect(summarizeRefreshCoverage(primed.ledger)).toEqual({ pending: 0, covered: 2, abandoned: 0 });
    expect(primed.ledger.primedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(primed.changed).toBe(true);
  });

  it("owes every document published AFTER the priming, newest first", () => {
    const primed = plan(null, [candidate("a", "2026-09-01")], true);
    const later = plan(primed.ledger,
      [candidate("c", "2026-09-19"), candidate("b", "2026-09-10"), candidate("a", "2026-09-01")],
      true, "2026-09-21T00:00:00.000Z");

    expect(later.workItems.map((item) => item.sha)).toEqual([sha("c"), sha("b")]);
    expect(later.workItems.every((item) => item.listed)).toBe(true);
  });

  it("owes everything when priming is off, which is the targeted single-city mode", () => {
    const planned = plan(null, [candidate("a", "2026-09-01"), candidate("b", "2026-08-01")], false);

    expect(planned.workItems.map((item) => item.sha)).toEqual([sha("a"), sha("b")]);
    expect(planned.ledger.primedAt).toBeUndefined();
  });

  it("primes a city only once, whatever it publishes afterwards", () => {
    const primed = plan(null, [candidate("a")], true);
    const again = plan(primed.ledger, [candidate("a"), candidate("b")], true, "2026-09-22T00:00:00.000Z");

    expect(again.ledger.primedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(again.workItems.map((item) => item.sha)).toEqual([sha("b")]);
  });

  it("writes nothing when a pass finds a city unchanged", () => {
    const primed = plan(null, [candidate("a")], true);
    expect(plan(primed.ledger, [candidate("a")], true).changed).toBe(false);
  });

  it("keeps owing a pending document the source no longer lists", () => {
    // The retry queue is not the index page: a document that has dropped out of
    // the look-back window was still seen, and its bytes are content-addressed.
    const seen = plan(null, [candidate("a", "2026-09-19")], false);
    const gone = plan(seen.ledger, [candidate("b", "2026-09-20")], false, "2026-11-01T00:00:00.000Z");

    expect(gone.workItems.map((item) => [item.sha, item.listed]))
      .toEqual([[sha("b"), true], [sha("a"), false]]);
  });

  it("is keyed by the document alone, so a model or profile change owes nothing new", () => {
    // Run states carry the profile hash, the registry hash and the model policy
    // string. Reading the memory from those means that flipping force-fallback
    // because a seat is dry re-queues every document of every city.
    const primed = plan(null, [candidate("a")], true);
    expect(Object.keys(primed.ledger.documents)).toEqual([sha("a")]);
    expect(JSON.stringify(primed.ledger)).not.toMatch(/policy|profile|registry/i);
  });
});

describe("failRefreshDocument", () => {
  it("counts failures and sets a document aside before it blocks its city for ever", () => {
    // ~15 % of documents are refused on quality under the Gemini fallback. A
    // refused document stays the city's first pending document: without this,
    // it hides every document behind it and pays primary plus fallback on every
    // rotation, for ever.
    let ledger = plan(null, [candidate("a"), candidate("b")], false).ledger;
    for (const attempt of [1, 2]) {
      const failed = failRefreshDocument(ledger, sha("a"), "quality", 3, clock("2026-09-20T00:00:00.000Z"));
      ledger = failed.ledger;
      expect(failed.abandoned).toBe(false);
      expect(failed.failures).toBe(attempt);
      // Still first in line while it has attempts left.
      expect(plan(ledger, [candidate("a"), candidate("b")], false).workItems[0]!.sha).toBe(sha("a"));
    }
    const third = failRefreshDocument(ledger, sha("a"), "quality", 3, clock("2026-09-20T00:00:00.000Z"));
    expect(third.abandoned).toBe(true);
    expect(third.ledger.documents[sha("a")]).toMatchObject({ state: "abandoned", lastReason: "quality" });
    // And the next document of the city finally gets its turn.
    expect(plan(third.ledger, [candidate("a"), candidate("b")], false).workItems.map((i) => i.sha))
      .toEqual([sha("b")]);
  });
});

describe("coverRefreshDocument", () => {
  it("settles a document once its signals have reached Postgres", () => {
    const planned = plan(null, [candidate("a")], false);
    const covered = coverRefreshDocument(planned.ledger, sha("a"), clock("2026-09-20T01:00:00.000Z"));

    expect(covered.documents[sha("a")]).toMatchObject({ state: "covered" });
    expect(plan(covered, [candidate("a")], false).workItems).toEqual([]);
  });

  it("refuses to settle a document the ledger has never seen", () => {
    expect(() => coverRefreshDocument(emptyRefreshCoverage("city", clock("2026-09-20T00:00:00.000Z")),
      sha("a"), clock("2026-09-20T00:00:00.000Z"))).toThrow("Unknown refresh coverage document");
  });
});

describe("requeueAbandonedRefreshDocuments", () => {
  const abandonedLedger = () => {
    let ledger = plan(null, [candidate("a", "2026-09-01"), candidate("b"), candidate("c")], false).ledger;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ledger = failRefreshDocument(ledger, sha("a"), "transport", 3, clock("2026-10-30T00:00:00.000Z")).ledger;
      ledger = failRefreshDocument(ledger, sha("b"), "quality", 3, clock("2026-11-05T00:00:00.000Z")).ledger;
    }
    return ledger;
  };

  it("requeues abandoned only: pending, failures 0, lastReason removed, identity unchanged", () => {
    const before = abandonedLedger();
    const { ledger, requeued, changed } = requeueAbandonedRefreshDocuments(before,
      { now: clock("2026-11-09T00:00:00.000Z") });

    expect(changed).toBe(true);
    expect(requeued).toEqual([sha("a"), sha("b")]);
    for (const digit of ["a", "b"]) {
      const entry = ledger.documents[sha(digit)]!;
      const old = before.documents[sha(digit)]!;
      expect(entry.state).toBe("pending");
      expect(entry.failures).toBe(0);
      expect("lastReason" in entry).toBe(false);
      expect(entry.sourceId).toBe(old.sourceId);
      expect(entry.representationKey).toBe(old.representationKey);
      expect(entry.firstSeenAt).toBe(old.firstSeenAt);
      expect(entry.publishedAt).toBe(old.publishedAt);
    }
    // Nothing else touched: the still-pending document is byte-identical.
    expect(ledger.documents[sha("c")]).toEqual(before.documents[sha("c")]);
    expect(summarizeRefreshCoverage(ledger)).toEqual({ pending: 3, covered: 0, abandoned: 0 });
  });

  it("honours --since: only documents whose last failure is after the date", () => {
    const before = abandonedLedger();
    const { ledger, requeued } = requeueAbandonedRefreshDocuments(before,
      { since: new Date("2026-11-01T00:00:00.000Z"), now: clock("2026-11-09T00:00:00.000Z") });

    expect(requeued).toEqual([sha("b")]);
    expect(ledger.documents[sha("a")]!.state).toBe("abandoned");
    // The boundary is strict: a failure exactly at --since stays abandoned.
    const atBoundary = requeueAbandonedRefreshDocuments(before,
      { since: new Date("2026-11-05T00:00:00.000Z"), now: clock("2026-11-09T00:00:00.000Z") });
    expect(atBoundary.requeued).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", () => {
    const first = requeueAbandonedRefreshDocuments(abandonedLedger(),
      { now: clock("2026-11-09T00:00:00.000Z") });
    const second = requeueAbandonedRefreshDocuments(first.ledger,
      { now: clock("2026-11-10T00:00:00.000Z") });

    expect(second.changed).toBe(false);
    expect(second.requeued).toEqual([]);
    expect(second.ledger).toEqual(first.ledger);
  });
});

describe("readRefreshCoverage", () => {
  it("round-trips a ledger", async () => {
    const store = new MemoryStore();
    const planned = plan(null, [candidate("a", "2026-09-01")], true);
    await writeRefreshCoverage(store, planned.ledger);

    expect(await readRefreshCoverage(store, "city"))
      .toEqual({ ledger: planned.ledger, unreadable: false });
    expect(store.objects.has(refreshCoverageKey("city"))).toBe(true);
  });

  it("distinguishes an absent ledger from an unreadable one", async () => {
    const store = new MemoryStore();
    expect(await readRefreshCoverage(store, "city")).toEqual({ ledger: null, unreadable: false });

    await store.put(refreshCoverageKey("city"), "{ not json");
    expect(await readRefreshCoverage(store, "city")).toEqual({ ledger: null, unreadable: true });

    // A ledger belonging to another city is not this city's memory.
    await store.put(refreshCoverageKey("city"),
      JSON.stringify({ schemaVersion: 1, citySlug: "elsewhere", updatedAt: "x", documents: {} }));
    expect(await readRefreshCoverage(store, "city")).toEqual({ ledger: null, unreadable: true });
  });
});

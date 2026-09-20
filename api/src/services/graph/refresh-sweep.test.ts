import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  assessRefreshSweepHealth,
  classifyRefreshCityError,
  classifyRefreshCityStatus,
  parseRefreshTarget,
  readRefreshSweepCursor,
  REFRESH_SWEEP_CURSOR_KEY,
  REFRESH_SWEEP_LATEST_REPORT_KEY,
  resolveRefreshSweepResume,
  runRefreshSweep,
  writeRefreshSweepCursor,
  writeRefreshSweepReport,
  type RefreshSweepOptions,
} from "./refresh-sweep.js";

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

const CITIES = ["alpha", "bravo", "charlie", "delta"];

function cursorOf(store: MemoryStore): unknown {
  return JSON.parse(new TextDecoder().decode(store.objects.get(REFRESH_SWEEP_CURSOR_KEY)!));
}

function options(store: MemoryStore, overrides: Partial<RefreshSweepOptions> = {}): RefreshSweepOptions {
  return {
    cities: CITIES,
    store,
    refreshCity: async () => ({ status: "up-to-date" }),
    deadlineMs: 1_000_000,
    maxSubmissions: 0,
    cityReserveMs: 0,
    ...overrides,
  };
}

/** A clock that advances by a fixed step on every read, for deterministic budgets. */
function steppingClock(stepMs: number): () => number {
  let value = 0;
  return () => (value += stepMs);
}

describe("parseRefreshTarget", () => {
  it("accepts --all and a single slug, and refuses everything else", () => {
    expect(parseRefreshTarget(["--all"])).toEqual({ all: true });
    expect(parseRefreshTarget(["waterloo"])).toEqual({ all: false, citySlug: "waterloo" });
    expect(() => parseRefreshTarget([])).toThrow("Usage");
    expect(() => parseRefreshTarget(["waterloo", "delson"])).toThrow("Usage");
    expect(() => parseRefreshTarget(["--all", "waterloo"])).toThrow("not both");
    expect(() => parseRefreshTarget(["--every"])).toThrow("Unknown option: --every");
  });
});

describe("classifyRefreshCityStatus", () => {
  it("refuses to read an unknown or missing status as a publication", () => {
    // `refreshCity` used to be typed to allow `void`, and anything that was not
    // exactly "up-to-date" counted as a published document — a contract under
    // which a silent unit of work would report model spend it never made.
    expect(classifyRefreshCityStatus({ status: "published" })).toBe("published");
    expect(classifyRefreshCityStatus({ status: "up-to-date" })).toBe("up-to-date");
    expect(classifyRefreshCityStatus({ status: "deferred" })).toBe("deferred");
    expect(classifyRefreshCityStatus({ status: "something-else" })).toBe("failed");
    expect(classifyRefreshCityStatus({})).toBe("failed");
    expect(classifyRefreshCityStatus(undefined)).toBe("failed");
  });
});

describe("classifyRefreshCityError", () => {
  it("maps the expected refusals from their code, never from their message", () => {
    const coded = (code: string) => Object.assign(new Error("Selected city acquisition failed: x"), { code });
    expect(classifyRefreshCityError(coded("REFRESH_NO_ACQUISITION"))).toBe("no-input");
    expect(classifyRefreshCityError(coded("REFRESH_NO_PDF"))).toBe("no-pdf");
    expect(classifyRefreshCityError(coded("REFRESH_NO_BASELINE"))).toBe("no-baseline");
    // A message that merely looks like a known refusal is still an unexpected failure.
    expect(classifyRefreshCityError(new Error("Selected city acquisition failed: x"))).toBe("failed");
    expect(classifyRefreshCityError("boom")).toBe("failed");
  });
});

describe("runRefreshSweep", () => {
  it("visits every city once and leaves the cursor on the first slug", async () => {
    const store = new MemoryStore();
    const visited: string[] = [];
    const report = await runRefreshSweep(options(store, {
      refreshCity: async (city) => { visited.push(city); return { status: "up-to-date" }; },
    }));

    expect(visited).toEqual(CITIES);
    expect(report.visited).toBe(4);
    expect(report.completedFullSweep).toBe(true);
    expect(report.stoppedBy).toBe("exhausted");
    expect(report.counts["up-to-date"]).toBe(4);
    expect(report.nextCity).toBe("alpha");
    expect(cursorOf(store)).toMatchObject({ schemaVersion: 1, nextCity: "alpha" });
  });

  it("resumes at the durable cursor and wraps around, so no city is skipped", async () => {
    const store = new MemoryStore();
    await writeRefreshSweepCursor(store, "charlie", () => 0);
    const visited: string[] = [];
    const report = await runRefreshSweep(options(store, {
      refreshCity: async (city) => { visited.push(city); return { status: "up-to-date" }; },
    }));

    expect(visited).toEqual(["charlie", "delta", "alpha", "bravo"]);
    expect(report.completedFullSweep).toBe(true);
    expect(report.nextCity).toBe("charlie");
  });

  it("resumes at the position a removed city occupied, not at the head of the list", async () => {
    // The list is sorted, so the first slug at or after the cursor IS where the
    // removed city was. Restarting at index 0 pushes the whole tail back by a
    // full rotation every time a city is renamed.
    const store = new MemoryStore();
    await writeRefreshSweepCursor(store, "charlie-sur-mer", () => 0);
    const visited: string[] = [];
    await runRefreshSweep(options(store, {
      refreshCity: async (city) => { visited.push(city); return { status: "up-to-date" }; },
    }));

    expect(visited).toEqual(["delta", "alpha", "bravo", "charlie"]);
    expect(resolveRefreshSweepResume(CITIES, "charlie-sur-mer")).toBe(3);
    expect(resolveRefreshSweepResume(CITIES, "zulu")).toBe(0);
    expect(resolveRefreshSweepResume(["delta", "alpha"], "bravo")).toBe(0);
  });

  it("treats an unreadable cursor as no cursor rather than failing the run", async () => {
    const store = new MemoryStore();
    await store.put(REFRESH_SWEEP_CURSOR_KEY, "{ not json");
    expect(await readRefreshSweepCursor(store)).toBeNull();
  });

  it("advances the cursor BEFORE a city runs, so a city that never finishes cannot starve the rest",
    async () => {
      const store = new MemoryStore();
      let cursorWhileWorking: unknown;
      await runRefreshSweep(options(store, {
        refreshCity: async (city) => {
          // Read the durable cursor from INSIDE the first city: this is the state
          // a SIGKILL at the Job deadline would leave behind.
          if (city === "alpha") cursorWhileWorking = cursorOf(store);
          return { status: "up-to-date" };
        },
      }));

      expect(cursorWhileWorking).toMatchObject({ nextCity: "bravo" });
    });

  it("stops on the wall-clock budget and reports where the next run resumes", async () => {
    const store = new MemoryStore();
    const visited: string[] = [];
    // Each loop reads the clock twice per city (budget check + city start/end).
    const report = await runRefreshSweep(options(store, {
      now: steppingClock(100),
      deadlineMs: 450,
      cityReserveMs: 100,
      refreshCity: async (city) => { visited.push(city); return { status: "up-to-date" }; },
    }));

    expect(report.stoppedBy).toBe("deadline");
    expect(report.completedFullSweep).toBe(false);
    expect(visited.length).toBeGreaterThan(0);
    expect(visited.length).toBeLessThan(CITIES.length);
    expect(report.nextCity).toBe(CITIES[visited.length]);
  });

  it("has no daily document ceiling: every city that owes a document gets one", async () => {
    const store = new MemoryStore();
    const report = await runRefreshSweep(options(store, {
      refreshCity: async () => ({ status: "published" }),
    }));

    expect(report.documentsExtracted).toBe(4);
    expect(report.stoppedBy).toBe("exhausted");
    expect(report.completedFullSweep).toBe(true);
  });

  it("spends a submission budget by switching extraction OFF, and still visits every city",
    async () => {
      // The reviews' blocking finding: a budget that BREAKS leaves the tail of
      // the list unvisited, so those cities are not even re-scraped that day.
      const store = new MemoryStore();
      let submissions = 0;
      const modes: { city: string; extract: boolean }[] = [];
      const report = await runRefreshSweep(options(store, {
        maxSubmissions: 2,
        submissions: () => submissions,
        refreshCity: async (city, mode) => {
          modes.push({ city, extract: mode.extract });
          if (!mode.extract) return { status: "deferred" };
          submissions += 1;
          return { status: "published" };
        },
      }));

      expect(report.visited).toBe(4);
      expect(report.completedFullSweep).toBe(true);
      expect(report.stoppedBy).toBe("exhausted");
      expect(report.extractionHaltedBy).toBe("submission-budget");
      expect(modes.map(({ extract }) => extract)).toEqual([true, true, false, false]);
      expect(report.counts).toMatchObject({ published: 2, deferred: 2 });
      // A spent budget is not a failed run: the deferred documents stay pending.
      expect(assessRefreshSweepHealth(report, 0.9)).toEqual({ exitCode: 0 });
    });

  it("counts FAILED submissions against the budget, not just published documents", async () => {
    // A document refused on quality costs the seat exactly as much as one that
    // is published. Counting publications is how 17/day became ~20 submissions.
    const store = new MemoryStore();
    let submissions = 0;
    const report = await runRefreshSweep(options(store, {
      maxSubmissions: 2,
      submissions: () => submissions,
      refreshCity: async (_city, mode) => {
        if (!mode.extract) return { status: "deferred" };
        submissions += 1;
        throw new Error("quality refused");
      },
    }));

    expect(report.counts.failed).toBe(2);
    expect(report.counts.deferred).toBe(2);
    expect(report.submissions).toBe(2);
  });

  it("stops extracting — but not visiting — when the fallback seat is out of quota", async () => {
    const store = new MemoryStore();
    let exhausted = false;
    const report = await runRefreshSweep(options(store, {
      haltExtraction: () => exhausted ? "fallback-quota-exhausted" : null,
      refreshCity: async (city, mode) => {
        if (!mode.extract) return { status: "deferred" };
        if (city === "bravo") { exhausted = true; throw new Error("429"); }
        return { status: "published" };
      },
    }));

    expect(report.visited).toBe(4);
    expect(report.extractionHaltedBy).toBe("fallback-quota-exhausted");
    // And unlike a spent budget, a dry seat IS an anomaly the Job must report.
    expect(assessRefreshSweepHealth(report, 0.9))
      .toEqual({ exitCode: 1, reason: "fallback-quota-exhausted" });
  });

  it("keeps sweeping when the cursor PUT fails, and says so", async () => {
    const store = new MemoryStore();
    let puts = 0;
    const failing = { ...store, head: store.head.bind(store), get: store.get.bind(store),
      put: async (key: string, body: Uint8Array | Buffer | string) => {
        if (++puts === 2) throw new Error("S3 unavailable");
        return store.put(key, body);
      } } as unknown as ObjectStore;
    const notes: string[] = [];
    const report = await runRefreshSweep(options(store, { store: failing,
      onNote: (note) => notes.push(note) }));

    expect(report.visited).toBe(4);
    expect(report.cursorWriteFailures).toBe(1);
    expect(notes).toContain("cursor-write-failed");
  });

  it("reports an unreadable cursor instead of silently restarting at the head", async () => {
    const store = new MemoryStore();
    await store.put(REFRESH_SWEEP_CURSOR_KEY, "{ not json");
    const notes: string[] = [];
    expect(await readRefreshSweepCursor(store, (note) => notes.push(note))).toBeNull();
    expect(notes).toEqual(["cursor-unreadable"]);
  });

  it("persists its report so the rotation is readable after the pod logs expire", async () => {
    const store = new MemoryStore();
    const report = await runRefreshSweep(options(store));
    await writeRefreshSweepReport(store, "cycle-1",
      { ...report, startedAt: "2026-09-20T00:00:00.000Z", finishedAt: "2026-09-20T02:41:00.000Z" });

    const persisted = JSON.parse(new TextDecoder()
      .decode(store.objects.get(REFRESH_SWEEP_LATEST_REPORT_KEY)!));
    expect(persisted).toMatchObject({ cycleId: "cycle-1", visited: 4, completedFullSweep: true });
    expect(persisted.entries).toHaveLength(4);
  });

  it("counts a refused city and keeps going, because one broken source is not a broken run",
    async () => {
      const store = new MemoryStore();
      const report = await runRefreshSweep(options(store, {
        refreshCity: async (city) => {
          if (city === "bravo") throw Object.assign(new Error("down"), { code: "REFRESH_NO_ACQUISITION" });
          if (city === "charlie") throw Object.assign(new Error("no graph"), { code: "REFRESH_NO_BASELINE" });
          if (city === "delta") throw new Error("unexpected");
          return { status: "published" };
        },
      }));

      expect(report.visited).toBe(4);
      expect(report.counts).toEqual({ published: 1, "up-to-date": 0, deferred: 0,
        "no-input": 1, "no-pdf": 0, "no-baseline": 1, failed: 1 });
      expect(report.entries.map((entry) => entry.outcome))
        .toEqual(["published", "no-input", "no-baseline", "failed"]);
    });

  it("stops when aborted", async () => {
    const store = new MemoryStore();
    const controller = new AbortController();
    const report = await runRefreshSweep(options(store, {
      signal: controller.signal,
      refreshCity: async () => { controller.abort(); return { status: "up-to-date" }; },
    }));

    expect(report.stoppedBy).toBe("aborted");
    expect(report.visited).toBe(1);
  });

  it("handles an empty city list without touching the cursor", async () => {
    const store = new MemoryStore();
    const report = await runRefreshSweep(options(store, { cities: [] }));
    expect(report).toMatchObject({ visited: 0, nextCity: null, stoppedBy: "exhausted" });
    expect(store.objects.size).toBe(0);
  });
});

describe("assessRefreshSweepHealth", () => {
  const report = (counts: { published?: number; failed?: number }, visited: number) => ({
    visited, entries: [], nextCity: null, completedFullSweep: true,
    stoppedBy: "exhausted" as const, documentsExtracted: 0, submissions: 0,
    cursorWriteFailures: 0,
    counts: { published: 0, "up-to-date": 0, deferred: 0, "no-input": 0, "no-pdf": 0,
      "no-baseline": 0, failed: 0, ...counts },
  });

  it("measures the failure rate over the cities that TRIED to extract", () => {
    // 93 of 528 cities had broken sources on the one measured whole-list sweep,
    // and they are counted as no-input, not failed: that MUST stay a healthy
    // run. But diluting real failures over 528 visits — most of which have
    // nothing to do — makes any threshold unreachable.
    expect(assessRefreshSweepHealth(report({ published: 10 }, 528), 0.9)).toEqual({ exitCode: 0 });
    expect(assessRefreshSweepHealth(report({ published: 8, failed: 2 }, 528), 0.9))
      .toEqual({ exitCode: 0 });
    expect(assessRefreshSweepHealth(report({ published: 0, failed: 10 }, 528), 0.9))
      .toEqual({ exitCode: 1, reason: "systemic-city-failures" });
  });

  it("does not judge a rate on a handful of attempts", () => {
    // The steady-state sweep extracts a few documents a day: one broken PDF out
    // of one attempt is a 100 % failure rate and must not fail the Job.
    expect(assessRefreshSweepHealth(report({ failed: 1 }, 528), 0.9)).toEqual({ exitCode: 0 });
  });

  it("fails a run that visited nothing at all", () => {
    expect(assessRefreshSweepHealth(report({}, 0), 0.9))
      .toEqual({ exitCode: 1, reason: "no-city-visited" });
  });
});

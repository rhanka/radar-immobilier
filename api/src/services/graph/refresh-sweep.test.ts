import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  assessRefreshSweepHealth,
  classifyRefreshCityError,
  parseRefreshTarget,
  readRefreshSweepCursor,
  REFRESH_SWEEP_CURSOR_KEY,
  runRefreshSweep,
  writeRefreshSweepCursor,
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
    maxDocuments: 100,
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

  it("restarts the rotation when the cursor names a slug the list no longer has", async () => {
    const store = new MemoryStore();
    await writeRefreshSweepCursor(store, "retired-city", () => 0);
    const visited: string[] = [];
    await runRefreshSweep(options(store, {
      refreshCity: async (city) => { visited.push(city); return { status: "up-to-date" }; },
    }));

    expect(visited).toEqual(CITIES);
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

  it("stops on the document budget, which is what bounds the daily model spend", async () => {
    const store = new MemoryStore();
    const report = await runRefreshSweep(options(store, {
      maxDocuments: 2,
      refreshCity: async () => ({ status: "published" }),
    }));

    expect(report.documentsExtracted).toBe(2);
    expect(report.stoppedBy).toBe("document-budget");
    expect(report.counts.published).toBe(2);
    expect(report.visited).toBe(2);
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
      expect(report.counts).toEqual({ published: 1, "up-to-date": 0, "no-input": 1,
        "no-pdf": 0, "no-baseline": 1, failed: 1 });
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
    stoppedBy: "exhausted" as const, documentsExtracted: 0,
    counts: { published: 0, "up-to-date": 0, "no-input": 0, "no-pdf": 0, "no-baseline": 0,
      failed: 0, ...counts },
  });

  it("tolerates expected per-city refusals and fails only on a systemic rate", () => {
    // 93 of 528 cities had broken sources on the one measured whole-list sweep:
    // that MUST stay a healthy run.
    expect(assessRefreshSweepHealth(report({}, 528), 0.9)).toEqual({ exitCode: 0 });
    expect(assessRefreshSweepHealth(report({ failed: 100 }, 528), 0.9)).toEqual({ exitCode: 0 });
    expect(assessRefreshSweepHealth(report({ failed: 500 }, 528), 0.9))
      .toEqual({ exitCode: 1, reason: "systemic-city-failures" });
  });

  it("fails a run that visited nothing at all", () => {
    expect(assessRefreshSweepHealth(report({}, 0), 0.9))
      .toEqual({ exitCode: 1, reason: "no-city-visited" });
  });
});

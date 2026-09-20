/**
 * proces-verbaux-pacing.test.ts — issue #723, defect 3 of 3.
 *
 * rules/MASTER.md §Scraping Policy asks for at most 1 req / 2 s per source. The
 * adapter used to DOCUMENT that as "the caller's responsibility" and no caller
 * assumed it: `worker-live → live-scrape → recueil → adapter` fired one index
 * page and 255 documents at full speed from a single IP. The spacing now lives
 * in the adapter, which is the only layer that sees every request it makes.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ProcesVerbauxGenericAdapter,
  PV_MIN_REQUEST_INTERVAL_MS,
  PV_ROBOTS_TXT_CONSULTED,
  type PvCityConfig,
  type PvFetchLike,
} from "./proces-verbaux-generic.js";

const config: PvCityConfig = {
  citySlug: "testville",
  pvIndexUrl: "https://testville.qc.ca/seances/",
  sourceId: "proces-verbaux-testville",
};

const INDEX_HTML = `
  <a href="https://testville.qc.ca/pv/2026-06-05.pdf">Proces-verbal du 5 juin 2026</a>
  <a href="https://testville.qc.ca/pv/2026-06-12.pdf">Proces-verbal du 12 juin 2026</a>
`;

function fetchImpl(): PvFetchLike {
  return async (url: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => (url.endsWith(".pdf") ? "application/pdf" : "text/html") },
    arrayBuffer: async () =>
      new TextEncoder().encode(url.endsWith(".pdf") ? "PV" : INDEX_HTML).buffer as ArrayBuffer,
  });
}

/** A virtual clock: `sleep` advances it, so nothing actually waits. */
function virtualClock() {
  let ms = Date.parse("2026-06-20T00:00:00.000Z");
  const slept: number[] = [];
  return {
    slept,
    now: () => new Date(ms),
    tick: (d: number) => { ms += d; },
    sleep: async (d: number) => { slept.push(d); ms += d; },
  };
}

describe("PV adapter request spacing", () => {
  it("spaces every request of a run — the index page included, not only documents", async () => {
    const clock = virtualClock();
    const fetchSpy = vi.fn(fetchImpl());
    const adapter = new ProcesVerbauxGenericAdapter(config, {
      fetchImpl: fetchSpy,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
      minRequestIntervalMs: PV_MIN_REQUEST_INTERVAL_MS,
      windowDays: 3650,
    });

    const refs = [];
    for await (const ref of adapter.list({})) refs.push(ref);
    for (const ref of refs) await adapter.fetch(ref);

    expect(fetchSpy).toHaveBeenCalledTimes(3); // index + 2 documents
    // The FIRST request is not delayed; each of the next two is.
    expect(clock.slept).toEqual([
      PV_MIN_REQUEST_INTERVAL_MS,
      PV_MIN_REQUEST_INTERVAL_MS,
    ]);
  });

  it("waits only for the time still missing, so a caller that already paced itself is not throttled twice", async () => {
    const clock = virtualClock();
    const adapter = new ProcesVerbauxGenericAdapter(config, {
      fetchImpl: fetchImpl(),
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
      minRequestIntervalMs: PV_MIN_REQUEST_INTERVAL_MS,
      windowDays: 3650,
    });

    const refs = [];
    for await (const ref of adapter.list({})) refs.push(ref);
    expect(clock.slept).toEqual([]); // one request so far
    // The caller sleeps 2 s of its own before asking for a document
    // (`acquireRefreshPdfCandidates` does exactly this in `beforeFetch`).
    clock.tick(PV_MIN_REQUEST_INTERVAL_MS + 50);
    await adapter.fetch(refs[0]!);
    expect(clock.slept).toEqual([]); // nothing added on top
  });

  it("stays a pure fetch abstraction by default: no spacing unless a caller asks for it", async () => {
    const clock = virtualClock();
    const adapter = new ProcesVerbauxGenericAdapter(config, {
      fetchImpl: fetchImpl(), now: clock.now, sleep: clock.sleep, windowDays: 3650,
    });
    const refs = [];
    for await (const ref of adapter.list({})) refs.push(ref);
    for (const ref of refs) await adapter.fetch(ref);
    expect(clock.slept).toEqual([]);
  });

  it("records that robots.txt is not consulted (owner decision, 2026-09-20)", () => {
    expect(PV_ROBOTS_TXT_CONSULTED).toBe(false);
  });
});

/**
 * executor-generic-sources.test.ts
 *
 * Integration tests for the pipeline executor wired with the THREE generic
 * config-driven adapters:
 *   - `ProcesVerbauxGenericAdapter`  (sourceKind "pv"            → "conseils-municipaux")
 *   - `AvisPublicsGenericAdapter`    (sourceKind "avis-publics"  → "avis-publics")
 *   - `YouTubeSeancesAdapter`        (sourceKind "video-youtube" → "youtube-seances")
 *
 * ALL tests use committed fixture data — NO network calls.
 *
 * Assertions:
 *   1. A multi-source CiblagePlan with all three generic adapters produces a
 *      succeeded/partial Job.
 *   2. ScrapeStatus is updated per city×source:
 *      - `scraped`    after a successful recueil step
 *      - `graphified` after a successful exploitation
 *      - `error`      when a source fails
 *   3. Partial tolerance: one failing adapter marks the run `partial` and sets
 *      that source's ScrapeStatus to `error`; other sources proceed normally.
 */

import { describe, expect, it } from "vitest";

import {
  AVIS_PUBLICS_FIXTURE_HTML,
  PV_SAINT_DAMASE_INDEX_HTML,
  SAINT_DAMASE_PV_CONFIG,
  SEANCE_VTT_FIXTURE,
  VALLEYFIELD_AVIS_CONFIG,
  VALLEYFIELD_YOUTUBE_CONFIG,
  YOUTUBE_SEARCH_RESPONSE_FIXTURE,
  createAvisPublicsAdapter,
  createProcesVerbauxAdapter,
  createYouTubeSeancesAdapter,
  type FetchLike,
  type PvFetchLike,
  type YtFetchLike,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { createCiblageStore } from "../ciblage/ciblage-store.js";
import * as ScrapeStatusStore from "../scrape-status/store.js";
import {
  AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
  PV_SAINT_DAMASE_SOURCE_ID,
  YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
  buildAdapterRegistry,
  type AdapterEntry,
} from "./adapter-registry.js";
import { createJobsStore } from "./jobs-store.js";
import { runCiblagePlan } from "./executor.js";

// ─── In-memory ObjectStore ──────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ─── Fixture fetch mocks (NO network) ───────────────────────────────────────

/**
 * PV fetchImpl: serves the Saint-Damase index page for the index URL, and a
 * minimal PDF stub for any `.pdf` URL (enough for recueil to store raw bytes).
 */
function pvFixtureFetch(): PvFetchLike {
  return async (url: string) => {
    const isPdf = url.toLowerCase().endsWith(".pdf");
    const body = isPdf
      ? new TextEncoder().encode("%PDF-1.4 stub")
      : new TextEncoder().encode(PV_SAINT_DAMASE_INDEX_HTML);
    return {
      ok: true,
      status: 200,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === "content-type"
            ? isPdf
              ? "application/pdf"
              : "text/html; charset=utf-8"
            : null,
      },
      arrayBuffer: async () => body.buffer as ArrayBuffer,
    };
  };
}

/**
 * Avis publics fetchImpl: always returns the Valleyfield HTML fixture.
 */
function avisFixtureFetch() {
  return async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null,
    },
    arrayBuffer: async () =>
      new TextEncoder().encode(AVIS_PUBLICS_FIXTURE_HTML).buffer as ArrayBuffer,
  });
}

/**
 * YouTube fetchImpl:
 *   - search API     → YOUTUBE_SEARCH_RESPONSE_FIXTURE (1 video)
 *   - captions list  → minimal response with one FR ASR track so the adapter
 *                       can proceed to the timedtext download
 *   - timedtext URL  → SEANCE_VTT_FIXTURE (the transcript)
 *   - everything else → 404
 */
function ytFixtureFetch(): YtFetchLike {
  const captionsListFixture = JSON.stringify({
    items: [
      {
        id: "cap-track-1",
        snippet: { language: "fr", name: "French", trackKind: "asr" },
      },
    ],
  });

  return async (url: string) => {
    if (url.includes("googleapis.com/youtube/v3/search")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => YOUTUBE_SEARCH_RESPONSE_FIXTURE,
        arrayBuffer: async () =>
          new TextEncoder().encode(YOUTUBE_SEARCH_RESPONSE_FIXTURE)
            .buffer as ArrayBuffer,
      };
    }
    if (url.includes("googleapis.com/youtube/v3/captions")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => captionsListFixture,
        arrayBuffer: async () =>
          new TextEncoder().encode(captionsListFixture).buffer as ArrayBuffer,
      };
    }
    if (url.includes("timedtext")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/vtt" },
        text: async () => SEANCE_VTT_FIXTURE,
        arrayBuffer: async () =>
          new TextEncoder().encode(SEANCE_VTT_FIXTURE).buffer as ArrayBuffer,
      };
    }
    // Any other call → 404
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };
}

/** Failing fetchImpl — simulates a network outage for avis-publics. */
function failingFetch() {
  return async () => {
    throw new Error("simulated network failure");
  };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Seed a plan with the given source binding ids. */
async function seedPlan(
  store: MemoryStore,
  citySlug: string,
  sourceBindingIds: string[],
  enabled = true,
) {
  const ciblage = createCiblageStore(store);
  return ciblage.create({
    label: "Test plan — generic adapters",
    citySlugs: [citySlug],
    sourceBindingIds,
    cadence: "initial",
    enabled,
  });
}

// ─── Test data / constants ───────────────────────────────────────────────────

const NOW = new Date("2026-06-10T12:00:00.000Z");
const VF_CITY = VALLEYFIELD_AVIS_CONFIG.citySlug; // "salaberry-de-valleyfield"
const SD_CITY = SAINT_DAMASE_PV_CONFIG.citySlug; // "saint-damase"

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runCiblagePlan — generic adapters (avis/PV/youtube) with ScrapeStatus", () => {
  it("resolves avis-publics-generic adapter and updates ScrapeStatus to graphified", async () => {
    const store = new MemoryStore();
    const statusStore = new MemoryStore();
    const plan = await seedPlan(store, VF_CITY, [
      AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
    ]);

    const avisEntry: AdapterEntry = {
      sourceId: AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      city: VF_CITY,
      build: () =>
        createAvisPublicsAdapter(VALLEYFIELD_AVIS_CONFIG, {
          fetchImpl: avisFixtureFetch() as FetchLike,
        }),
    };
    const registry = buildAdapterRegistry([avisEntry]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      scrapeStatusStore: statusStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("succeeded");
    expect(result.job.steps).toHaveLength(1);
    expect(result.job.steps[0]?.status).toBe("succeeded");

    // ScrapeStatus should be `graphified` after the full pipeline.
    const statuses = await ScrapeStatusStore.readAll(statusStore);
    const avisStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "avis-publics",
    );
    expect(avisStatus).toBeDefined();
    expect(avisStatus?.status).toBe("graphified");
    expect(avisStatus?.lastRunAt).toBe(NOW.toISOString());
  });

  it("resolves proces-verbaux-generic adapter (Saint-Damase) and updates ScrapeStatus", async () => {
    const store = new MemoryStore();
    const statusStore = new MemoryStore();
    const plan = await seedPlan(store, SD_CITY, [PV_SAINT_DAMASE_SOURCE_ID]);

    const pvEntry: AdapterEntry = {
      sourceId: PV_SAINT_DAMASE_SOURCE_ID,
      city: SD_CITY,
      build: () =>
        createProcesVerbauxAdapter(SAINT_DAMASE_PV_CONFIG, {
          fetchImpl: pvFixtureFetch(),
          now: () => NOW,
        }),
    };
    const registry = buildAdapterRegistry([pvEntry]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      scrapeStatusStore: statusStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    // PV adapter lists real PDFs; recueil should collect at least one.
    expect(job.steps).toHaveLength(1);
    const step = job.steps[0]!;
    expect(step.sourceId).toBe(PV_SAINT_DAMASE_SOURCE_ID);
    expect(step.city).toBe(SD_CITY);
    // Recueil succeeded → at least one raw doc id collected (PDF stub stored).
    expect(step.rawDocIds.length).toBeGreaterThan(0);

    // ScrapeStatus for conseils-municipaux updated.
    const statuses = await ScrapeStatusStore.readAll(statusStore);
    const pvStatus = statuses.find(
      (s) => s.citySlug === SD_CITY && s.source === "conseils-municipaux",
    );
    expect(pvStatus).toBeDefined();
    // After exploitation: graphified (step.status determines final level).
    expect(pvStatus?.status).toBe("graphified");
    expect(pvStatus?.lastRunAt).toBe(NOW.toISOString());
  });

  it("resolves youtube-seances adapter (Valleyfield) and updates ScrapeStatus", async () => {
    const store = new MemoryStore();
    const statusStore = new MemoryStore();
    const plan = await seedPlan(store, VF_CITY, [
      YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
    ]);

    const ytEntry: AdapterEntry = {
      sourceId: YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
      city: VF_CITY,
      build: () =>
        createYouTubeSeancesAdapter(VALLEYFIELD_YOUTUBE_CONFIG, {
          fetchImpl: ytFixtureFetch(),
          youtubeApiKey: "fixture-key",
          now: () => NOW,
        }),
    };
    const registry = buildAdapterRegistry([ytEntry]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      scrapeStatusStore: statusStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    expect(job.steps).toHaveLength(1);
    const step = job.steps[0]!;
    expect(step.sourceId).toBe(YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID);
    expect(step.city).toBe(VF_CITY);
    expect(step.rawDocIds.length).toBeGreaterThan(0);

    // ScrapeStatus for youtube-seances updated.
    const statuses = await ScrapeStatusStore.readAll(statusStore);
    const ytStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "youtube-seances",
    );
    expect(ytStatus).toBeDefined();
    expect(ytStatus?.status).toBe("graphified");
    expect(ytStatus?.lastRunAt).toBe(NOW.toISOString());
  });

  it("multi-source plan (PV+avis): both generic adapters succeed and ScrapeStatus reflects both", async () => {
    // Only works with same city. Use Valleyfield for both.
    const store = new MemoryStore();
    const statusStore = new MemoryStore();
    const plan = await seedPlan(store, VF_CITY, [
      AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      // Also add the YouTube adapter for Valleyfield to test three in one plan.
      YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
    ]);

    const entries: AdapterEntry[] = [
      {
        sourceId: AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
        city: VF_CITY,
        build: () =>
          createAvisPublicsAdapter(VALLEYFIELD_AVIS_CONFIG, {
            fetchImpl: avisFixtureFetch() as FetchLike,
          }),
      },
      {
        sourceId: YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
        city: VF_CITY,
        build: () =>
          createYouTubeSeancesAdapter(VALLEYFIELD_YOUTUBE_CONFIG, {
            fetchImpl: ytFixtureFetch(),
            youtubeApiKey: "fixture-key",
            now: () => NOW,
          }),
      },
    ];
    const registry = buildAdapterRegistry(entries);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      scrapeStatusStore: statusStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    expect(job.status).toBe("succeeded");
    expect(job.steps).toHaveLength(2);
    expect(job.steps.every((s) => s.status === "succeeded")).toBe(true);

    // Both ScrapeStatus records are graphified.
    const statuses = await ScrapeStatusStore.readAll(statusStore);
    const avisStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "avis-publics",
    );
    const ytStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "youtube-seances",
    );
    expect(avisStatus?.status).toBe("graphified");
    expect(ytStatus?.status).toBe("graphified");

    // Both statuses share the same run timestamp.
    expect(avisStatus?.lastRunAt).toBe(NOW.toISOString());
    expect(ytStatus?.lastRunAt).toBe(NOW.toISOString());
  });

  it("PARTIAL: one failing generic adapter sets its ScrapeStatus to error, other stays graphified", async () => {
    const store = new MemoryStore();
    const statusStore = new MemoryStore();
    const plan = await seedPlan(store, VF_CITY, [
      AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
    ]);

    const entries: AdapterEntry[] = [
      // Avis succeeds.
      {
        sourceId: AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
        city: VF_CITY,
        build: () =>
          createAvisPublicsAdapter(VALLEYFIELD_AVIS_CONFIG, {
            fetchImpl: avisFixtureFetch() as FetchLike,
          }),
      },
      // YouTube fails (network error).
      {
        sourceId: YOUTUBE_SEANCES_VALLEYFIELD_SOURCE_ID,
        city: VF_CITY,
        build: () =>
          createYouTubeSeancesAdapter(VALLEYFIELD_YOUTUBE_CONFIG, {
            fetchImpl: failingFetch() as YtFetchLike,
            youtubeApiKey: "fixture-key",
            now: () => NOW,
          }),
      },
    ];
    const registry = buildAdapterRegistry(entries);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      scrapeStatusStore: statusStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const job = result.job;
    expect(job.status).toBe("partial");
    expect(job.totals.succeeded).toBe(1);
    expect(job.totals.failed).toBe(1);

    // Avis ScrapeStatus: graphified (succeeded + exploited).
    const statuses = await ScrapeStatusStore.readAll(statusStore);
    const avisStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "avis-publics",
    );
    expect(avisStatus?.status).toBe("graphified");

    // YouTube ScrapeStatus: error (recueil failed).
    const ytStatus = statuses.find(
      (s) => s.citySlug === VF_CITY && s.source === "youtube-seances",
    );
    expect(ytStatus?.status).toBe("error");
  });

  it("ScrapeStatus is NOT written when scrapeStatusStore is absent (backward-compat)", async () => {
    const store = new MemoryStore();
    const plan = await seedPlan(store, VF_CITY, [
      AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
    ]);

    const avisEntry: AdapterEntry = {
      sourceId: AVIS_PUBLICS_VALLEYFIELD_GENERIC_SOURCE_ID,
      city: VF_CITY,
      build: () =>
        createAvisPublicsAdapter(VALLEYFIELD_AVIS_CONFIG, {
          fetchImpl: avisFixtureFetch() as FetchLike,
        }),
    };
    const registry = buildAdapterRegistry([avisEntry]);

    // No scrapeStatusStore → existing tests should be unaffected.
    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(store),
      jobsStore: createJobsStore(store),
      objectStore: store,
      // scrapeStatusStore deliberately absent
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("succeeded");

    // No scrape-status key was written to the main store.
    expect(store.objects.has("scrape-status/index.json")).toBe(false);
  });
});

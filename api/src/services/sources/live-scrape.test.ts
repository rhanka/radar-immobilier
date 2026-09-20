/**
 * live-scrape.test.ts — WORKER LIVE (SPEC_PERSISTENCE_S3_FIRST §3): the
 * orchestration entry point that scrapes the **config-only** PV cities live and
 * writes them to the scraping object store (SCW in prod, MinIO locally).
 *
 * `runLiveScrape(citySlugs?, { store, fetch, limit })`:
 *   - for each PvCityEntry config (or the requested subset) it instantiates the
 *     generic PV adapter with the injected `fetch`, then calls
 *     `runRecueilWithManifest` → CAS bytes + sidecar meta.json + run manifest.
 *   - idempotent (HEAD-skip handled by RECUEIL): a re-run on identical bytes is
 *     reported `seen`, not `new`, and writes no new CAS object.
 *   - never throws on a source failure: a fetch error becomes a per-city
 *     `status: "error"` recap entry.
 *
 * No real network: the adapter's `fetch` is injected (PvFetchLike). Storage is
 * an in-memory MemoryStore (patron recueil.test.ts).
 */
import { describe, expect, it, vi } from "vitest";

import {
  ALL_PV_CITIES,
  buildRawDocumentRecord,
  PV_SAINT_DAMASE_2025_05_POSITIVE,
  rawMetaKey,
  type PdfToText,
  type PvFetchLike,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { projectStateKey } from "../exploitation/project-state.js";
import { collectedUrlsKey } from "./known-urls.js";
import { citiesChunk, configOnlyCitySlugs, runLiveScrape } from "./live-scrape.js";
import { recueilMetrics, recueilMetricsJson, resetRecueilMetrics } from "./recueil.js";
import { assessJobHealth } from "../../scripts/job-health.js";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory object store (patron recueil.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  putCount = 0;
  /** When set, every `put` under this prefix throws (storage-failure double). */
  failPutPrefix: string | undefined;
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    if (this.failPutPrefix !== undefined && key.startsWith(this.failPutPrefix)) {
      throw new Error(`storage unavailable for ${key}`);
    }
    this.putCount += 1;
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
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
  // `list` is required by the REEXPLOIT path (loadScrapedPvRecords lists the
  // per-city CAS prefix for `*.meta.json` sidecars).
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake fetch: serves a minimal PV index page that links one PDF, then the PDF.
// Drives the REAL ProcesVerbauxGenericAdapter without any network.
// ─────────────────────────────────────────────────────────────────────────────

/** A recent date inside the 6-month window so the PV is not filtered out. */
const RECENT_DATE = "2026-06-05";

function htmlResponse(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  };
}

function pdfResponse(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === "content-type" ? "application/pdf" : null,
    },
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  };
}

/**
 * Build a fake fetch keyed on the index URL of the requested cities. The index
 * page links a single PV PDF dated within the window; the PDF URL serves bytes.
 */
function makeFakeFetch(
  indexUrlByPdf: Map<string, string>,
  pdfBody: string,
): PvFetchLike {
  return async (url: string) => {
    // PV PDF download.
    if (url.toLowerCase().endsWith(".pdf")) {
      return pdfResponse(pdfBody) as Awaited<ReturnType<PvFetchLike>>;
    }
    // Index page: emit an anchor to the per-index PV PDF with a dated label.
    const pdf = indexUrlByPdf.get(url);
    if (!pdf) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Awaited<ReturnType<PvFetchLike>>;
    }
    const html = `<!doctype html><html><body>
      <a href="${pdf}">Procès-verbal du ${RECENT_DATE}</a>
    </body></html>`;
    return htmlResponse(html) as Awaited<ReturnType<PvFetchLike>>;
  };
}

/** First N config-only cities (config-only ⇒ no pvText). */
function configOnlySlugs(n: number): string[] {
  return ALL_PV_CITIES.filter((c) => !c.pvText)
    .slice(0, n)
    .map((c) => c.config.citySlug);
}

/** Build a fake fetch that serves a dated PV PDF for the given city slugs. */
function fakeFetchForSlugs(slugs: readonly string[], pdfBody: string): PvFetchLike {
  const map = new Map<string, string>();
  for (const slug of slugs) {
    const entry = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!;
    const base = new URL(entry.config.pvIndexUrl).origin;
    map.set(entry.config.pvIndexUrl, `${base}/pv/${slug}-${RECENT_DATE}.pdf`);
  }
  return makeFakeFetch(map, pdfBody);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runLiveScrape — config-only PV cities → object store", () => {
  // An INDEX 404 is the only 404 that still costs the city. The DOCUMENT 404 of
  // the same shape is now a hole in an otherwise successful run (issue #723) —
  // see "a dead document link" below for the measured drummondville shape.
  it("should preserve index 404 diagnostics through RECUEIL, metrics and onCity", async () => {
    resetRecueilMetrics();
    const city = "drummondville";
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === city)!.config;
    const onCity = vi.fn();
    const onRequest = vi.fn();
    const recap = await runLiveScrape([city], {
      store: new MemoryStore(), onCity, onRequest,
      now: () => new Date("2026-06-10T00:00:00Z"),
      fetch: async () => ({
        ok: false, status: 404,
        headers: new Headers({ server: "cloudflare", "cf-ray": "ray", authorization: "SECRET" }),
        arrayBuffer: async () => { throw new Error("Must not read error bodies"); },
      }),
    });
    expect(recap[0]).toMatchObject({ city, status: "error", error: "[http] HTTP 404", fetchFailure: {
      url: config.pvIndexUrl,
      phase: "index", httpStatus: 404, durationMs: 0, headers: { server: "cloudflare", "cf-ray": "ray" },
    } });
    expect(onCity).toHaveBeenCalledExactlyOnceWith(recap[0]);
    expect(onRequest).toHaveBeenLastCalledWith({ city, ...recap[0]!.fetchFailure });
    expect(recueilMetrics()).toMatchObject({ index404: 1, document404: 0 });
    expect(JSON.parse(recueilMetricsJson())).toEqual(recueilMetrics());
    expect(JSON.stringify([recap, onRequest.mock.calls, onCity.mock.calls])).not.toContain("SECRET");
    const health = assessJobHealth({
      cityCount: 528, errorCount: 1, maxErrorRate: 0.9, elevatedWarnRate: 0.5,
      exploitRequested: false, feedExpected: false, upserted: 0, pdftotextAvailable: true,
      index404Cities: recap.filter((r) => r.fetchFailure?.phase === "index" && r.fetchFailure.httpStatus === 404).map((r) => r.city),
    });
    expect(health.warn).toBe("elevated");
    expect(health.reason).toContain(city);
    resetRecueilMetrics();
    expect(recueilMetrics()).toMatchObject({ index404: 0, document404: 0 });
  });

  // THE defect of issue #723, at the orchestration layer: the city's index
  // answers, two documents are collected, the third is a dead link. Before, the
  // city came back `error, docs=0` and its two CAS objects were orphaned.
  it("should keep a city whose index answers when ONE document 404s, and name the dead URL", async () => {
    resetRecueilMetrics();
    const city = "drummondville";
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === city)!.config;
    const base = new URL(config.pvIndexUrl).origin;
    const dead = `${base}/wp-content/uploads/2015/10/Proces_verbal_2016_01_18.pdf`;
    const alive = [`${base}/pv/2026-06-05.pdf`, `${base}/pv/2026-06-12.pdf`];
    const onCity = vi.fn();
    const store = new MemoryStore();
    const recap = await runLiveScrape([city], {
      store, onCity, onRequest: () => {},
      now: () => new Date("2026-06-20T00:00:00Z"),
      // The dead link is listed LAST, exactly like the measured rank 253/255.
      fetch: async (url) => {
        if (url === config.pvIndexUrl) {
          return htmlResponse(
            [...alive, dead]
              .map((u) => `<a href="${u}">Procès-verbal du 2026-06-05</a>`)
              .join(""),
          ) as Awaited<ReturnType<PvFetchLike>>;
        }
        if (url === dead) {
          return {
            ok: false, status: 404,
            headers: new Headers({ server: "cloudflare", "content-type": "text/html" }),
            arrayBuffer: async () => { throw new Error("Must not read error bodies"); },
          } as Awaited<ReturnType<PvFetchLike>>;
        }
        return pdfResponse(`PV bytes ${url}`) as Awaited<ReturnType<PvFetchLike>>;
      },
    });

    const entry = recap[0]!;
    expect(entry.status).toBe("new");
    expect(entry.count).toBe(2);
    expect(entry.casKeys).toHaveLength(2);
    expect(entry.failedDocs).toBe(1);
    expect(entry.documentFailures).toEqual([
      { url: dead, phase: "document", error: "http", detail: "HTTP 404", httpStatus: 404 },
    ]);
    // The run is COMMITTED: a manifest references the two collected documents.
    const manifests = [...store.objects.keys()].filter((k) => k.endsWith("manifest.jsonl"));
    expect(manifests).toHaveLength(1);
    // The 404 is counted on the document axis, so job-health does not read it
    // as a lost index and the city is not in the error set.
    expect(recueilMetrics()).toMatchObject({ index404: 0, document404: 1 });
    expect(recap.filter((r) => r.status === "error")).toHaveLength(0);
    resetRecueilMetrics();
  });

  // The owner's requirement of 2026-09-20, in one test: CHECK every 24 h,
  // do not re-download.
  it("should re-read the index but skip a document the previous run already collected", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetched: string[] = [];
    const base = fakeFetchForSlugs(slugs, "PV bytes — identical");
    const fetch: PvFetchLike = async (url, init) => {
      fetched.push(url);
      return base(url, init);
    };

    const first = await runLiveScrape(slugs, { store, fetch, skipAlreadyCollectedUrls: true });
    expect(first[0]!.count).toBe(1);
    const afterFirst = [...fetched];
    expect(afterFirst.filter((u) => u.endsWith(".pdf"))).toHaveLength(1);

    fetched.length = 0;
    const second = await runLiveScrape(slugs, { store, fetch, skipAlreadyCollectedUrls: true });
    // The INDEX was read again — that is the daily check, and it is not skipped.
    expect(fetched).toContain(
      ALL_PV_CITIES.find((c) => c.config.citySlug === slugs[0])!.config.pvIndexUrl,
    );
    // The document was NOT downloaded again.
    expect(fetched.filter((u) => u.endsWith(".pdf"))).toHaveLength(0);
    expect(second[0]!.status).toBe("seen");
    expect(second[0]!.count).toBe(0);
  });

  it("should still download a document that is NEW in the index on the next run", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    let listed = [`${origin}/pv/${slug}-2026-06-05.pdf`];
    const fetch: PvFetchLike = async (url) => {
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed.map((u) => `<a href="${u}">Procès-verbal du 2026-06-05</a>`).join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      return pdfResponse(`bytes for ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    await runLiveScrape([slug], { store, fetch, skipAlreadyCollectedUrls: true,
      now: () => new Date("2026-06-20T00:00:00Z") });

    // A new PV appears in the index the next night.
    listed = [...listed, `${origin}/pv/${slug}-2026-06-12.pdf`];
    const second = await runLiveScrape([slug], { store, fetch, skipAlreadyCollectedUrls: true,
      now: () => new Date("2026-06-21T00:00:00Z") });
    expect(second[0]!.count).toBe(1);
    expect(second[0]!.status).toBe("new");
    expect(second[0]!.casKeys).toHaveLength(1);
  });

  it("is OFF by default, so an explicit caller still gets the whole window", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — identical");
    await runLiveScrape(slugs, { store, fetch });
    // No `skipAlreadyCollectedUrls`: a backfill or a repair run re-collects.
    const second = await runLiveScrape(slugs, { store, fetch });
    expect(second[0]!.count).toBe(1);
    expect(second[0]!.status).toBe("seen");
    expect(second[0]!.skippedKnown).toBeUndefined();
  });

  // THREE passes, not two. Two passes cannot show the defect both contradictory
  // reviews of PR #735 found: the guard read only the LAST run's manifest, and a
  // manifest lists only what THAT run collected. A quiet night writes an empty
  // one, so the night after has nothing to skip and the whole back catalogue
  // comes down again — the steady state oscillates between 0 and N downloads
  // instead of settling on 0.
  it("keeps its memory across THREE runs: a quiet night must not re-arm the download", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    const listed = [
      `${origin}/pv/${slug}-2026-06-05.pdf`,
      `${origin}/pv/${slug}-2026-06-12.pdf`,
    ];
    // EVERY request the adapter makes goes through this double, whatever its
    // method — so `requests` also proves that a known URL costs no HEAD either.
    const requests: string[] = [];
    const downloads: string[] = [];
    const fetch: PvFetchLike = async (url) => {
      requests.push(url);
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed.map((u) => `<a href="${u}">Procès-verbal du 2026-06-12</a>`).join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      downloads.push(url);
      return pdfResponse(`bytes for ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    const night = (day: number) => {
      requests.length = 0;
      downloads.length = 0;
      return runLiveScrape([slug], {
        store, fetch, skipAlreadyCollectedUrls: true,
        now: () => new Date(`2026-06-${day}T00:00:00Z`),
      });
    };

    await night(20);
    expect(downloads).toHaveLength(2);

    const second = await night(21);
    expect(downloads).toEqual([]);
    expect(second[0]!.count).toBe(0);
    expect(second[0]!.skippedKnown).toBe(2);
    // ONE request for the whole city: the index page. A URL already collected is
    // skipped outright — no GET, and no HEAD to ask whether it changed (owner,
    // 2026-09-20: a published procès-verbal does not change).
    expect(requests).toEqual([config.pvIndexUrl]);

    // THE assertion: the third night is still quiet. A guard that remembers only
    // the previous run re-downloads both documents here.
    const third = await night(22);
    expect(downloads).toEqual([]);
    expect(third[0]!.count).toBe(0);
    expect(requests).toEqual([config.pvIndexUrl]);

    // And a fourth, because an oscillation of period 2 would pass at three.
    await night(23);
    expect(downloads).toEqual([]);
    expect(requests).toEqual([config.pvIndexUrl]);
  });

  // A PARTIAL night is the same defect with one document in it: the manifest of
  // a night that collected only the new PV listed only that PV, so the night
  // after forgot every other one.
  it("keeps its memory when a run collects only SOME documents", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    let listed = [
      `${origin}/pv/${slug}-2026-06-05.pdf`,
      `${origin}/pv/${slug}-2026-06-12.pdf`,
    ];
    const downloads: string[] = [];
    const fetch: PvFetchLike = async (url) => {
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed.map((u) => `<a href="${u}">Procès-verbal du 2026-06-12</a>`).join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      downloads.push(url);
      return pdfResponse(`bytes for ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    const night = (day: number) =>
      runLiveScrape([slug], {
        store, fetch, skipAlreadyCollectedUrls: true,
        now: () => new Date(`2026-06-${day}T00:00:00Z`),
      });

    await night(20);
    expect(downloads).toHaveLength(2);

    // A new PV appears: only it is downloaded.
    const fresh = `${origin}/pv/${slug}-2026-06-19.pdf`;
    listed = [...listed, fresh];
    downloads.length = 0;
    const second = await night(21);
    expect(downloads).toEqual([fresh]);
    expect(second[0]!.count).toBe(1);

    // The night after must remember ALL THREE, not just the one the partial
    // manifest recorded.
    downloads.length = 0;
    const third = await night(22);
    expect(downloads).toEqual([]);
    expect(third[0]!.count).toBe(0);
  });

  // #723 IN ITS EXACT SHAPE, UNDER THE GUARD. The dead link carries no date, so
  // `filterPvByWindow` keeps it for ever and every run retries it. On a quiet
  // night the guard skips every healthy document, so the run collects NOTHING
  // and the only thing it attempted failed — which the "zero harvest + one
  // failure ⇒ the source failed" rule would read as a lost city, every night,
  // for as long as the dead link stays in the index. That is the symptom this
  // whole branch exists to remove.
  it("does not lose a city to a dead undated link on a night where everything else was skipped", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    const alive = [`${origin}/pv/${slug}-2026-06-05.pdf`, `${origin}/pv/${slug}-2026-06-12.pdf`];
    // No date anywhere: neither the label nor the file name. Kept by the window
    // whatever the window, exactly like drummondville's "Ordre du jour" links.
    const dead = `${origin}/wp-content/uploads/ordrejour.pdf`;
    let listed = [...alive];
    const fetch: PvFetchLike = async (url) => {
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed
            .map((u) => `<a href="${u}">${u === dead ? "Ordre du jour" : "Procès-verbal du 2026-06-12"}</a>`)
            .join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      if (url === dead) {
        return {
          ok: false, status: 404,
          headers: new Headers({ "content-type": "text/html" }),
          arrayBuffer: async () => { throw new Error("Must not read error bodies"); },
        } as Awaited<ReturnType<PvFetchLike>>;
      }
      return pdfResponse(`bytes for ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    const night = (day: number) =>
      runLiveScrape([slug], {
        store, fetch, skipAlreadyCollectedUrls: true,
        now: () => new Date(`2026-06-${day}T00:00:00Z`),
      });

    const first = await night(20);
    expect(first[0]!.count).toBe(2);

    // The dead link appears; both healthy documents are already known.
    listed = [...alive, dead];
    const second = await night(21);
    expect(second[0]!.status).not.toBe("error");
    expect(second[0]!.count).toBe(0);
    expect(second[0]!.failedDocs).toBe(1);
    expect(second[0]!.skippedKnown).toBe(2);
    expect(second[0]!.documentFailures?.[0]?.url).toBe(dead);
  });

  // A run that fails to persist its guard state must not fail the city: the
  // consequence is a re-download on the next run, never a lost document.
  it("still reports the city when the guard state cannot be written", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const sourceId = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config.sourceId;
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs([slug], "PV bytes — unwritable guard");
    store.failPutPrefix = collectedUrlsKey(sourceId);
    const recap = await runLiveScrape([slug], { store, fetch, skipAlreadyCollectedUrls: true });
    expect(recap[0]!.status).toBe("new");
    expect(recap[0]!.count).toBe(1);
    expect(store.objects.has(collectedUrlsKey(sourceId))).toBe(false);
  });

  it("scrapes a subset of cities and writes CAS + meta + run manifest, reporting new", async () => {
    const slugs = configOnlySlugs(2);
    expect(slugs.length).toBe(2);

    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — séance ordinaire");

    const recap = await runLiveScrape(slugs, { store, fetch });

    // One recap entry per requested city.
    expect(recap.map((r) => r.city).sort()).toEqual([...slugs].sort());

    for (const slug of slugs) {
      const entry = recap.find((r) => r.city === slug)!;
      expect(entry.status).toBe("new");
      expect(entry.casKeys.length).toBeGreaterThan(0);
      // The CAS object the recap references actually exists in the store.
      for (const k of entry.casKeys) {
        expect(store.objects.has(k)).toBe(true);
      }
      // A run manifest was written for this city's source.
      const matching = [...store.objects.keys()].filter(
        (k) => k.startsWith(`runs/${entry.sourceId}/`) && k.endsWith("manifest.jsonl"),
      );
      expect(matching.length).toBe(1);
    }
  });

  it("is idempotent: a second identical run is HEAD-skipped → status seen, no new CAS object", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — identical");

    const first = await runLiveScrape(slugs, { store, fetch });
    expect(first[0]!.status).toBe("new");

    const casKeysAfterFirst = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );

    const second = await runLiveScrape(slugs, { store, fetch });
    expect(second[0]!.status).toBe("seen");

    const casKeysAfterSecond = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );
    // No NEW raw/cas object on the second run (idempotent dedup).
    expect(casKeysAfterSecond.sort()).toEqual(casKeysAfterFirst.sort());
  });

  it("never throws on a source failure: a fetch error becomes status error", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    // Fetch that always 500s (the index page is unreachable).
    const failing: PvFetchLike = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const recap = await runLiveScrape(slugs, { store, fetch: failing });
    expect(recap).toHaveLength(1);
    expect(recap[0]!.status).toBe("error");
    expect(recap[0]!.casKeys).toEqual([]);
    expect(recap[0]!.error).toBeDefined();
  });

  it("defaults to ALL config-only cities when no slugs are given", async () => {
    const all = configOnlySlugs(Number.POSITIVE_INFINITY);
    const store = new MemoryStore();
    // Serve every config-only city's index → one PV each.
    const fetch = fakeFetchForSlugs(all, "PV bytes — default-all");

    // limit:0 would scrape nothing; we just assert the city coverage of the recap.
    const recap = await runLiveScrape(undefined, { store, fetch });
    expect(recap.map((r) => r.city).sort()).toEqual([...all].sort());
    // Every entry is a real outcome (new or error), never undefined.
    for (const r of recap) {
      expect(["new", "seen", "error"]).toContain(r.status);
    }
  });

  it("honours a per-city limit on the number of docs collected", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — limit");

    const recap = await runLiveScrape(slugs, { store, fetch, limit: 1 });
    expect(recap[0]!.status).toBe("new");
    // With one PDF per index and limit 1, exactly one CAS object is collected.
    expect(recap[0]!.casKeys).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPLOITATION on live scrape: `exploit: true` runs PARSE + projects real
// signals into the per-city project-state (the key the Signaux view reads).
// ─────────────────────────────────────────────────────────────────────────────

describe("runLiveScrape — exploit: true (PARSE + signaux réels)", () => {
  /** pdftotext mock: any PV PDF → the real Saint-Damase positive text (38-41). */
  const pdfToText: PdfToText = async () => PV_SAINT_DAMASE_2025_05_POSITIVE;

  it("scrape + exploite -> 1 signal projeté + project-state écrit", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — séance avec zonage");

    const recap = await runLiveScrape(slugs, {
      store,
      fetch,
      exploit: true,
      pdfToText,
    });

    const entry = recap[0]!;
    expect(entry.status).toBe("new");
    // The real DesignationEvent (règlement 38-41) was detected and projected.
    expect(entry.signals).toBe(1);
    expect(entry.exploitError).toBeUndefined();
    // The Signaux view reads exactly this key.
    expect(store.objects.has(projectStateKey(entry.city))).toBe(true);
  });

  // The guard removes already-collected documents from `outcome.records`;
  // EXPLOITATION used to rebuild the whole project-state from THAT array and PUT
  // it over the city's key. A night with nothing new therefore rewrote the city
  // from zero documents and erased its signals. Both deployed Jobs set
  // LIVE_SCRAPE_EXPLOIT=1, and this is the key the Signaux view reads.
  it("does not rewrite a city's project-state from a quiet night's zero documents", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    const listed = [`${origin}/pv/${slug}-2026-06-05.pdf`];
    const fetch: PvFetchLike = async (url) => {
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed.map((u) => `<a href="${u}">Procès-verbal du 2026-06-05</a>`).join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      return pdfResponse(`PV bytes — ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    const night = (day: number) =>
      runLiveScrape([slug], {
        store, fetch, exploit: true, pdfToText, skipAlreadyCollectedUrls: true,
        now: () => new Date(`2026-06-${day}T00:00:00Z`),
      });

    const first = await night(20);
    expect(first[0]!.signals).toBe(1);
    const stateAfterFirst = JSON.parse(
      new TextDecoder().decode(store.objects.get(projectStateKey(slug))!),
    ) as { rawRefs: string[]; canonicals: { type: string }[] };
    expect(stateAfterFirst.rawRefs.length).toBeGreaterThan(0);

    // Quiet night: the guard skips the one known document, so the run collects
    // nothing. The city's signals must survive it BYTE FOR BYTE — exploitation
    // is not re-run, so the state is not even rewritten with the same content.
    const bytesAfterFirst = store.objects.get(projectStateKey(slug))!;
    const second = await night(21);
    expect(second[0]!.count).toBe(0);
    const stateAfterSecond = JSON.parse(
      new TextDecoder().decode(store.objects.get(projectStateKey(slug))!),
    ) as { rawRefs: string[]; canonicals: { type: string }[] };
    expect(stateAfterSecond.rawRefs).toEqual(stateAfterFirst.rawRefs);
    expect(
      stateAfterSecond.canonicals.filter((c) => c.type === "DesignationEvent"),
    ).toHaveLength(1);
    expect(store.objects.get(projectStateKey(slug))).toEqual(bytesAfterFirst);
    // `undefined`, not `0`: the recap says "not re-derived", which is not the
    // same claim as "this city has no signals".
    expect(second[0]!.signals).toBeUndefined();
  });

  // A night that DOES bring a new document must re-derive the state from the
  // whole stored corpus, not from the one document it just downloaded — that is
  // the other half of the same defect.
  it("re-derives a city's state from its whole corpus when something new arrives", async () => {
    const slug = configOnlySlugs(1)[0]!;
    const config = ALL_PV_CITIES.find((c) => c.config.citySlug === slug)!.config;
    const origin = new URL(config.pvIndexUrl).origin;
    const store = new MemoryStore();
    let listed = [`${origin}/pv/${slug}-2026-06-05.pdf`];
    const fetch: PvFetchLike = async (url) => {
      if (url === config.pvIndexUrl) {
        return htmlResponse(
          listed.map((u) => `<a href="${u}">Procès-verbal du 2026-06-05</a>`).join(""),
        ) as Awaited<ReturnType<PvFetchLike>>;
      }
      return pdfResponse(`PV bytes — ${url}`) as Awaited<ReturnType<PvFetchLike>>;
    };
    // Each PV must extract to DIFFERENT text, otherwise the two documents share
    // one content-addressed text key and the corpus is genuinely of size one.
    const perDocText: PdfToText = async (bytes) =>
      `${PV_SAINT_DAMASE_2025_05_POSITIVE}\n${new TextDecoder().decode(bytes)}`;
    const night = (day: number) =>
      runLiveScrape([slug], {
        store, fetch, exploit: true, pdfToText: perDocText, skipAlreadyCollectedUrls: true,
        now: () => new Date(`2026-06-${day}T00:00:00Z`),
      });

    await night(20);
    const firstRefs = (JSON.parse(
      new TextDecoder().decode(store.objects.get(projectStateKey(slug))!),
    ) as { rawRefs: string[] }).rawRefs;
    expect(firstRefs).toHaveLength(1);

    listed = [...listed, `${origin}/pv/${slug}-2026-06-12.pdf`];
    const second = await night(21);
    expect(second[0]!.count).toBe(1);
    const secondRefs = (JSON.parse(
      new TextDecoder().decode(store.objects.get(projectStateKey(slug))!),
    ) as { rawRefs: string[] }).rawRefs;
    // TWO, not one: the older PV is still in the city's state.
    expect(secondRefs).toHaveLength(2);
    expect(secondRefs).toEqual(expect.arrayContaining(firstRefs));
  });

  it("sans exploit: pas de signaux, pas de project-state (RECUEIL seul)", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — recueil seul");

    const recap = await runLiveScrape(slugs, { store, fetch });

    expect(recap[0]!.signals).toBeUndefined();
    expect(store.objects.has(projectStateKey(recap[0]!.city))).toBe(false);
  });
});

describe("configOnlyCitySlugs / citiesChunk — --chunk sharding (b)", () => {
  it("configOnlyCitySlugs is the sorted, deduped config-only set (no pvText fixtures)", () => {
    const slugs = configOnlyCitySlugs();
    const expected = ALL_PV_CITIES.filter((c) => !c.pvText)
      .map((c) => c.config.citySlug)
      .sort();
    expect(slugs).toEqual(expected);
    expect([...slugs].sort()).toEqual(slugs); // already sorted
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicates
    // A pvText-fixture city is never in the live-scraped set.
    const fixtureCity = ALL_PV_CITIES.find((c) => c.pvText)?.config.citySlug;
    if (fixtureCity) expect(slugs).not.toContain(fixtureCity);
  });

  it("partitions into n disjoint, in-order shards that reassemble to the whole list", () => {
    const all = ["a", "b", "c", "d", "e"];
    const shards = [1, 2, 3].map((k) => citiesChunk(all, k, 3)); // size = ceil(5/3) = 2
    expect(shards).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(shards.flat()).toEqual(all); // no overlap, no gap, order preserved
  });

  it("handles a trailing empty shard when n > length", () => {
    const all = ["a", "b"]; // size = ceil(2/3) = 1 → [a] [b] []
    expect(citiesChunk(all, 1, 3)).toEqual(["a"]);
    expect(citiesChunk(all, 2, 3)).toEqual(["b"]);
    expect(citiesChunk(all, 3, 3)).toEqual([]);
  });

  it("n=1 returns the whole list", () => {
    expect(citiesChunk(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("real config-only shards (chunk 1/n..n/n) reassemble to configOnlyCitySlugs()", () => {
    const all = configOnlyCitySlugs();
    const n = 5;
    const reassembled = Array.from({ length: n }, (_, i) => citiesChunk(all, i + 1, n)).flat();
    expect(reassembled).toEqual(all);
  });
});

describe("runLiveScrape — onCity streaming (a, observability)", () => {
  it("invokes onCity once per recap entry, in order, before returning", async () => {
    const store = new MemoryStore();
    const slugs = configOnlySlugs(3);
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — onCity");

    const streamed: string[] = [];
    const recap = await runLiveScrape(slugs, {
      store,
      fetch,
      onCity: (r) => streamed.push(r.city),
    });

    // Streamed set + order match the returned recap exactly (per-city, not at the end).
    expect(streamed).toEqual(recap.map((r) => r.city));
    expect(streamed).toHaveLength(recap.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REEXPLOIT: replay EXPLOITATION from already-stored raw (no network scrape).
// Seeds a city's raw PV (`raw/proces-verbaux-<city>/cas/<sha>.pdf` + sidecar
// `.meta.json`) as RECUEIL would, then re-exploits from the store alone.
// ─────────────────────────────────────────────────────────────────────────────

/** pdftotext mock: any PV PDF → the real Saint-Damase positive text (règl. 38-41). */
const zonagePdfToText: PdfToText = async () => PV_SAINT_DAMASE_2025_05_POSITIVE;

/** Opaque PDF bytes (only extractable via the injected pdfToText). */
function fakePdfBytes(marker: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n%opaque-${marker}\n%%EOF`);
}

/**
 * Seed a city's raw PV into the store exactly as RECUEIL would: the CAS bytes at
 * `raw/proces-verbaux-<city>/cas/<sha>.pdf` + the sidecar `.meta.json` that
 * `loadScrapedPvRecords` (the reexploit reader) parses back into a record.
 */
async function seedRawPvForCity(
  store: MemoryStore,
  citySlug: string,
  marker: string,
): Promise<void> {
  const body = fakePdfBytes(marker);
  const record = buildRawDocumentRecord({
    source: `proces-verbaux-${citySlug}`,
    sourceUrl: `https://ville.${citySlug}.qc.ca/pv/${marker}.pdf`,
    body,
    fetchedAt: "2026-06-10T00:00:00.000Z",
    contentType: "application/pdf",
    provenance: { version: "0.1.0", userAgent: "radar-test", viaObscura: false },
  });
  await store.put(record.storageKey, body, record.contentType);
  await store.put(
    rawMetaKey(record.storageKey),
    JSON.stringify(record, null, 2),
    "application/json",
  );
}

/** A fetch that records if it was ever called and throws if it is (network guard). */
function makeThrowingFetch(): { fetch: PvFetchLike; calls: () => number } {
  let calls = 0;
  const fetch: PvFetchLike = async () => {
    calls += 1;
    throw new Error("reexploit must not hit the network");
  };
  return { fetch, calls: () => calls };
}

describe("runLiveScrape — reexploit (replay from stored raw, NO scrape)", () => {
  it("shares one parse budget across cities and publishes only completed cities", async () => {
    const cities = configOnlySlugs(2);
    const store = new MemoryStore();
    for (const city of cities) {
      await seedRawPvForCity(store, city, "one");
      await seedRawPvForCity(store, city, "two");
    }
    const { fetch, calls } = makeThrowingFetch();
    const options = { store, fetch, reexploit: true, limit: 1, pdfToText: zonagePdfToText };
    const expectedRemaining = [3, 2, 1, 0];
    for (const remaining of expectedRemaining) {
      const recap = await runLiveScrape(cities, options);
      expect(recap.reduce((n, city) => n + city.reexploitProgress!.newDocuments, 0)).toBe(1);
      expect(recap.reduce((n, city) => n + city.reexploitProgress!.remaining, 0)).toBe(remaining);
      if (remaining === 3) expect(recap.every((city) => city.signals === undefined)).toBe(true);
    }
    expect(calls()).toBe(0);
    for (const city of cities) expect(store.objects.has(projectStateKey(city))).toBe(true);
  });

  it("re-exploits a seen city from the store, projects signals, and NEVER calls fetch", async () => {
    const [city] = configOnlySlugs(1);
    const store = new MemoryStore();
    await seedRawPvForCity(store, city!, "zonage");

    const { fetch, calls } = makeThrowingFetch();

    const recap = await runLiveScrape([city!], {
      store,
      fetch, // would throw if the adapter tried the network
      reexploit: true,
      pdfToText: zonagePdfToText,
    });

    // Network was never touched: reexploit builds no adapter.
    expect(calls()).toBe(0);

    const entry = recap[0]!;
    expect(entry.city).toBe(city);
    // Exploitation ran on the stored raw → the real DesignationEvent (38-41).
    expect(entry.signals).toBe(1);
    expect(entry.exploitError).toBeUndefined();
    // The Signaux view reads exactly this key — reexploit wrote it.
    expect(store.objects.has(projectStateKey(city!))).toBe(true);
    // No scrape happened → no NEW raw CAS object beyond the seeded one.
    expect(entry.status).toBe("seen");
  });

  it("a city with no stored raw re-exploits to 0 signal (honest, no crash, no network)", async () => {
    const [city] = configOnlySlugs(1);
    const store = new MemoryStore(); // nothing seeded
    const { fetch, calls } = makeThrowingFetch();

    const recap = await runLiveScrape([city!], {
      store,
      fetch,
      reexploit: true,
      pdfToText: zonagePdfToText,
    });

    expect(calls()).toBe(0);
    expect(recap[0]!.signals).toBe(0);
    expect(recap[0]!.exploitError).toBeUndefined();
    expect(store.objects.has(projectStateKey(city!))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-bound: the PG feed fires when a `db` handle is present (exploit + reexploit),
// and a pre-existing provenance ref survives the reexploit upsert (#616 union).
// Skipped unless the Make test stack is up (Postgres reachable, NODE_ENV=test).
// ─────────────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = process.env.GRAPH_DB_TESTS === "1" || process.env.NODE_ENV === "test";

describe.skipIf(!DB_AVAILABLE)("runLiveScrape — PG feed (DB-bound)", () => {
  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    const config = loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    });
    return createDb(config).db;
  }

  /** Purge every node (+ incident edge) of a test city for a deterministic start. */
  async function cleanCity(
    db: Awaited<ReturnType<typeof getDb>>,
    city: string,
  ): Promise<void> {
    const { graphNodes, graphEdges } = await import("../../db/schema.js");
    const { eq, inArray, or } = await import("drizzle-orm");
    const ids = (
      await db.select({ id: graphNodes.id }).from(graphNodes).where(eq(graphNodes.citySlug, city))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db
        .delete(graphEdges)
        .where(or(inArray(graphEdges.srcId, ids), inArray(graphEdges.dstId, ids)));
    }
    await db.delete(graphNodes).where(eq(graphNodes.citySlug, city));
  }

  it("exploit + db upserts the city's graph into Postgres (the PG feed fires)", async () => {
    const [city] = configOnlySlugs(1);
    const db = await getDb();
    await cleanCity(db, city!);

    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs([city!], "PV bytes — zonage réel");

    const recap = await runLiveScrape([city!], {
      store,
      fetch,
      exploit: true,
      pdfToText: zonagePdfToText,
      db,
    });
    expect(recap[0]!.signals).toBe(1);

    const { graphNodes } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, city!));
    // The graph feed wrote nodes for this city, incl. the DesignationEvent signal
    // (projectStateToGraph lowercases the canonical type → DB type column).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.type === "designationevent")).toBe(true);

    await cleanCity(db, city!);
  });

  it("reexploit + db upserts the graph WITHOUT any network call", async () => {
    const [city] = configOnlySlugs(1);
    const db = await getDb();
    await cleanCity(db, city!);

    const store = new MemoryStore();
    await seedRawPvForCity(store, city!, "zonage");
    const { fetch, calls } = makeThrowingFetch();

    const recap = await runLiveScrape([city!], {
      store,
      fetch,
      reexploit: true,
      pdfToText: zonagePdfToText,
      db,
    });

    expect(calls()).toBe(0);
    expect(recap[0]!.signals).toBe(1);

    const { graphNodes } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, city!));
    expect(rows.some((r) => r.type === "designationevent")).toBe(true);

    await cleanCity(db, city!);
  });

  it("a pre-existing provenance ref survives the reexploit upsert (#616 union non-regression)", async () => {
    const [city] = configOnlySlugs(1);
    const db = await getDb();
    await cleanCity(db, city!);

    const store = new MemoryStore();
    await seedRawPvForCity(store, city!, "zonage");
    const { fetch } = makeThrowingFetch();
    const { graphNodes } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const { upsertGraph } = await import("../graph/graph-store.js");

    // 1) First reexploit → the DesignationEvent node lands in PG.
    await runLiveScrape([city!], { store, fetch, reexploit: true, pdfToText: zonagePdfToText, db });
    const [event] = (
      await db.select().from(graphNodes).where(eq(graphNodes.citySlug, city!))
    ).filter((r) => r.type === "designationevent");
    expect(event).toBeDefined();

    // 2) Attach a projection-materialized provenance citation to that node (as the
    //    materialize step would), through the SAME provenance-preserving upsert.
    const CITATION = {
      docSha: "SHA_REEXPLOIT",
      rawRef: `raw/proces-verbaux-${city}/cas/SHA_REEXPLOIT.pdf`,
      page: 1,
      excerpt: "Adoption règlement 38-41 — provenance ref",
      linkSource: "projection-materialize-severed",
    };
    await upsertGraph(db, city!, {
      nodes: [{ id: event!.id, label: event!.label, type: "designationevent", refs: [CITATION] }],
      edges: [],
    });

    // 3) Reexploit AGAIN — the fresh detection re-emits the node with no refs. The
    //    #616 union guard must keep the materialized citation.
    await runLiveScrape([city!], { store, fetch, reexploit: true, pdfToText: zonagePdfToText, db });

    const [after] = await db.select().from(graphNodes).where(eq(graphNodes.id, event!.id));
    const refs = (after!.props as { refs?: Array<Record<string, unknown>> }).refs ?? [];
    expect(refs).toContainEqual(CITATION);

    await cleanCity(db, city!);
  });
});

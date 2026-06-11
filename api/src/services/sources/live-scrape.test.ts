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
import { describe, expect, it } from "vitest";

import {
  ALL_PV_CITIES,
  PV_SAINT_DAMASE_2025_05_POSITIVE,
  type PdfToText,
  type PvFetchLike,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { projectStateKey } from "../exploitation/project-state.js";
import { runLiveScrape } from "./live-scrape.js";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory object store (patron recueil.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  putCount = 0;
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
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

  it("sans exploit: pas de signaux, pas de project-state (RECUEIL seul)", async () => {
    const slugs = configOnlySlugs(1);
    const store = new MemoryStore();
    const fetch = fakeFetchForSlugs(slugs, "PV bytes — recueil seul");

    const recap = await runLiveScrape(slugs, { store, fetch });

    expect(recap[0]!.signals).toBeUndefined();
    expect(store.objects.has(projectStateKey(recap[0]!.city))).toBe(false);
  });
});

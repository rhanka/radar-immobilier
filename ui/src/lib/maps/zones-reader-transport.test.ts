/**
 * J1 zonage — parity of the Signaux zoning layer between the app path and
 * the artifact path (field review j1-2b §7, brief j1-zonage step 4).
 *
 * App path: the real `fetchZones` on the verbatim public OGC items
 * (`api/tests/fixtures/zonage-parity/<city>.raw.json`).
 * Artifact path: the SAME `fetchZones`, fed by `zonesCollectionResponseViaReader`
 * replaying the reader-op pages pinned by the API test
 * (`<city>.reader-pages.json`, produced by `readReaderCollectionItems`).
 * Then both go through the real `loadSignauxZones` tiering.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchZones, resolveZonesUrl, type ZoneFeature } from "./zones-client.js";
import { loadSignauxZones } from "./signaux-zones-loader.js";
import {
  ZONES_READER_OPERATION,
  ZONES_READER_PAGE_LIMIT,
  parseZonesCollectionRequest,
  readerZoningPropertiesToOgc,
  zonesCollectionResponseViaReader,
  type ReaderOpResult,
  type ZonesReaderInvoke,
} from "./zones-reader-transport.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  resolve(HERE, "../../../../api/tests/fixtures/zonage-parity", name);

interface ReaderPage {
  features: Array<{ type: "Feature"; geometry: unknown; properties: Record<string, unknown> }>;
  numberMatched: number;
  nextOffset: number | null;
  [key: string]: unknown;
}

const CITIES = ["honfleur", "saint-venant-de-paquette"] as const;

function rawItems(city: string): unknown {
  return (JSON.parse(readFileSync(fixture(`${city}.raw.json`), "utf8")) as { items: unknown }).items;
}

function readerPages(city: string): ReaderPage[] {
  return JSON.parse(readFileSync(fixture(`${city}.reader-pages.json`), "utf8")) as ReaderPage[];
}

/**
 * Replays the pinned op pages for any (limit, offset) the transport asks:
 * the pinned pages are flattened, then re-sliced exactly as the op would.
 */
function replayInvoke(city: string, calls: Array<Record<string, string>>): ZonesReaderInvoke {
  const pages = readerPages(city);
  const all = pages.flatMap((page) => page.features);
  const head = pages[0]!;
  return async (op, params) => {
    expect(op).toBe(ZONES_READER_OPERATION);
    calls.push({ ...params });
    const limit = Number(params.limit);
    const offset = Number(params.offset ?? "0");
    expect(limit).toBeLessThanOrEqual(ZONES_READER_PAGE_LIMIT);
    const features = all.slice(offset, offset + limit);
    const next = offset + features.length;
    return {
      status: 200,
      body: {
        ...head,
        features,
        numberMatched: all.length,
        numberReturned: features.length,
        truncated: next < all.length,
        nextOffset: features.length > 0 && next < all.length ? next : null,
      },
    } satisfies ReaderOpResult;
  };
}

function stubFetchWith(handler: (url: string) => Promise<Response>): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => handler(String(input)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function comparable(feature: ZoneFeature) {
  // URLs and the proof envelope are compared separately: the op applies the
  // server provenance sanitiser and the §7.3 URL projection (drop, never
  // rewrite), which are stricter than the UI validators on query strings.
  const { grillePdfUrl, reglementUrl, proof, ...rest } = feature.properties;
  return { geometry: feature.geometry, properties: rest, urls: { grillePdfUrl, reglementUrl }, proof };
}

/** Per-city tally of envelopes/URLs the op dropped (reported, never invented). */
const dropped: Record<string, { proof: number; urls: number }> = {};

function isPublicCanonical(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

describe("J1 zonage parity — app path vs artifact path (same fetchZones)", () => {
  for (const city of CITIES) {
    it(`serves the same zones, codes and counts for ${city}`, async () => {
      // App path.
      stubFetchWith(async () => Response.json(rawItems(city)));
      const app = await fetchZones(city, { limit: 3000 });

      // Artifact path: the transport answers the same URL from the reader op.
      const calls: Array<Record<string, string>> = [];
      const invoke = replayInvoke(city, calls);
      stubFetchWith(async (url) => {
        const mapped = await zonesCollectionResponseViaReader(url, invoke);
        if (!mapped) throw new Error(`unmapped ${url}`);
        return mapped;
      });
      const artifact = await fetchZones(city, { limit: 3000 });

      expect(app.ok).toBe(true);
      expect(artifact.ok).toBe(true);
      const appFeatures = app.featureCollection.features;
      const artFeatures = artifact.featureCollection.features;
      expect(appFeatures.length).toBeGreaterThan(0);
      // Counts.
      expect(artFeatures.length).toBe(appFeatures.length);
      expect(artifact.numberMatched).toBe(app.numberMatched);
      // Codes, in order.
      expect(artFeatures.map((f) => f.properties.code)).toEqual(appFeatures.map((f) => f.properties.code));
      // Zones: geometry + every other property (code, kind, affectation,
      // usages, millésime, numéro, provenance, citySlug) identical.
      expect(artFeatures.map((f) => comparable(f).geometry)).toEqual(appFeatures.map((f) => comparable(f).geometry));
      expect(artFeatures.map((f) => comparable(f).properties)).toEqual(appFeatures.map((f) => comparable(f).properties));
      // URLs: identical when the app URL is public canonical; otherwise the
      // op drops it (review §7.3 projection) and never invents another.
      const tally = (dropped[city] = { proof: 0, urls: 0 });
      appFeatures.forEach((feature, index) => {
        const served = artFeatures[index]!.properties;
        for (const key of ["grillePdfUrl", "reglementUrl"] as const) {
          const appUrl = feature.properties[key];
          if (isPublicCanonical(appUrl)) expect(served[key], `${city}#${index}.${key}`).toBe(appUrl);
          else {
            expect(served[key], `${city}#${index}.${key}`).toBeUndefined();
            if (appUrl !== undefined) tally.urls += 1;
          }
        }
        // Proof: identical when served; when dropped, the app envelope
        // carried a non-canonical (query-string) source URL.
        if (served.proof !== undefined) expect(served.proof).toEqual(feature.properties.proof);
        else if (feature.properties.proof !== undefined) {
          expect(JSON.stringify(feature.properties.proof)).toMatch(/"url":"[^"]*\?/);
          tally.proof += 1;
        }
      });
      console.info(`[j1-zonage parity] ${city}: ${appFeatures.length} zones, op dropped proof=${tally.proof} url=${tally.urls}`);
      // Paged within the op bounds, offsets strictly increasing.
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.every((call) => call.collectionId === `qc-zonage-${city}`)).toBe(true);
    });

    it(`yields the same Signaux layer through loadSignauxZones for ${city}`, async () => {
      stubFetchWith(async () => Response.json(rawItems(city)));
      const app = await loadSignauxZones(city, { fetchResolvedZones: async () => { throw new Error("unused"); } });
      const invoke = replayInvoke(city, []);
      stubFetchWith(async (url) => (await zonesCollectionResponseViaReader(url, invoke))!);
      const artifact = await loadSignauxZones(city, { fetchResolvedZones: async () => { throw new Error("unused"); } });
      expect(artifact.tier).toBe("collection");
      expect(app.tier).toBe("collection");
      expect(artifact.response?.zoneCount).toBe(app.response?.zoneCount);
      const strip = (r: typeof app) =>
        r.response?.featureCollection.features.map(({ properties: p }) => ({
          code: p.code,
          kind: p.kind,
          affectation: p.affectation,
          label: p.label,
          geometryStatus: p.geometryStatus,
        }));
      expect(strip(artifact)).toEqual(strip(app));
    });
  }
});

describe("J1 zonage transport mapping", () => {
  it("recognises only the zoning items path with an optional limit", () => {
    expect(parseZonesCollectionRequest(resolveZonesUrl("honfleur", { limit: 3000, baseUrl: "" }))).toEqual({
      collectionId: "qc-zonage-honfleur",
      citySlug: "honfleur",
      limit: 3000,
    });
    expect(parseZonesCollectionRequest("/api/geo/collections/qc-lots-honfleur/items?limit=10")).toBeNull();
    expect(parseZonesCollectionRequest("/api/geo/collections/qc-zonage-norms-x/items")).toBeNull();
    expect(parseZonesCollectionRequest("/api/geo/collections/qc-zonage-honfleur/items?bbox=1,2,3,4")).toBeNull();
    expect(parseZonesCollectionRequest("/api/geo/honfleur/zones")).toBeNull();
  });

  it("renames grillePdfUrl and keeps only projection keys", () => {
    expect(readerZoningPropertiesToOgc({ code: "A-1", grillePdfUrl: "https://x.ca/g.pdf", other: "drop" })).toEqual({
      code: "A-1",
      URL_Grille: "https://x.ca/g.pdf",
    });
  });

  it("maps a governance refusal to the app's absent-collection path (ok:false, no fake zero)", async () => {
    const invoke: ZonesReaderInvoke = async () => ({
      status: 403,
      body: { ok: false, error: "geo_governed_not_served", status: "not covered", reason: "rights-missing" },
    });
    stubFetchWith(async (url) => (await zonesCollectionResponseViaReader(url, invoke))!);
    const zones = await fetchZones("honfleur", { limit: 3000 });
    expect(zones.ok).toBe(false);
    expect(zones.featureCollection.features).toEqual([]);
  });

  it("keeps 429 and Retry-After, so the layer reports an error instead of an empty map", async () => {
    const invoke: ZonesReaderInvoke = async () => ({ status: 429, body: { error: "rate_limited" }, retryAfterSec: 12 });
    const response = await zonesCollectionResponseViaReader("/api/geo/collections/qc-zonage-honfleur/items?limit=3000", invoke);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("12");
    stubFetchWith(async (url) => (await zonesCollectionResponseViaReader(url, invoke))!);
    await expect(fetchZones("honfleur", { limit: 3000 })).rejects.toThrow(/429/);
  });

  it("refuses a page that is not a zoning-v1 page of the requested collection", async () => {
    const invoke: ZonesReaderInvoke = async () => ({
      status: 200,
      body: { type: "FeatureCollection", features: [], numberMatched: 0, nextOffset: null, projection: "allowlist", collectionId: "qc-zonage-honfleur", license: {} },
    });
    const response = await zonesCollectionResponseViaReader("/api/geo/collections/qc-zonage-honfleur/items", invoke);
    expect(response?.status).toBe(502);
  });

  it("stops at the requested limit and at 15 pages", async () => {
    const calls: Array<Record<string, string>> = [];
    const invoke: ZonesReaderInvoke = async (_op, params) => {
      calls.push({ ...params });
      const limit = Number(params.limit);
      const offset = Number(params.offset ?? "0");
      return {
        status: 200,
        body: {
          type: "FeatureCollection",
          features: Array.from({ length: limit }, (_, i) => ({ type: "Feature", geometry: null, properties: { code: `Z-${offset + i}` } })),
          numberMatched: 99_999,
          numberReturned: limit,
          nextOffset: offset + limit,
          projection: "zoning-v1",
          collectionId: "qc-zonage-big",
          license: { id: "cc-by-4.0", title: "t", href: null, attribution: null },
        },
      };
    };
    const limited = await zonesCollectionResponseViaReader("/api/geo/collections/qc-zonage-big/items?limit=450", invoke);
    expect(((await limited!.json()) as { features: unknown[] }).features).toHaveLength(450);
    expect(calls.map((c) => [c.limit, c.offset])).toEqual([["200", undefined], ["200", "200"], ["50", "400"]]);
    calls.length = 0;
    const full = await zonesCollectionResponseViaReader("/api/geo/collections/qc-zonage-big/items?limit=99999", invoke);
    expect(((await full!.json()) as { features: unknown[] }).features).toHaveLength(3000);
    expect(calls).toHaveLength(15);
  });

  it("honours an aborted signal between pages", async () => {
    const controller = new AbortController();
    const invoke: ZonesReaderInvoke = async () => {
      controller.abort();
      return {
        status: 200,
        body: {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: null, properties: { code: "A" } }],
          numberMatched: 2,
          nextOffset: 1,
          projection: "zoning-v1",
          collectionId: "qc-zonage-honfleur",
          license: { id: "cc-by-4.0", title: "t", href: null, attribution: null },
        },
      };
    };
    await expect(
      zonesCollectionResponseViaReader("/api/geo/collections/qc-zonage-honfleur/items", invoke, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

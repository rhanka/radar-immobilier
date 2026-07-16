import { describe, expect, it, vi } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import {
  computeCoverageStatus,
  sourceCoverageRoute,
  type CoverageStatusInput,
} from "./source-coverage.js";
import { createApp } from "../app.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { upsert } from "../services/scrape-status/store.js";

const NOW_ISO = "2026-06-29T00:00:00.000Z";
const NOW = () => Date.parse(NOW_ISO);
const RECENT = new Date("2026-06-20T00:00:00Z");

interface CoverageCell {
  state: "verified" | "declared" | "absent";
  freshness: "fresh" | "partial" | "stale" | "unknown";
}
interface NormesCell extends CoverageCell {
  measured?: boolean;
  available?: boolean | null;
  error?: "geo-unreachable" | "invalid-response";
  zoneCount?: number;
  numberMatched?: number | null;
  complete?: boolean;
  zonesWithGrille?: number;
  zonesWithReglement?: number;
  zonesWithLegacyNormes?: number;
  zonesWithNormativeValues?: number;
  covered?: number;
}
interface RawCell extends CoverageCell {
  count: number;
}
interface GraphCell extends CoverageCell {
  ontologyVersion: string | null;
}
interface SignalsCell extends CoverageCell {
  count: number;
  withCitation: number;
  priority: number;
}
interface GeoCell extends CoverageCell {
  served: boolean;
  servedBy: "geo" | "local" | null;
}
interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  signals: SignalsCell;
  l4Zonage: GeoCell;
  normes: NormesCell;
  l5Lots: GeoCell;
  lotFields: CoverageCell;
  tod: GeoCell;
  worstStatus: "verified" | "declared" | "absent";
  nextMarginalGain: "zonage" | "lots" | null;
}
interface CoverageResponse {
  generatedAt: string;
  totals: {
    cities: number;
    l1Raw: number;
    l2Graph: number;
    signals: number;
    l4Zonage: number;
    l5Lots: number;
  };
  cities: CityCoverage[];
}
interface CityGrillesResponse {
  citySlug: string;
  available: boolean;
  error?: "geo-unreachable" | "invalid-response";
  zoneCount?: number;
  numberMatched?: number | null;
  complete?: boolean;
  zonesWithGrille?: number;
  zonesWithLegacyNormes?: number;
  zonesWithReglement?: number;
  zonesWithNormativeValues?: number;
  covered?: number;
  state?: "verified" | "declared" | "absent";
}

function makeMemStore(): ObjectStore {
  const data = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      const buf =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : Buffer.isBuffer(body)
            ? new Uint8Array(body)
            : body;
      data.set(key, buf);
      return { key };
    },
    async get(key) {
      const val = data.get(key);
      if (!val) throw new Error(`not found: ${key}`);
      return val;
    },
    async head(key) {
      return data.has(key) ? { key } : null;
    },
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

/**
 * DB mock: the route runs five bulk queries, in order graph → zones → lots →
 * signals → priority signal NODES (`listCitiesWithSignalNodes`, awaited at
 * `.where()` — no groupBy: the z∩m∩p classification runs in TS on raw node
 * rows { citySlug, type, category, label, nbUnitesMax, intensite, description,
 * etapeAnnote }). Each query resolves the next array in the queue (missing
 * entries resolve to []). The chain is BOTH groupBy-resolvable and thenable to
 * mirror the two read shapes.
 */
function makeDb(queue: Record<string, unknown>[][]): Database {
  let idx = 0;
  const next = () => {
    const result = queue[idx] ?? [];
    idx += 1;
    return result;
  };
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => Promise.resolve(next());
  // Awaiting the builder directly (query without groupBy) resolves the queue too.
  chain.then = (resolve: (rows: Record<string, unknown>[]) => unknown) =>
    Promise.resolve(next()).then(resolve);
  return { select: () => chain } as unknown as Database;
}

/**
 * Raw signal-node row for the priority (z∩m∩p) query — the shape
 * `listCitiesWithSignalNodes` selects. Defaults build a NON-priority Signal;
 * override category/nbUnitesMax/etapeAnnote to flip the z/m/p flags.
 */
function signalNodeRow(
  citySlug: string,
  patch: Partial<{
    type: string;
    category: string | null;
    label: string;
    nbUnitesMax: string | null;
    intensite: string | null;
    description: string | null;
    etapeAnnote: string | null;
  }> = {},
): Record<string, unknown> {
  return {
    citySlug,
    type: "Signal",
    category: null,
    label: "Signal de test",
    nbUnitesMax: null,
    intensite: null,
    description: null,
    etapeAnnote: null,
    ...patch,
  };
}

/** Offline par défaut : les tests unitaires ne touchent JAMAIS le réseau. */
const offlineFetch: typeof fetch = () =>
  Promise.reject(new Error("offline (unit test)"));

/** fetch mock renvoyant un listing OGC /collections avec les ids donnés. */
function listingFetch(ids: string[]): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ collections: ids.map((id) => ({ id })) }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
}

function scrapeStatus(
  patch: Partial<ScrapeStatusT> &
    Pick<ScrapeStatusT, "citySlug" | "source" | "status">,
): ScrapeStatusT {
  return { automation: "refresh", windowMonths: 6, ...patch } as ScrapeStatusT;
}

function cityOf(body: CoverageResponse, slug: string): CityCoverage {
  const city = body.cities.find((c) => c.citySlug === slug);
  if (!city) throw new Error(`city not found in response: ${slug}`);
  return city;
}

async function request(deps: {
  store: ObjectStore;
  db?: Database;
  fetchImpl?: typeof fetch;
}): Promise<CoverageResponse> {
  const app = sourceCoverageRoute({
    fetchImpl: offlineFetch,
    ...deps,
    now: NOW,
  });
  const res = await app.request("/api/source/coverage");
  expect(res.status).toBe(200);
  return (await res.json()) as CoverageResponse;
}

describe("GET /api/source/coverage", () => {
  it("returns the province-wide contract shape with coherent totals", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    expect(typeof body.generatedAt).toBe("string");
    expect(body.generatedAt).toBe(NOW_ISO);

    // Province-wide: every QC municipality is present, totals.cities matches.
    expect(body.cities.length).toBeGreaterThan(1000);
    expect(body.totals.cities).toBe(body.cities.length);

    // Each cell carries the contracted tri-state + freshness shape.
    const sample = cityOf(body, "brossard");
    expect(sample.cityName).toBe("Brossard");
    expect(sample.l1Raw).toMatchObject({
      state: expect.any(String),
      count: expect.any(Number),
      freshness: expect.any(String),
    });
    expect(sample.l2Graph).toHaveProperty("ontologyVersion");
    expect(sample.signals).toMatchObject({
      state: expect.any(String),
      count: expect.any(Number),
      withCitation: expect.any(Number),
      // Signaux PRIORITAIRES z∩m∩p (cohorte « 33 ») — critère du focus client.
      priority: expect.any(Number),
      freshness: expect.any(String),
    });
    expect(sample.l4Zonage).toHaveProperty("served");
    expect(sample.l4Zonage).toHaveProperty("servedBy");
    expect(sample.l5Lots).toHaveProperty("served");
    // Couches explicites du détail ville : normes (grilles) + champs lot + TOD.
    expect(sample.normes).toMatchObject({
      state: expect.any(String),
      freshness: expect.any(String),
    });
    expect(sample.lotFields).toMatchObject({
      state: expect.any(String),
      freshness: expect.any(String),
    });
    expect(sample.tod).toHaveProperty("served");
    expect(sample.tod).toHaveProperty("servedBy");
    expect(sample).toHaveProperty("worstStatus");
    expect(sample).toHaveProperty("nextMarginalGain");

    // Totals are the count of cities reaching `verified` at each layer.
    const verifiedAt = (sel: (c: CityCoverage) => CoverageCell) =>
      body.cities.filter((c) => sel(c).state === "verified").length;
    expect(body.totals.l1Raw).toBe(verifiedAt((c) => c.l1Raw));
    expect(body.totals.l2Graph).toBe(verifiedAt((c) => c.l2Graph));
    expect(body.totals.signals).toBe(verifiedAt((c) => c.signals));
    expect(body.totals.l4Zonage).toBe(verifiedAt((c) => c.l4Zonage));
    expect(body.totals.l5Lots).toBe(verifiedAt((c) => c.l5Lots));
  });

  it("honours the tri-state: verified (live), declared (claimed, unsubstantiated), absent", async () => {
    const store = makeMemStore();
    // brossard: raw scraped → L1 verified, no graph/geo → downstream absent.
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    // salaberry & beauharnois derive `graphified` raw sources (seeded MAMH).
    // Provide live graph rows ONLY for salaberry.
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 10,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
    ]);
    const body = await request({ store, db });

    // verified L1: a real scrape capture.
    const brossard = cityOf(body, "brossard");
    expect(brossard.l1Raw.state).toBe("verified");

    // verified L2: live graph rows substantiate the graph.
    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l2Graph.ontologyVersion).toBe("v2.3");

    // declared L2: scrape-status claims `graphified` but NO live graph rows.
    const beauharnois = cityOf(body, "beauharnois");
    expect(beauharnois.l1Raw.state).toBe("verified"); // raw graphified
    expect(beauharnois.l2Graph.state).toBe("declared");
    expect(beauharnois.l2Graph.ontologyVersion).toBeNull();

    // absent: a plain todo city with nothing anywhere.
    const empty = body.cities.find(
      (c) =>
        c.l1Raw.state === "absent" &&
        c.l2Graph.state === "absent" &&
        c.l4Zonage.state === "absent" &&
        c.l5Lots.state === "absent",
    );
    expect(empty).toBeDefined();
    expect(empty?.worstStatus).toBe("absent");
  });

  it("worstStatus: a single served layer (PV only) → Partiel, never green, never grey", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    const brossard = cityOf(body, "brossard");
    expect(brossard.l1Raw.state).toBe("verified");
    expect(brossard.l2Graph.state).toBe("absent");
    expect(brossard.l4Zonage.state).toBe("absent");
    expect(brossard.l5Lots.state).toBe("absent");
    // Anti-survente: a single served layer never paints the city green — but a
    // partially covered city is HONESTLY orange (Partiel), not grey.
    expect(brossard.worstStatus).toBe("declared");
  });

  it("worstStatus: lots+zonage served live but no PV/signals → Partiel (province reality)", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch([
      "qc-zonage-tadoussac",
      "qc-lots-tadoussac",
    ]);
    const body = await request({ store, db: makeDb([]), fetchImpl });

    // La grande majorité de la province est dans ce cas : couches géo servies
    // (listing live) mais PV/signaux absents → Partiel (orange), pas gris.
    const tadoussac = cityOf(body, "tadoussac");
    expect(tadoussac.l4Zonage.state).toBe("verified");
    expect(tadoussac.l5Lots.state).toBe("verified");
    expect(tadoussac.l1Raw.state).toBe("absent");
    expect(tadoussac.signals.state).toBe("absent");
    expect(tadoussac.worstStatus).toBe("declared");
  });

  // ── BUG 1 : « servi » = listing LIVE geo, pas le seul PG local ─────────────

  it("marks zonage/lots served from the LIVE geo listing (PG empty)", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
      "qc-lots-saint-hippolyte",
      // Variante suffixée : ne matche AUCUN slug de municipalité (exclue).
      "qc-zonage-saint-hippolyte-affectations-arcgis",
      "autre-collection",
    ]);
    const body = await request({ store, db: makeDb([]), fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l4Zonage).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });
    expect(valleyfield.l5Lots).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });

    // saint-hippolyte : lots servis live, zonage NON (variante suffixée ≠ slug).
    const hippolyte = cityOf(body, "saint-hippolyte");
    expect(hippolyte.l5Lots).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
    });
    expect(hippolyte.l4Zonage.served).toBe(false);
    expect(hippolyte.l4Zonage.state).not.toBe("verified");

    // Totals refléteront le listing live (1 zonage, 2 lots ici).
    expect(body.totals.l4Zonage).toBe(1);
    expect(body.totals.l5Lots).toBe(2);

    // UNE seule requête listing pour les ~1104 villes (jamais per-city).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches the live listing across coverage requests (TTL)", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch(["qc-lots-saint-hippolyte"]);
    const app = sourceCoverageRoute({
      store,
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    const res1 = await app.request("/api/source/coverage");
    const res2 = await app.request("/api/source/coverage");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to local PG (honest degrade) when the geo listing is unreachable", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          currentVersions: 5,
          withGeometry: 5,
          lastKnownFrom: RECENT,
        },
      ],
      [],
    ]);
    const body = await request({ store, db, fetchImpl: offlineFetch });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    // Servi via le store local malgré geo down (dégradé, pas cassé).
    expect(valleyfield.l4Zonage).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "local",
    });
    // Rien de local ni de live → pas de vert fabriqué.
    const hippolyte = cityOf(body, "saint-hippolyte");
    expect(hippolyte.l5Lots.served).toBe(false);
  });

  // ── Couche TOD : listing live geo (qc-tod-<slug>), aucun store local ───────

  it("serves the TOD layer from the live listing (qc-tod-<slug>), absent otherwise", async () => {
    const store = makeMemStore();
    const fetchImpl = listingFetch(["qc-tod-brossard", "qc-lots-brossard"]);
    const body = await request({ store, db: makeDb([]), fetchImpl });

    const brossard = cityOf(body, "brossard");
    expect(brossard.tod).toMatchObject({
      state: "verified",
      served: true,
      servedBy: "geo",
      freshness: "fresh",
    });

    // Pas de collection qc-tod-<slug> → absent honnête (jamais de vert fabriqué).
    const hippolyte = cityOf(body, "saint-hippolyte");
    expect(hippolyte.tod).toMatchObject({
      state: "absent",
      served: false,
      servedBy: null,
    });
  });

  // ── Couche normes (grilles) : reprise de la mesure lazy quand chaude ───────

  it("normes: absent by default (bulk never measures), picks up the warm lazy grilles measure", async () => {
    const store = makeMemStore();
    // fetch qui sert le LISTING (collections) ET les items zonage (grilles).
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/items")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              { properties: { zone_code: "H-1", URL_GRILLE: "https://x/h1.pdf" } },
              { properties: { zone_code: "H-2" } }, // sans grille ni normes
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          collections: [{ id: "qc-zonage-salaberry-de-valleyfield" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const app = sourceCoverageRoute({
      store,
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    // Cache froid : l'état métier reste neutre car aucune mesure n'a eu lieu.
    const cold = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    expect(cityOf(cold, "salaberry-de-valleyfield").normes).toMatchObject({
      measured: false,
      available: null,
    });

    // Mesure lazy du détail ville (1 grille / 2 zones → declared)…
    const grillesRes = await app.request(
      "/api/source/coverage/salaberry-de-valleyfield/grilles",
    );
    expect(
      ((await grillesRes.json()) as CityGrillesResponse).state,
    ).toBe("declared");

    // …reprise par le bulk tant qu'elle est chaude (jamais de fetch per-city).
    const warm = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    const valleyfield = cityOf(warm, "salaberry-de-valleyfield");
    expect(valleyfield.normes).toMatchObject({
      state: "declared",
      freshness: "fresh",
      measured: true,
      available: true,
      zoneCount: 2,
      numberMatched: null,
      complete: true,
      zonesWithGrille: 1,
      zonesWithReglement: 0,
      zonesWithLegacyNormes: 0,
      zonesWithNormativeValues: 0,
      covered: 1,
    });
    expect(cityOf(warm, "brossard").normes.measured).toBe(false);
  });

  it("normes: preserves an unavailable lazy measurement separately from cold cache", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/items")) {
        return new Response("unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ collections: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const app = sourceCoverageRoute({
      store: makeMemStore(),
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    await app.request("/api/source/coverage/brossard/grilles");
    const body = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    expect(cityOf(body, "brossard").normes).toMatchObject({
      measured: true,
      available: false,
      error: "geo-unreachable",
    });
  });

  it("normes: bounds cached failures with the same finite discipline", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/items")
        ? new Response("unavailable", { status: 503 })
        : new Response(JSON.stringify({ collections: [] }), {
            headers: { "content-type": "application/json" },
          }),
    ) as unknown as typeof fetch;
    const app = sourceCoverageRoute({
      store: makeMemStore(),
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    await app.request("/api/source/coverage/brossard/grilles");
    for (let index = 0; index < 64; index += 1) {
      await app.request(`/api/source/coverage/cache-${index}/grilles`);
    }
    const body = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    expect(cityOf(body, "brossard").normes).toMatchObject({
      measured: false,
      available: null,
    });
  });

  // ── Signaux extraits (projection PG + part avec citation vérifiable) ────────

  it("exposes the signals layer with citation share from the graph projection", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          signalCount: 12,
          withCitation: 9,
          lastCreatedAt: RECENT,
        },
      ],
      // Nœuds bruts pour le compte PRIORITAIRE z∩m∩p : 1 signal satisfait les
      // 3 flags (zonage + 6 logements + étape précoce annotée), les 2 autres
      // n'en satisfont qu'une partie → priority = 1, pas 3.
      [
        signalNodeRow("salaberry-de-valleyfield", {
          category: "rezonage",
          nbUnitesMax: "6",
          etapeAnnote: "avis_motion",
        }),
        signalNodeRow("salaberry-de-valleyfield", {
          category: "rezonage",
          etapeAnnote: "avis_motion", // zonage + précoce mais PAS multi 4+
        }),
        signalNodeRow("salaberry-de-valleyfield", {
          category: "rezonage",
          nbUnitesMax: "8", // zonage + multi 4+ mais PAS précoce
          etapeAnnote: "adoption_reglement",
        }),
      ],
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals).toMatchObject({
      state: "verified",
      count: 12,
      withCitation: 9,
      priority: 1,
    });
    expect(body.totals.signals).toBe(1);
    // Ville sans nœud prioritaire → priority 0 (jamais inventé).
    expect(cityOf(body, "brossard").signals.priority).toBe(0);
  });

  it("priority (z∩m∩p) : DesignationEvent précoce à intensité haute compte, ville sans flags reste à 0", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [],
      [],
      [],
      [
        { citySlug: "mont-tremblant", signalCount: 13, withCitation: 7, lastCreatedAt: RECENT },
        { citySlug: "lyster", signalCount: 400, withCitation: 0, lastCreatedAt: RECENT },
      ],
      [
        // DesignationEvent = toujours zonage, mais JAMAIS multi 4+ → pas prioritaire.
        signalNodeRow("mont-tremblant", {
          type: "DesignationEvent",
          etapeAnnote: "avis_motion",
          intensite: "haute",
        }),
        // Signal zonage ∩ multi 4+ (intensité haute) ∩ précoce → prioritaire.
        signalNodeRow("mont-tremblant", {
          category: "modification_zonage",
          intensite: "haute",
          etapeAnnote: "projet_reglement",
        }),
        // Beaucoup de volume mais aucun flag → lyster reste à 0.
        signalNodeRow("lyster", { category: null }),
      ],
    ]);
    const body = await request({ store, db });

    expect(cityOf(body, "mont-tremblant").signals.priority).toBe(1);
    // Le VOLUME (400 signaux) ne fabrique pas de prioritaire.
    expect(cityOf(body, "lyster").signals).toMatchObject({
      count: 400,
      priority: 0,
    });
  });

  it("signals: structured city without projected signals is declared, unknown city absent", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [], // aucun signal projeté
    ]);
    const body = await request({ store, db });

    // L2 substantié mais 0 signal projeté → declared (pas un faux vert).
    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals.state).toBe("declared");
    expect(valleyfield.signals.count).toBe(0);

    // Ville sans rien → absent.
    const brossard = cityOf(body, "brossard");
    expect(brossard.signals.state).toBe("absent");
  });

  it("worstStatus: core layers complete (PV+signaux+zonage+lots) → Servi even without normes/TOD", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "salaberry-de-valleyfield",
        source: "conseils-municipaux",
        status: "graphified",
        lastRunAt: RECENT.toISOString(),
      }),
    );
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          signalCount: 12,
          withCitation: 9,
          lastCreatedAt: RECENT,
        },
      ],
    ]);
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
    ]);
    const body = await request({ store, db, fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals.state).toBe("verified");
    // Couches ANNEXES éparses (normes, TOD) absentes : elles ne bloquent pas
    // le « Servi » — la chaîne cœur complète garde la ville verte.
    expect(valleyfield.normes.state).toBe("absent");
    expect(valleyfield.tod.state).toBe("absent");
    expect(valleyfield.worstStatus).toBe("verified");
  });

  it("worstStatus: graphified city with served geo but signals not projected → Partiel (core incomplete)", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "salaberry-de-valleyfield",
        source: "conseils-municipaux",
        status: "graphified",
        lastRunAt: RECENT.toISOString(),
      }),
    );
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 40,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
      [], // signaux non projetés → cellule declared (couche cœur incomplète)
    ]);
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
    ]);
    const body = await request({ store, db, fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.signals.state).toBe("declared");
    // Signaux non servis = couverture PARTIELLE (honnête), pas un faux vert.
    expect(valleyfield.worstStatus).toBe("declared");
  });

  // ── Prochain gain marginal (D7) sur les flags « servi » corrigés ───────────

  it("flags nextMarginalGain=zonage for a graphified city without served zonage", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 8,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [], // no zone versions → zonage not served
      [], // no lot versions
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l4Zonage.served).toBe(false);
    expect(valleyfield.nextMarginalGain).toBe("zonage");
  });

  it("clears nextMarginalGain once the live listing proves zonage+lots served", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 8,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [],
      [],
    ]);
    const fetchImpl = listingFetch([
      "qc-zonage-salaberry-de-valleyfield",
      "qc-lots-salaberry-de-valleyfield",
    ]);
    const body = await request({ store, db, fetchImpl });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l4Zonage.served).toBe(true);
    expect(valleyfield.l5Lots.served).toBe(true);
    // Plus de complétion « cheap » à réclamer : le zonage/lots sont déjà servis.
    expect(valleyfield.nextMarginalGain).toBeNull();
  });

  it("advances nextMarginalGain to lots once zonage is served but lots are not", async () => {
    const store = makeMemStore();
    const db = makeDb([
      [
        {
          citySlug: "salaberry-de-valleyfield",
          nodeCount: 8,
          lastCreatedAt: RECENT,
          ontologyVersion: "v2.3",
        },
      ],
      [
        {
          citySlug: "salaberry-de-valleyfield",
          currentVersions: 5,
          withGeometry: 5, // served
          lastKnownFrom: RECENT,
        },
      ],
      [], // lots not served
    ]);
    const body = await request({ store, db });

    const valleyfield = cityOf(body, "salaberry-de-valleyfield");
    expect(valleyfield.l2Graph.state).toBe("verified");
    expect(valleyfield.l4Zonage.served).toBe(true);
    expect(valleyfield.l4Zonage.state).toBe("verified");
    expect(valleyfield.l5Lots.served).toBe(false);
    expect(valleyfield.nextMarginalGain).toBe("lots");
  });

  it("does not propose a marginal gain for a city that is not graphified live", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const body = await request({ store, db: makeDb([[], [], []]) });

    const brossard = cityOf(body, "brossard");
    expect(brossard.l2Graph.state).not.toBe("verified");
    expect(brossard.nextMarginalGain).toBeNull();
  });

  it("is wired into createApp", async () => {
    const store = makeMemStore();
    await upsert(
      store,
      scrapeStatus({
        citySlug: "brossard",
        source: "conseils-municipaux",
        status: "scraped",
      }),
    );
    const app = createApp({
      checkDb: async () => ({ ok: true }),
      checkObjectStore: async () => ({ ok: true }),
      store,
      db: makeDb([[], [], []]),
      now: NOW,
      fetchImpl: offlineFetch,
    });

    const res = await app.request("/api/source/coverage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoverageResponse;
    expect(body.totals.cities).toBe(body.cities.length);
    expect(cityOf(body, "brossard").l1Raw.state).toBe("verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Statut agrégé tri-état (couleur carte) — unit tests PURS
//   Servi = couches cœur complètes · Partiel = au moins une couche servie ·
//   Non couvert = rien de servi.
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCoverageStatus (tri-état agrégé)", () => {
  function statusInput(
    overrides: Partial<CoverageStatusInput> = {},
  ): CoverageStatusInput {
    return {
      l1Raw: "absent",
      l2Graph: "absent",
      signals: "absent",
      l4Zonage: "absent",
      normes: "absent",
      l5Lots: "absent",
      tod: "absent",
      ...overrides,
    };
  }

  it("lots seuls servis → Partiel (declared), jamais gris", () => {
    expect(computeCoverageStatus(statusInput({ l5Lots: "verified" }))).toBe(
      "declared",
    );
  });

  it("toutes les couches cœur servies (PV+signaux+zonage+lots) → Servi (verified)", () => {
    expect(
      computeCoverageStatus(
        statusInput({
          l1Raw: "verified",
          signals: "verified",
          l4Zonage: "verified",
          l5Lots: "verified",
        }),
      ),
    ).toBe("verified");
  });

  it("rien de connu → Non couvert (absent)", () => {
    expect(computeCoverageStatus(statusInput())).toBe("absent");
  });

  it("statuts seulement déclarés (rien de servi) → Non couvert (anti-survente)", () => {
    expect(
      computeCoverageStatus(
        statusInput({ l1Raw: "declared", l4Zonage: "declared" }),
      ),
    ).toBe("absent");
  });

  it("cœur incomplet (zonage servi mais pas lots, ou graphé mais pas lots) → Partiel", () => {
    expect(
      computeCoverageStatus(
        statusInput({ l1Raw: "verified", l4Zonage: "verified" }),
      ),
    ).toBe("declared");
    expect(
      computeCoverageStatus(
        statusInput({ l1Raw: "verified", l2Graph: "verified" }),
      ),
    ).toBe("declared");
  });

  it("couche annexe seule servie (TOD ou normes) → Partiel", () => {
    expect(computeCoverageStatus(statusInput({ tod: "verified" }))).toBe(
      "declared",
    );
    expect(computeCoverageStatus(statusInput({ normes: "verified" }))).toBe(
      "declared",
    );
  });

  it("couches annexes absentes (normes/TOD épars) ne bloquent JAMAIS le Servi", () => {
    expect(
      computeCoverageStatus(
        statusInput({
          l1Raw: "verified",
          signals: "verified",
          l4Zonage: "verified",
          l5Lots: "verified",
          normes: "absent",
          tod: "absent",
        }),
      ),
    ).toBe("verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Détail grilles par ville (lazy, live geo)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/source/coverage/:citySlug/grilles", () => {
  function grillesApp(fetchImpl: typeof fetch): ReturnType<typeof sourceCoverageRoute> {
    return sourceCoverageRoute({
      store: makeMemStore(),
      now: NOW,
      fetchImpl,
    });
  }

  function collectionResponse(features: unknown[], numberMatched?: number): Response {
    return new Response(
      JSON.stringify({ type: "FeatureCollection", features, numberMatched }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  function collectionsFetch(
    zones: unknown[],
    normes: unknown[] | null,
    zoneMatched?: number,
    normesMatched?: number,
  ): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("qc-zonage-norms-")) {
        return normes === null
          ? new Response("{}", { status: 404 })
          : collectionResponse(normes, normesMatched);
      }
      return collectionResponse(zones, zoneMatched);
    }) as unknown as typeof fetch;
  }

  it("counts each evidence kind once per served zone and ignores unmatched codes", async () => {
    const fetchImpl = collectionsFetch(
      [
        {
          properties: { zone_code: "H-1", URL_GRILLE: "https://x/g.pdf", usages: ["h1"] },
        },
        { properties: { zone_code: "H–2" } },
        { properties: { zone_code: "C-3" } },
        { properties: { zone_code: "A-4" } },
      ],
      [
        { properties: { zone_code: "h-2", reglement_url: "https://x/r.pdf" } },
        { properties: { zone_code: "C–3", densite_value: "35,5" } },
        { properties: { zone_code: "X-9", reglement_numero: "unmatched" } },
      ],
      4,
    );
    const app = grillesApp(fetchImpl);
    const res = await app.request(
      "/api/source/coverage/saint-hippolyte/grilles",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CityGrillesResponse;
    expect(body).toMatchObject({
      citySlug: "saint-hippolyte",
      available: true,
      zoneCount: 4,
      numberMatched: 4,
      complete: true,
      zonesWithGrille: 1,
      zonesWithLegacyNormes: 1,
      zonesWithReglement: 1,
      zonesWithNormativeValues: 1,
      covered: 3,
      state: "declared",
    });
    expect(body).not.toHaveProperty("effet_densifiant");
  });

  it("verifies only when every served zone is covered by a complete measurement", async () => {
    const fetchImpl = collectionsFetch(
      [{ properties: { zone_code: "H-1" } }, { properties: { zone_code: "H-2" } }],
      [{ properties: { zone_code: "H-1", reglement_url: "https://x/1" } },
        { properties: { zone_code: "H-2", densite_value: 40 } }],
    );

    const res = await grillesApp(fetchImpl).request(
      "/api/source/coverage/ville-a/grilles",
    );
    expect((await res.json()) as CityGrillesResponse).toMatchObject({
      complete: true,
      covered: 2,
      state: "verified",
    });
  });

  it("keeps incomplete zero-evidence measurements partial instead of absent", async () => {
    const fetchImpl = collectionsFetch([{ properties: { zone_code: "H-1" } }], null, 2);

    const res = await grillesApp(fetchImpl).request(
      "/api/source/coverage/ville-a/grilles",
    );
    expect((await res.json()) as CityGrillesResponse).toMatchObject({
      zoneCount: 1,
      numberMatched: 2,
      complete: false,
      covered: 0,
      state: "declared",
    });
  });

  it("marks the overall measurement incomplete when auxiliary evidence is truncated", async () => {
    const fetchImpl = collectionsFetch(
      [{ properties: { zone_code: "H-1" } }],
      [{ properties: { zone_code: "H-1", reglement_numero: "901" } }],
      1,
      2,
    );

    const res = await grillesApp(fetchImpl).request(
      "/api/source/coverage/ville-a/grilles",
    );
    expect((await res.json()) as CityGrillesResponse).toMatchObject({
      complete: false,
      covered: 1,
      state: "declared",
    });
  });

  it("treats a limit-sized response without numberMatched as incomplete", async () => {
    const features = Array.from({ length: 10_000 }, (_, index) => ({
      properties: { zone_code: `H-${index}` },
    }));
    const fetchImpl = collectionsFetch(features, null);

    const res = await grillesApp(fetchImpl).request(
      "/api/source/coverage/ville-a/grilles",
    );
    expect((await res.json()) as CityGrillesResponse).toMatchObject({
      zoneCount: 10_000,
      numberMatched: null,
      complete: false,
      state: "declared",
    });
  });

  it("distinguishes business absence, malformed geo and unavailable geo", async () => {
    const notFound = vi.fn(async () =>
      new Response("{}", { status: 404 }),
    ) as unknown as typeof fetch;
    const res404 = await grillesApp(notFound).request(
      "/api/source/coverage/ville-sans-zonage/grilles",
    );
    expect(res404.status).toBe(200);
    expect((await res404.json()) as CityGrillesResponse).toMatchObject({
      available: true,
      zoneCount: 0,
      numberMatched: 0,
      complete: true,
      state: "absent",
    });
    expect(notFound).toHaveBeenCalledTimes(1);

    const resDown = await grillesApp(offlineFetch).request(
      "/api/source/coverage/ville-x/grilles",
    );
    expect(resDown.status).toBe(200);
    expect((await resDown.json()) as CityGrillesResponse).toMatchObject({
      citySlug: "ville-x",
      available: false,
      error: "geo-unreachable",
    });

    const serverError = vi.fn(async () =>
      new Response("unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    const res503 = await grillesApp(serverError).request(
      "/api/source/coverage/ville-503/grilles",
    );
    expect((await res503.json()) as CityGrillesResponse).toMatchObject({
      available: false,
      error: "geo-unreachable",
    });

    const malformed = vi.fn(async () =>
      new Response(JSON.stringify({ numberMatched: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const malformedRes = await grillesApp(malformed).request(
      "/api/source/coverage/ville-malformee/grilles",
    );
    expect((await malformedRes.json()) as CityGrillesResponse).toEqual({
      citySlug: "ville-malformee",
      available: false,
      error: "invalid-response",
    });
  });

  it("caches the per-city result (TTL) and rejects malformed slugs", async () => {
    const fetchImpl = collectionsFetch(
      [{ properties: { zone_code: "H-1" } }],
      null,
    );
    const app = grillesApp(fetchImpl);
    await app.request("/api/source/coverage/ville-a/grilles");
    await app.request("/api/source/coverage/ville-a/grilles");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const bad = await app.request(
      "/api/source/coverage/Ville%20Pas%20Slug/grilles",
    );
    expect(bad.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Détail champs LOT enrichis par ville (lazy, live geo)
// ─────────────────────────────────────────────────────────────────────────────

interface CityLotFieldsBody {
  citySlug: string;
  available: boolean;
  totalLots?: number | null;
  sampleSize?: number;
  sampled?: boolean;
  fields?: Record<
    "superficie" | "adresse" | "codePostal" | "normes",
    { count: number; pct: number; state: string }
  >;
  state?: string;
}

describe("GET /api/source/coverage/:citySlug/lot-fields", () => {
  function lotFieldsApp(
    fetchImpl: typeof fetch,
  ): ReturnType<typeof sourceCoverageRoute> {
    return sourceCoverageRoute({
      store: makeMemStore(),
      now: NOW,
      fetchImpl,
    });
  }

  /** fetch items servant `count` lots identiques + numberMatched. */
  function lotsFetch(
    properties: Record<string, unknown>,
    total: number,
  ): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://geo.test");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "0");
      const count = Math.max(0, Math.min(limit, total - offset));
      return new Response(
        JSON.stringify({
          type: "FeatureCollection",
          features: Array.from({ length: count }, () => ({ properties })),
          numberMatched: total,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  }

  it("ville enrichie (Delson-like) : les 4 champs à 100 % → verified", async () => {
    const app = lotFieldsApp(
      lotsFetch(
        {
          surface_m2: 6116.71,
          adresse: "225 chemin Saint-Francois-Xavier",
          code_postal: "J5B",
          densite_value: 45,
        },
        300,
      ),
    );
    const res = await app.request("/api/source/coverage/delson/lot-fields");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CityLotFieldsBody;
    expect(body).toMatchObject({
      citySlug: "delson",
      available: true,
      totalLots: 300,
      sampleSize: 300,
      sampled: false,
      state: "verified",
    });
    expect(body.fields?.superficie).toMatchObject({ pct: 100, state: "verified" });
    expect(body.fields?.adresse).toMatchObject({ pct: 100, state: "verified" });
    expect(body.fields?.codePostal).toMatchObject({ pct: 100, state: "verified" });
    expect(body.fields?.normes).toMatchObject({ pct: 100, state: "verified" });
  });

  it("ville non enrichie (Mont-Tremblant-like) : 0 % partout → absent, échantillon déclaré", async () => {
    const app = lotFieldsApp(lotsFetch({ NO_LOT: "1 234 567" }, 9000));
    const res = await app.request(
      "/api/source/coverage/mont-tremblant/lot-fields",
    );
    const body = (await res.json()) as CityLotFieldsBody;
    expect(body).toMatchObject({
      available: true,
      totalLots: 9000,
      sampleSize: 450, // échantillon stratifié borné, jamais 9000 fetchés
      sampled: true,
      state: "absent",
    });
    expect(body.fields?.superficie).toMatchObject({ pct: 0, state: "absent" });
    expect(body.fields?.adresse).toMatchObject({ pct: 0, state: "absent" });
  });

  it("geo injoignable → available:false (jamais un faux 0 %), 404 → zéros honnêtes", async () => {
    const resDown = await lotFieldsApp(offlineFetch).request(
      "/api/source/coverage/ville-x/lot-fields",
    );
    expect((await resDown.json()) as CityLotFieldsBody).toMatchObject({
      citySlug: "ville-x",
      available: false,
    });

    const notFound = vi.fn(async () =>
      new Response("nf", { status: 404 }),
    ) as unknown as typeof fetch;
    const res404 = await lotFieldsApp(notFound).request(
      "/api/source/coverage/ville-sans-lots/lot-fields",
    );
    expect((await res404.json()) as CityLotFieldsBody).toMatchObject({
      available: true,
      totalLots: 0,
      state: "absent",
    });
  });

  it("cache le résultat per-city (TTL) et rejette les slugs malformés", async () => {
    const fetchImpl = lotsFetch({ surface_m2: 100 }, 50);
    const app = lotFieldsApp(fetchImpl);
    await app.request("/api/source/coverage/ville-a/lot-fields");
    await app.request("/api/source/coverage/ville-a/lot-fields");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const bad = await app.request(
      "/api/source/coverage/Ville%20Pas%20Slug/lot-fields",
    );
    expect(bad.status).toBe(404);
  });

  it("bulk lotFields: absent par défaut, reprend la mesure lazy chaude (jamais de fetch per-city au bulk)", async () => {
    // fetch qui sert le LISTING (collections) ET les items lots.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/items")) {
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              { properties: { surface_m2: 500, adresse: "1 rue A", code_postal: "J5B" } },
              { properties: { surface_m2: 300 } }, // sans adresse/CP/normes
            ],
            numberMatched: 2,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ collections: [{ id: "qc-lots-delson" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const app = sourceCoverageRoute({
      store: makeMemStore(),
      db: makeDb([]),
      now: NOW,
      fetchImpl,
    });

    // Cache froid : cellule bulk `absent` (jamais mesuré en bulk).
    const cold = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    expect(cityOf(cold, "delson").lotFields.state).toBe("absent");

    // Mesure lazy per-city (partielle → declared)…
    const lazy = await app.request("/api/source/coverage/delson/lot-fields");
    expect(((await lazy.json()) as CityLotFieldsBody).state).toBe("declared");

    // …reprise par le bulk tant qu'elle est chaude.
    const warm = (await (
      await app.request("/api/source/coverage")
    ).json()) as CoverageResponse;
    expect(cityOf(warm, "delson").lotFields).toMatchObject({
      state: "declared",
      freshness: "fresh",
    });
    // Les autres villes restent absent (pas de mesure).
    expect(cityOf(warm, "brossard").lotFields.state).toBe("absent");
  });
});

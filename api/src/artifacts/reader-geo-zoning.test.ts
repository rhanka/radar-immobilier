/**
 * J1 zonage — `geo.collection-items.v1` serving the real Signaux zoning layer
 * through the closed zoning projection (field review j1-2b §7, §0.4, §13).
 *
 * Fixtures `api/tests/fixtures/zonage-parity/<city>.raw.json` are verbatim
 * public OGC items + the verbatim listing entry observed 2026-11-05. The
 * listing entry carries NO `rights` (true of every city zoning collection on
 * that date): tests that need a served collection inject `rights` explicitly
 * — the unblocked state — and one test proves the verbatim entry is refused.
 *
 * The paged reader output is pinned as a file snapshot
 * (`<city>.reader-pages.json`) that the UI parity test
 * (`ui/src/lib/maps/zones-reader-transport.test.ts`) replays through the
 * real app normaliser.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { createGeoReaderBudget } from "./reader-geo-budget.js";
import {
  GeoItemsRefusal,
  createGeoReadOperation,
  readReaderCollectionItems,
  type ReaderCollectionItemsResponse,
  type ReaderGeoDeps,
} from "./reader-geo.js";
import { validateReaderResponse } from "./reader-responses.js";
import { GRANT_SECRET, HOST, ISSUER, SESSION_SECRET, credentials, fixtureReaderDeps, request } from "./reader-test-fixture.js";
import { GOVERNED_SERVED_RECORDS } from "../services/geo/governed-policy.js";
import { GOVERNED_ZONING_RECORDS } from "../services/geo/governed-zoning-records.js";
import {
  ZONING_PROJECTION_FIELDS,
  ZONING_SOURCE_KEY_UNIVERSE,
  projectZoningProperties,
} from "../services/geo/zoning-projection.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../../tests/fixtures/zonage-parity");
const PARITY_CITIES = ["honfleur", "saint-venant-de-paquette"] as const;

interface RawFixture {
  collectionId: string;
  citySlug: string;
  listingEntry: Record<string, unknown>;
  items: { type: string; numberMatched: number; features: Array<{ type: string; geometry: unknown; properties: Record<string, unknown> }> };
}

function loadRaw(city: string): RawFixture {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${city}.raw.json`), "utf8")) as RawFixture;
}

const RIGHTS = { profile: "open", licenseStatus: "explicit" };

/** OGC stub serving a listing and offset/limit-paged items, recording every call. */
function ogcStub(listing: Array<Record<string, unknown>>, items: Record<string, RawFixture["items"]>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname === "/collections") {
      return Response.json({ collections: listing });
    }
    const match = /^\/collections\/([^/]+)\/items$/.exec(url.pathname);
    const body = match ? items[decodeURIComponent(match[1]!)] : undefined;
    if (!body) return new Response(null, { status: 404 });
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "10");
    const page = body.features.slice(offset, offset + limit);
    return Response.json({ type: "FeatureCollection", numberMatched: body.features.length, numberReturned: page.length, features: page });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function deps(fetchImpl: typeof fetch): ReaderGeoDeps {
  return { fetchImpl, baseUrl: "https://geo.example", contractEnv: {} };
}

async function readAllPages(d: ReaderGeoDeps, collectionId: string, limit: number): Promise<ReaderCollectionItemsResponse[]> {
  const pages: ReaderCollectionItemsResponse[] = [];
  let offset: number | null = 0;
  while (offset !== null && pages.length < 50) {
    const page = await readReaderCollectionItems(d, collectionId, { limit, offset });
    // Every page must pass the strict dispatch response schema.
    validateReaderResponse("geo.collection-items.v1", page, "reader-alice");
    pages.push(page);
    offset = page.nextOffset;
  }
  return pages;
}

describe("J1 zonage records", () => {
  it("records only known-licence city zoning collections with a code source key", () => {
    expect(GOVERNED_ZONING_RECORDS.length).toBe(68);
    for (const record of GOVERNED_ZONING_RECORDS) {
      expect(record.collectionId).toMatch(/^qc-zonage-[a-z0-9-]+$/);
      expect(record.zoning?.projection).toBe("zoning-v1");
      expect(record.servedFields).toEqual(ZONING_PROJECTION_FIELDS);
      expect(["cc-by-4.0", "portneuf-zonage-municipal", "rosemere-zonage-municipal"]).toContain(record.licenseId);
      for (const key of record.zoning?.sourceKeys ?? []) {
        expect(ZONING_SOURCE_KEY_UNIVERSE.has(key) || key === "proof" || key === "immo_zone_lot_provenance", key).toBe(true);
      }
    }
    expect(GOVERNED_ZONING_RECORDS.map((r) => r.collectionId)).not.toContain("qc-zonage-salaberry-de-valleyfield");
    expect(GOVERNED_SERVED_RECORDS.filter((r) => r.zoning).length).toBe(68);
  });
});

describe("J1 zonage — parity fixtures through the reader op", () => {
  for (const city of PARITY_CITIES) {
    it(`pins the paged zoning-v1 output for ${city} (limit 5, every feature, same order)`, async () => {
      const raw = loadRaw(city);
      const { fetchImpl } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
      const pages = await readAllPages(deps(fetchImpl), raw.collectionId, 5);
      const features = pages.flatMap((page) => page.features);
      expect(features).toHaveLength(raw.items.features.length);
      expect(pages.every((page) => page.projection === "zoning-v1")).toBe(true);
      expect(pages.at(-1)?.nextOffset).toBeNull();
      expect(pages[0]?.license).toEqual({
        id: "cc-by-4.0",
        title: "Creative Commons Attribution 4.0 International",
        href: "https://creativecommons.org/licenses/by/4.0/",
        attribution: raw.listingEntry["attribution"],
      });
      // Same codes, same order as a straight projection of the raw items.
      const record = GOVERNED_ZONING_RECORDS.find((r) => r.collectionId === raw.collectionId)!;
      expect(features.map((f) => f.properties["code"])).toEqual(
        raw.items.features.map((f) => projectZoningProperties(f.properties, record.zoning!.sourceKeys).code),
      );
      await expect(JSON.stringify(pages, null, 1) + "\n").toMatchFileSnapshot(
        resolve(FIXTURES, `${city}.reader-pages.json`),
      );
    });
  }

  it("refuses the verbatim 2026-11-05 listing entry (no rights) as not covered, before any items call", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl, calls } = ogcStub([raw.listingEntry], { [raw.collectionId]: raw.items });
    const error = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 5 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeoItemsRefusal);
    expect((error as GeoItemsRefusal).status).toBe(403);
    expect((error as GeoItemsRefusal).body).toMatchObject({ status: "not covered", reason: "rights-missing" });
    expect(calls.some((url) => url.includes("/items"))).toBe(false);
  });
});

describe("J1 zonage — licence gate", () => {
  it("refuses an unknown-licence city collection (Valleyfield) with no upstream call", async () => {
    const { fetchImpl, calls } = ogcStub(
      [{ id: "qc-zonage-salaberry-de-valleyfield", license: { title: "Unknown license" } }],
      {},
    );
    const error = await readReaderCollectionItems(deps(fetchImpl), "qc-zonage-salaberry-de-valleyfield", { limit: 5 })
      .catch((e: unknown) => e) as GeoItemsRefusal;
    expect(error.status).toBe(403);
    expect(error.body).toMatchObject({ status: "not covered", reason: "no-dated-per-collection-record" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a recorded collection whose live licence turned unknown, before any items call", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl, calls } = ogcStub(
      [{ ...raw.listingEntry, license: { title: "Unknown license" }, rights: RIGHTS }],
      { [raw.collectionId]: raw.items },
    );
    const error = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 5 })
      .catch((e: unknown) => e) as GeoItemsRefusal;
    expect(error.status).toBe(403);
    expect(error.body).toMatchObject({ status: "unknown" });
    expect(calls.some((url) => url.includes("/items"))).toBe(false);
  });
});

describe("J1 zonage — closed field projection", () => {
  const TRAPS = {
    zone_code: "  H-12  ",
    ZONE: "Z-OTHER",
    kind: "habitation",
    affectation: "Résidentielle",
    usages: "h1, h2 ,",
    reglement_millesime: 2019,
    reglement_numero: "19-200",
    reglement_url: "https://ville.example.ca/reglements/zonage.pdf",
    URL_Grille: "https://user:secret@ville.example.ca/grille.pdf",
    adresse: "123 rue Principale",
    code_postal: "J0S 1A0",
    extrait_brut: "M. Tremblay demande…",
    url_pdf: "https://ville.example.ca/pv.pdf",
    rawRef: "raw/2026/x.pdf",
    zone_source_url: "https://services.arcgis.com/x/query?where=1%3D1&token=abc",
    OBJECTID: 7,
    densite_apres: 40,
  };

  it("emits the closed keys only, from recorded source keys only", () => {
    const out = projectZoningProperties(TRAPS, [
      "zone_code", "ZONE", "kind", "affectation", "usages", "reglement_millesime", "reglement_numero", "reglement_url", "URL_Grille",
      "adresse", "rawRef", "zone_source_url",
    ]);
    expect(out).toEqual({
      code: "H-12",
      kind: "habitation",
      affectation: "Résidentielle",
      usages: ["h1", "h2"],
      reglementMillesime: "2019",
      reglementNumero: "19-200",
      reglementUrl: "https://ville.example.ca/reglements/zonage.pdf",
      // URL_Grille carries credentials: dropped, never rewritten.
    });
    const text = JSON.stringify(out);
    for (const leaked of ["Principale", "J0S", "Tremblay", "raw/2026", "token=abc", "secret"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("never reads a raw key absent from the record (code falls through the UI order)", () => {
    expect(projectZoningProperties(TRAPS, ["ZONE"])).toEqual({ code: "Z-OTHER" });
    expect(projectZoningProperties(TRAPS, [])).toEqual({});
    expect(projectZoningProperties({ ETIQUETTE: "4052  C03", NUM_ZONE: 4052 }, ["ETIQUETTE", "NUM_ZONE"])).toEqual({ code: "C03" });
  });

  it("serves trap-laden live items without any trap value, and honours the fields param", async () => {
    const raw = loadRaw("honfleur");
    const trapped = {
      ...raw.items,
      features: raw.items.features.slice(0, 3).map((feature) => ({
        ...feature,
        geometry: { ...(feature.geometry as object), crs: "urn:x", extra: "leak" },
        properties: { ...feature.properties, ...TRAPS, zone_code: feature.properties["zone_code"] },
      })),
    };
    const { fetchImpl } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: trapped });
    const page = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 5 });
    const allowed = new Set<string>([...ZONING_PROJECTION_FIELDS, "proof", "immo_zone_lot_provenance"]);
    for (const feature of page.features) {
      for (const key of Object.keys(feature.properties)) expect(allowed.has(key), key).toBe(true);
      expect(Object.keys(feature.geometry as object).sort()).toEqual(["coordinates", "type"]);
    }
    const text = JSON.stringify(page);
    for (const leaked of ["Principale", "J0S", "Tremblay", "raw/2026", "token=abc", "secret", "leak", "densite"]) {
      expect(text).not.toContain(leaked);
    }

    const narrow = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 5, fields: ["code", "kind"] });
    for (const feature of narrow.features) {
      expect(Object.keys(feature.properties).every((key) => key === "code" || key === "kind")).toBe(true);
    }
  });

  it("refuses a field outside the served set before any upstream call", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl, calls } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
    const error = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 5, fields: ["code", "adresse"] })
      .catch((e: unknown) => e) as GeoItemsRefusal;
    expect(error.status).toBe(400);
    expect(error.body).toMatchObject({ error: "geo_field_not_served" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a zoning-v1 page carrying a non-projection key at the response schema", () => {
    expect(() => validateReaderResponse("geo.collection-items.v1", {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: { code: "A-1", adresse: "x" } }],
      numberMatched: 1, numberReturned: 1, truncated: false, nextOffset: null, projection: "zoning-v1",
      collectionId: "qc-zonage-honfleur", licenseId: "cc-by-4.0",
      license: { id: "cc-by-4.0", title: "t", href: null, attribution: null },
      contract: { status: "missing source", reason: "x" },
    }, "reader-alice")).toThrow();
  });
});

describe("J1 zonage — bounds and pagination", () => {
  it("keeps the 200-without-bbox bound and pages with nextOffset", async () => {
    const raw = loadRaw("saint-venant-de-paquette");
    const { fetchImpl, calls } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
    const refused = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 201 })
      .catch((e: unknown) => e) as GeoItemsRefusal;
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "geo_bbox_required" });
    expect(calls).toHaveLength(0);

    const first = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 10 });
    expect(first).toMatchObject({ numberMatched: 16, numberReturned: 10, nextOffset: 10, truncated: true });
    const second = await readReaderCollectionItems(deps(fetchImpl), raw.collectionId, { limit: 10, offset: 10 });
    expect(second).toMatchObject({ numberMatched: 16, numberReturned: 6, nextOffset: null });
  });

  it("caps a page at 1 MiB and resumes from nextOffset without losing a feature", async () => {
    const raw = loadRaw("honfleur");
    const ring = Array.from({ length: 4_000 }, (_, i) => [-71 + i * 1e-6, 46.8 + (i % 2) * 1e-6]);
    const heavy = {
      ...raw.items,
      features: Array.from({ length: 12 }, (_, i) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { zone_code: `Z-${i}` },
      })),
    };
    const { fetchImpl } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: heavy });
    const pages = await readAllPages(deps(fetchImpl), raw.collectionId, 12);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(Buffer.byteLength(JSON.stringify(page.features))).toBeLessThanOrEqual(1024 * 1024);
    expect(pages.flatMap((p) => p.features.map((f) => f.properties["code"]))).toEqual(
      Array.from({ length: 12 }, (_, i) => `Z-${i}`),
    );
  });
});

// ── Dispatch: strict query, budget (§0.4, §13) ────────────────────────────
const FINGERPRINT = fingerprintReaderProfile({
  name: "demo",
  policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"],
});

async function aliceGrant(): Promise<string> {
  return mintGrant(
    {
      ...ISSUER,
      host: HOST,
      artifactId: "123e4567-e89b-12d3-a456-426614174000",
      releaseId: "123e4567-e89b-12d3-a456-426614174001",
      readerSub: "reader-alice",
      sessionId: "session-1",
      profileName: "demo",
      policyRevision: "pol-001",
      profileFingerprint: FINGERPRINT,
    },
    GRANT_SECRET,
    1_000,
  );
}

function dispatchApp(fetchImpl: typeof fetch, budgetLimit = 30) {
  const operation = vi.fn(createGeoReadOperation(deps(fetchImpl)));
  const app = createReaderContentApp({
    ...fixtureReaderDeps(),
    readOperation: operation as NonNullable<Parameters<typeof createReaderContentApp>[0]["readOperation"]>,
    contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET,
    sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    now: () => 1_000,
    geoBudget: createGeoReaderBudget(budgetLimit),
  });
  return { app, operation };
}

describe("J1 zonage — dispatch on the content host", () => {
  it("serves a zoning-v1 page with the licence record to an approved reader", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
    const { app } = dispatchApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const res = await request(app, `/__reader/api/geo.collection-items.v1?collectionId=${raw.collectionId}&limit=200&fields=code,kind,affectation`, cookie, await aliceGrant());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json() as ReaderCollectionItemsResponse;
    expect(body).toMatchObject({ projection: "zoning-v1", numberReturned: 16, nextOffset: null, licenseId: "cc-by-4.0" });
    expect(body.license.attribution).toBe(raw.listingEntry["attribution"]);
  });

  it("refuses unknown and duplicated query keys locally, without calling the operation", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl, calls } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
    const { app, operation } = dispatchApp(fetchImpl);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    for (const query of [
      `collectionId=${raw.collectionId}&limit=5&city=honfleur`,
      `collectionId=${raw.collectionId}&limit=5&limit=6`,
      `collectionId=${raw.collectionId}&offset=100001`,
      `collectionId=${raw.collectionId}&fields=code;kind`,
    ]) {
      const res = await request(app, `/__reader/api/geo.collection-items.v1?${query}`, cookie, grant);
      expect(res.status, query).toBe(400);
    }
    expect(operation).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("answers 429 with Retry-After past the per-reader budget; refusals count", async () => {
    const raw = loadRaw("honfleur");
    const { fetchImpl } = ogcStub([{ ...raw.listingEntry, rights: RIGHTS }], { [raw.collectionId]: raw.items });
    const { app, operation } = dispatchApp(fetchImpl, 3);
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await aliceGrant();
    // Two refused probes (unknown key, not-covered collection) spend budget.
    expect((await request(app, `/__reader/api/geo.collection-items.v1?collectionId=${raw.collectionId}&x=1`, cookie, grant)).status).toBe(400);
    expect((await request(app, "/__reader/api/geo.collection-items.v1?collectionId=qc-zonage-nowhere&limit=5", cookie, grant)).status).toBe(403);
    expect((await request(app, `/__reader/api/geo.collection-items.v1?collectionId=${raw.collectionId}&limit=5`, cookie, grant)).status).toBe(200);
    const calledBefore = operation.mock.calls.length;
    const limited = await request(app, `/__reader/api/geo.collection-items.v1?collectionId=${raw.collectionId}&limit=5`, cookie, grant);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect(operation.mock.calls.length).toBe(calledBefore);
    // geo.cities.v1 is not under this budget.
    expect((await request(app, "/__reader/api/geo.cities.v1", cookie, grant)).status).toBe(200);
  });
});

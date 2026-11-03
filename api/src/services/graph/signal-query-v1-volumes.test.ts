/**
 * I-0 volume measurements on a production-like corpus in an isolated
 * synthetic database.
 *
 * Corpus: deterministic seed (mulberry32, seed below) at production-like
 * scale — the 127 province-wide slugs of the committed vivier-B denominator
 * reproduction (`scripts/cohorte-vivier-b/cohorte-vivier-b-6mo.slugs.tsv`,
 * dump 2026-08-06 vintage) plus the pilot city as the heavy city (914
 * signals, the documented "mur"), realistic JSON props (categories,
 * descriptions, stages, zone refs, 1-3 dated refs), relational lots per
 * city, and basket heads on the heavy city. The measured numbers below set
 * the I-2 thresholds and the D-C membership cap.
 *
 * Isolation: everything lives in a throwaway database (CREATE DATABASE +
 * full migrations, dropped in `afterAll` by the scope-db-fixture harness),
 * so no concurrent suite on the shared test DB can observe these rows.
 * When POSTGRES_HOST is unset (host runs without the stack) the DB section
 * is skipped; the committed volumes file remains the record.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { graphNodes, lotVersions } from "../../db/schema.js";
import {
  getSignalNodesForCity,
  listCitiesWithSignalNodes,
} from "../graph/graph-store.js";
import {
  activation,
  attach,
  fixture,
  safety,
} from "../facets/scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "../facets/activation-run.js";
import { writeFacet } from "../facets/writer.js";
import { targetFingerprint } from "../facets/target.js";
import { searchSignalClassifications } from "../facets/classification-search.js";
import type { ObjectStore } from "../../storage/object-store.js";

const VOLUMES_PATH = "tests/fixtures/signals-query-v1/volumes.json";

/** Deterministic seed: the whole corpus derives from this number alone. */
const SEED = 20261103;
/** Pilot city holds the documented "mur" (heavy-city wall). */
const HEAVY_CITY = "valleyfield";
const HEAVY_SIGNALS = 914;
/** Cohort file: committed province-wide denominator (127 slugs, no header). */
const COHORT_TSV = "../scripts/cohorte-vivier-b/cohorte-vivier-b-6mo.slugs.tsv";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cohortCities(): string[] {
  const slugs = readFileSync(COHORT_TSV, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /^[a-z0-9-]+$/.test(line));
  expect(slugs.length).toBeGreaterThan(100);
  return [HEAVY_CITY, ...slugs.filter((slug) => slug !== HEAVY_CITY)];
}

const CATEGORIES = ["rezonage", "piia", "derogation", "refonte", "ppcmoi", null] as const;
const ETAPES = ["avis_motion", "projet_reglement", "consultation_publique", "second_projet", "adoption"] as const;
const DESCRIPTIONS = [
  "Projet de 12 logements en zone H-101",
  "PIIA secteur centre sans projet residentiel",
  "Derogation mineure sur marge laterale",
  "Refonte complete du reglement de zonage",
  "PPCMOI pour 8 logements et usage mixte",
  "Entrepot industriel en zone I-93",
  "Ecole primaire et habitation de 6 logements",
  "Consultation publique sur le plan d'urbanisme",
] as const;

interface CorpusCounts {
  cities: string[];
  perCity: number[];
  total: number;
  zoneCodes: Set<string>;
  lotRefs: Set<string>;
}

function buildCorpus(): CorpusCounts {
  const rand = mulberry32(SEED);
  const cities = cohortCities();
  const perCity = cities.map((city, index) => {
    if (city === HEAVY_CITY) return HEAVY_SIGNALS;
    void index;
    return 1 + Math.floor(50 * Math.pow(rand(), 1.6));
  });
  return {
    cities,
    perCity,
    total: perCity.reduce((sum, n) => sum + n, 0),
    zoneCodes: new Set(),
    lotRefs: new Set(),
  };
}

function civilDay(base: Date, offsetDays: number): string {
  const date = new Date(base.getTime() + offsetDays * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function signalProps(
  rand: () => number,
  cityIndex: number,
  signalIndex: number,
  corpus: CorpusCounts,
): Record<string, unknown> {
  const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
  const description = signalIndex === 0
    ? "x".repeat(4000)
    : DESCRIPTIONS[Math.floor(rand() * DESCRIPTIONS.length)] as string;
  const refsCount = 1 + Math.floor(rand() * 3);
  const anchor = new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 640) * 86400000);
  const refs = Array.from({ length: refsCount }, (_, refIndex) => {
    const documentDate = civilDay(anchor, refIndex);
    return {
      documentDate: { status: "known", precision: "day", value: documentDate },
      publishedAt: documentDate,
      fetchedAt: `${civilDay(anchor, refIndex + 1)}T10:00:00Z`,
      excerpt: `extrait de preuve ${cityIndex}-${signalIndex}-${refIndex} avec quatre logements`,
    };
  });
  const props: Record<string, unknown> = {
    properties: {
      category,
      description,
      etape: ETAPES[Math.floor(rand() * ETAPES.length)],
      instrument: ["rezonage", "piia", "derogation", "refonte", "ppcmoi", "autre"][Math.floor(rand() * 6)],
      nb_unites_max: rand() < 0.3 ? 1 + Math.floor(rand() * 24) : null,
      refs,
    },
  };
  if (rand() < 0.6) {
    const zone = `${rand() < 0.7 ? "H" : "R"}-${101 + Math.floor(rand() * 400)}`;
    (props.properties as Record<string, unknown>).zone_ref = zone;
    corpus.zoneCodes.add(zone);
  }
  if (rand() < 0.4) {
    const lot = `${1000000 + Math.floor(rand() * 8999999)}`;
    (props.properties as Record<string, unknown>).lot_ref = lot;
    corpus.lotRefs.add(lot);
  }
  return props;
}

/** Read-only memory store: docs are absent, cards degrade (measured path). */
class MemoryStore implements ObjectStore {
  async get(_key: string): Promise<Uint8Array> {
    throw new Error("no such object");
  }
  async head(_key: string) {
    return null;
  }
  async put(key: string, _body: Uint8Array | Buffer | string) {
    return { key, etag: `"${randomUUID()}"`, size: 0 };
  }
}

describe("signal-query-v1 volumes", () => {
  it("should measure a production-like corpus: signals, lots, detail, baskets", async () => {
    if (!process.env.POSTGRES_HOST) return;
    const corpus = buildCorpus();
    // Production-like scale gate: the corpus must stay at commented-corpus
    // scale (~3.3k), never shrink back to a proof-of-concept handful.
    expect(corpus.total).toBeGreaterThanOrEqual(3000);
    expect(corpus.perCity[corpus.cities.indexOf(HEAVY_CITY)]).toBe(HEAVY_SIGNALS);

    const f = await fixture();
    const { db } = f;
    {
      const rand = mulberry32(SEED);
      const heavyNodes: Array<typeof graphNodes.$inferSelect> = [];
      for (let cityIndex = 0; cityIndex < corpus.cities.length; cityIndex += 1) {
        const city = corpus.cities[cityIndex]!;
        const signals = corpus.perCity[cityIndex]!;
        for (let chunk = 0; chunk < signals; chunk += 250) {
          const rows = Array.from(
            { length: Math.min(250, signals - chunk) },
            (_, offset) => {
              const signalIndex = chunk + offset;
              return {
                id: `i0m-${city}-${String(signalIndex).padStart(4, "0")}`,
                type: "Signal",
                label: `I-0 volume signal ${city} ${signalIndex}`,
                citySlug: city,
                props: signalProps(rand, cityIndex, signalIndex, corpus),
                sourceRef: null as string | null,
              };
            },
          );
          const inserted = await db.insert(graphNodes).values(rows).returning();
          if (city === HEAVY_CITY) heavyNodes.push(...inserted);
        }
        const lots = Math.max(1, Math.floor(signals * 0.7));
        for (let chunk = 0; chunk < lots; chunk += 250) {
          await db.insert(lotVersions).values(
            Array.from({ length: Math.min(250, lots - chunk) }, (_, offset) => {
              const lotIndex = chunk + offset;
              return {
                canonicalId: `i0m-${city}-lot-${String(lotIndex).padStart(4, "0")}`,
                noLot: `${1000000 + cityIndex * 10000 + lotIndex}`,
                citySlug: city,
                validFrom: "2024-01-01",
                knownFrom: new Date(Date.UTC(2026, 0, 1)),
                rawRef: `raw/i0m/${city}/${lotIndex}`,
                evidence: [],
              };
            }),
          );
        }
      }

      const aggregateStart = Date.now();
      const cities = await listCitiesWithSignalNodes(db);
      const aggregateMs = Date.now() - aggregateStart;
      const measured = cities.filter((row) => corpus.cities.includes(row.citySlug));
      expect(measured.length).toBe(corpus.cities.length);

      const fanoutStart = Date.now();
      let maxPerCity = 0;
      let heavyRows = 0;
      let heavyJsonBytes = 0;
      for (const city of corpus.cities) {
        const rows = await getSignalNodesForCity(db, city);
        if (rows.length > maxPerCity) maxPerCity = rows.length;
        if (city === HEAVY_CITY) {
          heavyRows = rows.length;
          heavyJsonBytes = Buffer.byteLength(JSON.stringify(rows));
        }
      }
      const fanoutMs = Date.now() - fanoutStart;
      expect(maxPerCity).toBe(HEAVY_SIGNALS);
      expect(heavyRows).toBe(HEAVY_SIGNALS);

      const lotsStart = Date.now();
      // Isolated database: every lot row here comes from the seed below.
      const lotCounts = await db
        .select({ citySlug: lotVersions.citySlug, lots: count() })
        .from(lotVersions)
        .groupBy(lotVersions.citySlug);
      const lotsMs = Date.now() - lotsStart;
      const maxLotsPerCity = Math.max(...lotCounts.map((row) => Number(row.lots)));
      const totalLots = lotCounts.reduce((sum, row) => sum + Number(row.lots), 0);
      expect(totalLots).toBeGreaterThan(1000);

      const headsStart = Date.now();
      const pertinent = heavyNodes.slice(0, 40);
      const watched = heavyNodes.slice(40, 60);
      for (const node of pertinent) {
        await writeFacet(db, f.member.sub, {
          action: "select", basket: "pertinent",
          target: { citySlug: node.citySlug, type: "Signal" as const, id: node.id },
          displayedFingerprint: targetFingerprint(node),
          expectedHeadId: null, commandKey: randomUUID(),
        });
      }
      for (const node of watched) {
        await writeFacet(db, f.member.sub, {
          action: "select", basket: "a_surveiller",
          target: { citySlug: node.citySlug, type: "Signal" as const, id: node.id },
          displayedFingerprint: targetFingerprint(node),
          expectedHeadId: null, commandKey: randomUUID(),
        });
      }
      await attach(f);
      await runPersonalAttachmentActivation(db, activation(f), safety);
      const basketStart = Date.now();
      const basket = await searchSignalClassifications(
        {
          db,
          store: new MemoryStore(),
          classification: {
            cursorKeyring: { currentKeyId: "i0", keys: new Map([["i0", randomBytes(32)]]) },
          },
        },
        f.member.sub,
        f.workspaceId,
        {
          citySlug: HEAVY_CITY,
          basket: "all",
          archive: "exclude",
          personalHistory: "any",
          dateBasis: "document",
          sort: "freshness_desc",
          limit: 100,
        },
      );
      const basketMs = Date.now() - basketStart;
      const headsMs = Date.now() - headsStart;
      expect(headsMs).toBeGreaterThan(basketMs);
      expect(basket.counts.matched).toBeGreaterThan(0);

      // Membership unions measured on the seeded truth (zone refs + lot refs
      // carried by the corpus signals).
      const measuredZones = corpus.zoneCodes.size;
      const measuredLotRefs = corpus.lotRefs.size;
      expect(corpus.total).toBeLessThanOrEqual(10000);
      expect(measuredZones).toBeLessThanOrEqual(1000);
      expect(measuredLotRefs).toBeLessThanOrEqual(5000);

      const record = {
        seed: SEED,
        cohort: "scripts/cohorte-vivier-b/cohorte-vivier-b-6mo.slugs.tsv (127 slugs, dump 2026-08-06 vintage)",
        note: "UI today loads the full visible population of one city with raw props, no limit or cursor; all-cities opens one such read per city with signals.",
        cities: corpus.cities.length,
        heavyCity: HEAVY_CITY,
        totalSignals: corpus.total,
        maxPerCity,
        totalLots,
        maxLotsPerCity,
        distinctZoneCodes: measuredZones,
        distinctSignalLotRefs: measuredLotRefs,
        heavyDetail: { rows: heavyRows, jsonBytes: heavyJsonBytes },
        timings: { aggregateMs: 0, fanoutMs: 0, lotsMs: 0, headsMs: 0, basketMs: 0 },
        basketMatched: basket.counts.matched,
      };
      const bytes = `${JSON.stringify(record, null, 2)}\n`;
      let expected: string;
      try {
        expected = `${readFileSync(VOLUMES_PATH, "utf8")}`;
      } catch {
        mkdirSync(VOLUMES_PATH.slice(0, VOLUMES_PATH.lastIndexOf("/")), { recursive: true });
        writeFileSync(VOLUMES_PATH, bytes);
        expected = bytes;
      }
      const freeze = (value: typeof record) => ({ ...value, timings: { aggregateMs: 0, fanoutMs: 0, lotsMs: 0, headsMs: 0, basketMs: 0 } });
      expect(freeze(record)).toEqual(freeze(JSON.parse(expected) as typeof record));
      expect(aggregateMs).toBeLessThan(15000);
      expect(fanoutMs).toBeLessThan(60000);
      expect(lotsMs).toBeLessThan(15000);
      expect(basketMs).toBeLessThan(30000);
    }
  }, 300000);
});

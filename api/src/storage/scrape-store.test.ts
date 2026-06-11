/**
 * scrape-store.test.ts
 *
 * Verifies that:
 *  1. `resolveScrapeS3Config` falls back to S3_* values when SCRAPE_S3_* are absent.
 *  2. `resolveScrapeS3Config` uses SCRAPE_S3_* overrides when all are present.
 *  3. Partial overrides (only bucket + endpoint) are resolved correctly.
 *  4. The pipeline executor writes raw scraped documents to the scrapeStore when
 *     one is provided, while project-state stays on the main objectStore.
 *  5. Without a scrapeStore, the executor falls back to the main objectStore for
 *     raw docs (MinIO local default — unchanged behaviour).
 *
 * No real S3 / SCW network calls are made. All stores are in-memory mocks.
 */

import { describe, expect, it } from "vitest";

import {
  AVIS_PUBLICS_FIXTURE_HTML,
  AVIS_PUBLICS_SOURCE_ID,
  roleEvaluationMamhValleyfieldXml,
  createAvisPublicsValleyfieldAdapter,
  createRoleEvaluationMamhAdapter,
  roleSourceId,
  type FetchLike,
} from "@radar/sources";

import { loadConfig, resolveScrapeS3Config } from "../config.js";
import type { ObjectInfo, ObjectStore } from "./object-store.js";
import { createCiblageStore } from "../services/ciblage/ciblage-store.js";
import { buildAdapterRegistry, type AdapterEntry } from "../services/pipeline/adapter-registry.js";
import { createJobsStore } from "../services/pipeline/jobs-store.js";
import { runCiblagePlan } from "../services/pipeline/executor.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const CITY = "salaberry-de-valleyfield";
const ROLE_VF = roleSourceId("70052");

/** In-memory ObjectStore that tracks every written key. */
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
    if (!v) throw new Error(`MemoryStore: missing key "${key}"`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }

  /** Keys written to this store that start with 'raw/'. */
  rawKeys(): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith("raw/"));
  }

  /** Keys written to this store that start with 'ontology/'. */
  ontologyKeys(): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith("ontology/"));
  }
}

function fixtureRoleFetch(xml: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "application/xml" : null) },
    arrayBuffer: async () => new TextEncoder().encode(xml).buffer as ArrayBuffer,
  });
}

function fixtureAvisFetch(html: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
    arrayBuffer: async () => new TextEncoder().encode(html).buffer as ArrayBuffer,
  });
}

function roleEntry(): AdapterEntry {
  return {
    sourceId: ROLE_VF,
    city: CITY,
    build: () =>
      createRoleEvaluationMamhAdapter({
        codeMamh: "70052",
        city: CITY,
        fetchImpl: fixtureRoleFetch(roleEvaluationMamhValleyfieldXml()),
      }),
  };
}

function avisEntry(): AdapterEntry {
  return {
    sourceId: AVIS_PUBLICS_SOURCE_ID,
    city: CITY,
    build: () =>
      createAvisPublicsValleyfieldAdapter({
        fetchImpl: fixtureAvisFetch(AVIS_PUBLICS_FIXTURE_HTML),
      }),
  };
}

async function seedPlan(store: MemoryStore, sourceBindingIds: string[]) {
  return createCiblageStore(store).create({
    label: "Test",
    citySlugs: [CITY],
    sourceBindingIds,
    cadence: "initial",
    enabled: true,
  });
}

// ── config resolution tests ───────────────────────────────────────────────────

describe("resolveScrapeS3Config — fallback to S3_* when SCRAPE_S3_* absent", () => {
  it("falls back to all S3_* values when no SCRAPE_S3_* are set", () => {
    const config = loadConfig({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "fr-par",
      S3_BUCKET: "radar-immobilier-raw",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      S3_FORCE_PATH_STYLE: "true",
    });
    const scrape = resolveScrapeS3Config(config);

    expect(scrape.endpoint).toBe("http://minio:9000");
    expect(scrape.region).toBe("fr-par");
    // bucket defaults to radar-immobilier-docs regardless of S3_BUCKET
    expect(scrape.bucket).toBe("radar-immobilier-docs");
    expect(scrape.accessKey).toBe("minioadmin");
    expect(scrape.secretKey).toBe("minioadmin");
    expect(scrape.forcePathStyle).toBe(true);
  });

  it("uses SCRAPE_S3_* overrides when all are present (SCW prod scenario)", () => {
    const config = loadConfig({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "fr-par",
      S3_BUCKET: "radar-immobilier-raw",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      S3_FORCE_PATH_STYLE: "true",
      SCRAPE_S3_ENDPOINT: "https://s3.fr-par.scw.cloud",
      SCRAPE_S3_REGION: "fr-par",
      SCRAPE_S3_BUCKET: "radar-immobilier-docs",
      SCRAPE_S3_ACCESS_KEY: "scw-access-key-placeholder",
      SCRAPE_S3_SECRET_KEY: "scw-secret-key-placeholder",
      SCRAPE_S3_FORCE_PATH_STYLE: "false",
    });
    const scrape = resolveScrapeS3Config(config);

    expect(scrape.endpoint).toBe("https://s3.fr-par.scw.cloud");
    expect(scrape.region).toBe("fr-par");
    expect(scrape.bucket).toBe("radar-immobilier-docs");
    expect(scrape.accessKey).toBe("scw-access-key-placeholder");
    expect(scrape.secretKey).toBe("scw-secret-key-placeholder");
    expect(scrape.forcePathStyle).toBe(false);
  });

  it("resolves partial overrides (endpoint + bucket only)", () => {
    const config = loadConfig({
      S3_ENDPOINT: "http://minio:9000",
      S3_REGION: "fr-par",
      S3_BUCKET: "radar-immobilier-raw",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      SCRAPE_S3_ENDPOINT: "https://s3.fr-par.scw.cloud",
      SCRAPE_S3_BUCKET: "radar-immobilier-docs",
    });
    const scrape = resolveScrapeS3Config(config);

    // Overridden:
    expect(scrape.endpoint).toBe("https://s3.fr-par.scw.cloud");
    expect(scrape.bucket).toBe("radar-immobilier-docs");
    // Fallen back:
    expect(scrape.region).toBe("fr-par");
    expect(scrape.accessKey).toBe("minioadmin");
    expect(scrape.secretKey).toBe("minioadmin");
  });
});

// ── executor wiring tests ─────────────────────────────────────────────────────

describe("runCiblagePlan — scrapeStore routing (mocked stores, no network)", () => {
  it("writes raw scraped docs to scrapeStore and project-state to objectStore", async () => {
    const mainStore = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const plan = await seedPlan(mainStore, [ROLE_VF]);
    const registry = buildAdapterRegistry([roleEntry()]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(mainStore),
      jobsStore: createJobsStore(mainStore),
      objectStore: mainStore,
      scrapeStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => new Date("2026-06-09T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("succeeded");

    // Raw docs must land in scrapeStore, NOT in mainStore.
    expect(scrapeStore.rawKeys().length).toBeGreaterThan(0);
    expect(mainStore.rawKeys()).toHaveLength(0);

    // Project state must land in mainStore, NOT in scrapeStore.
    expect(mainStore.ontologyKeys().length).toBeGreaterThan(0);
    expect(scrapeStore.ontologyKeys()).toHaveLength(0);
  });

  it("falls back: without scrapeStore, raw docs go to objectStore (MinIO default)", async () => {
    const mainStore = new MemoryStore();
    const plan = await seedPlan(mainStore, [ROLE_VF]);
    const registry = buildAdapterRegistry([roleEntry()]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(mainStore),
      jobsStore: createJobsStore(mainStore),
      objectStore: mainStore,
      // no scrapeStore → falls back to mainStore
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => new Date("2026-06-09T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("succeeded");

    // Without a separate scrapeStore, raw docs land in mainStore.
    expect(mainStore.rawKeys().length).toBeGreaterThan(0);
    expect(mainStore.ontologyKeys().length).toBeGreaterThan(0);
  });

  it("routes both role + avis raw docs to scrapeStore in a 2-source plan", async () => {
    const mainStore = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const plan = await seedPlan(mainStore, [ROLE_VF, AVIS_PUBLICS_SOURCE_ID]);
    const registry = buildAdapterRegistry([roleEntry(), avisEntry()]);

    const result = await runCiblagePlan({
      ciblageStore: createCiblageStore(mainStore),
      jobsStore: createJobsStore(mainStore),
      objectStore: mainStore,
      scrapeStore,
      registry,
      planId: plan.id,
      mode: "simulation",
      now: () => new Date("2026-06-09T08:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.status).toBe("succeeded");
    expect(result.job.steps).toHaveLength(2);

    // Both sources' raw docs in scrapeStore only.
    expect(scrapeStore.rawKeys().length).toBeGreaterThanOrEqual(2);
    expect(mainStore.rawKeys()).toHaveLength(0);

    // Project state accumulated from both sources in mainStore.
    const stateKey = `ontology/${CITY}/project-state.json`;
    const stateBytes = await mainStore.get(stateKey);
    const state = JSON.parse(new TextDecoder().decode(stateBytes)) as {
      canonicals: { type: string }[];
    };
    const types = new Set(state.canonicals.map((c) => c.type));
    expect(types.has("Lot")).toBe(true);
    expect(types.has("Bylaw")).toBe(true);
  });
});

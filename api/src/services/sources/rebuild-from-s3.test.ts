/**
 * rebuild-from-s3.test.ts — L4 proof that Postgres is RECONSTRUCTIBLE from the
 * object store (SPEC_PERSISTENCE_S3_FIRST §4). `rebuildFromS3` REPLAYS the
 * object store (`raw/.../meta.json` + `runs/.../manifest.jsonl` + `state/`) and
 * REPROJECTS into a projection repo. The key property: a DROP + rebuild yields
 * the SAME projected state, and a re-run is a no-op (idempotent upserts).
 *
 * The projection target is abstracted behind `ProjectionRepo` so the proof runs
 * fully in memory (no Postgres needed). A Postgres-backed repo is a thin adapter
 * over the same interface (see rebuild-from-s3.ts + projection-repo.ts).
 */
import { describe, expect, it } from "vitest";

import {
  buildRawDocumentRecord,
  rawMetaKey,
  type RawDocumentRecord,
} from "@radar/sources";
import type { ScrapeStatusT } from "@radar/domain";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { writeRunManifest } from "./run-manifest.js";
import { stateKey } from "../scrape-status/store.js";
import { rebuildFromS3 } from "./rebuild-from-s3.js";
import { InMemoryProjectionRepo } from "./projection-repo.js";

// ─────────────────────────────────────────────────────────────────────────────
// Listable in-memory object store (the real S3/MinIO supports `list`).
// ─────────────────────────────────────────────────────────────────────────────

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
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
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini-corpus builder: seed the store the way the live worker would.
// ─────────────────────────────────────────────────────────────────────────────

/** Put a CAS object + sidecar `.meta.json`, mirroring the RECUEIL write order. */
async function seedRawDoc(
  store: ObjectStore,
  params: { source: string; sourceUrl: string; body: string; contentType: string },
): Promise<RawDocumentRecord> {
  const record = buildRawDocumentRecord({
    source: params.source,
    sourceUrl: params.sourceUrl,
    body: new TextEncoder().encode(params.body),
    fetchedAt: "2026-06-08T09:30:00.000Z",
    contentType: params.contentType,
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
  });
  await store.put(record.storageKey, params.body, record.contentType);
  await store.put(
    rawMetaKey(record.storageKey),
    JSON.stringify(record, null, 2),
    "application/json",
  );
  return record;
}

async function seedScrapeStatus(
  store: ObjectStore,
  record: ScrapeStatusT,
): Promise<void> {
  await store.put(
    stateKey(record.citySlug, record.source),
    JSON.stringify(record, null, 2),
    "application/json",
  );
}

/**
 * Build a representative mini-corpus: two docs for one source (with a run
 * manifest carrying publishedAt), one doc for a second source, plus two
 * `state/` scrape-status shards.
 */
async function seedMiniCorpus(store: ObjectStore): Promise<{
  recA1: RawDocumentRecord;
  recA2: RawDocumentRecord;
  recB1: RawDocumentRecord;
}> {
  const sourceA = "proces-verbaux-testville";
  const sourceB = "avis-publics-testville";

  const recA1 = await seedRawDoc(store, {
    source: sourceA,
    sourceUrl: "https://testville.qc.ca/pv/2024-01.pdf",
    body: "PV janvier 2024",
    contentType: "application/pdf",
  });
  const recA2 = await seedRawDoc(store, {
    source: sourceA,
    sourceUrl: "https://testville.qc.ca/pv/2024-02.pdf",
    body: "PV fevrier 2024",
    contentType: "application/pdf",
  });
  const recB1 = await seedRawDoc(store, {
    source: sourceB,
    sourceUrl: "https://testville.qc.ca/avis/a1.html",
    body: "<html>avis 1</html>",
    contentType: "text/html",
  });

  // Run manifest for source A: carries the valid-time anchor (publishedAt).
  await writeRunManifest(store, {
    source: sourceA,
    runId: "2026-06-08T093000000Z-r",
    entries: [
      {
        sha256: recA1.sha256,
        sourceUrl: recA1.sourceUrl,
        casKey: recA1.storageKey,
        status: "new",
        publishedAt: "2024-01-15",
      },
      {
        sha256: recA2.sha256,
        sourceUrl: recA2.sourceUrl,
        casKey: recA2.storageKey,
        status: "new",
        publishedAt: "2024-02-12",
      },
    ],
  });

  await seedScrapeStatus(store, {
    citySlug: "testville",
    source: "conseils-municipaux",
    automation: "refresh",
    windowMonths: 6,
    status: "scraped",
    lastRunAt: "2026-06-08T09:30:00.000Z",
  });
  await seedScrapeStatus(store, {
    citySlug: "testville",
    source: "avis-publics",
    automation: "refresh",
    windowMonths: 6,
    status: "scraped",
    lastRunAt: "2026-06-08T09:30:00.000Z",
  });

  return { recA1, recA2, recB1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("rebuildFromS3 — document projection", () => {
  it("projects one document row per CAS meta.json", async () => {
    const store = new MemoryStore();
    const { recA1, recA2, recB1 } = await seedMiniCorpus(store);
    const repo = new InMemoryProjectionRepo();

    const summary = await rebuildFromS3(store, { repo });

    expect(summary.documents).toBe(3);
    const docs = repo.allDocuments();
    expect(docs).toHaveLength(3);

    const byKey = new Map(docs.map((d) => [d.s3Key, d]));
    expect(byKey.has(recA1.storageKey)).toBe(true);
    expect(byKey.has(recA2.storageKey)).toBe(true);
    expect(byKey.has(recB1.storageKey)).toBe(true);

    const a1 = byKey.get(recA1.storageKey)!;
    expect(a1.sha256).toBe(recA1.sha256);
    expect(a1.sourceUrl).toBe(recA1.sourceUrl);
    expect(a1.contentType).toBe("application/pdf");
    expect(a1.source).toBe("proces-verbaux-testville");
  });

  it("enriches documents with publishedAt from the run manifest", async () => {
    const store = new MemoryStore();
    const { recA1, recB1 } = await seedMiniCorpus(store);
    const repo = new InMemoryProjectionRepo();

    await rebuildFromS3(store, { repo });

    const byKey = new Map(repo.allDocuments().map((d) => [d.s3Key, d]));
    // Source A doc has a manifest entry → publishedAt projected.
    expect(byKey.get(recA1.storageKey)!.publishedAt).toBe("2024-01-15");
    // Source B doc has no manifest → publishedAt absent (never fabricated).
    expect(byKey.get(recB1.storageKey)!.publishedAt).toBeUndefined();
  });
});

describe("rebuildFromS3 — scrape_status projection", () => {
  it("projects one scrape_status row per state/ shard", async () => {
    const store = new MemoryStore();
    await seedMiniCorpus(store);
    const repo = new InMemoryProjectionRepo();

    const summary = await rebuildFromS3(store, { repo });

    expect(summary.scrapeStatuses).toBe(2);
    const statuses = repo.allScrapeStatuses();
    expect(statuses).toHaveLength(2);
    const cm = statuses.find((s) => s.source === "conseils-municipaux");
    expect(cm?.citySlug).toBe("testville");
    expect(cm?.status).toBe("scraped");
  });
});

describe("rebuildFromS3 — idempotence (DROP + rebuild = same state)", () => {
  it("a second rebuild over the same store produces no new rows", async () => {
    const store = new MemoryStore();
    await seedMiniCorpus(store);
    const repo = new InMemoryProjectionRepo();

    const first = await rebuildFromS3(store, { repo });
    const docsAfterFirst = repo.allDocuments().length;
    const statusesAfterFirst = repo.allScrapeStatuses().length;

    const second = await rebuildFromS3(store, { repo });

    // Re-run upserts the same natural keys → no growth.
    expect(repo.allDocuments().length).toBe(docsAfterFirst);
    expect(repo.allScrapeStatuses().length).toBe(statusesAfterFirst);
    expect(second.documents).toBe(first.documents);
    expect(second.scrapeStatuses).toBe(first.scrapeStatuses);
  });

  it("DROP (fresh repo) + rebuild reproduces the identical projected state", async () => {
    const store = new MemoryStore();
    await seedMiniCorpus(store);

    const repo1 = new InMemoryProjectionRepo();
    await rebuildFromS3(store, { repo: repo1 });

    // Simulate DROP DATABASE: a brand-new empty repo, same store.
    const repo2 = new InMemoryProjectionRepo();
    await rebuildFromS3(store, { repo: repo2 });

    const norm = (rows: { s3Key: string }[]): string =>
      JSON.stringify([...rows].sort((a, b) => a.s3Key.localeCompare(b.s3Key)));
    expect(norm(repo1.allDocuments())).toBe(norm(repo2.allDocuments()));

    const normS = (rows: ScrapeStatusT[]): string =>
      JSON.stringify(
        [...rows].sort((a, b) =>
          `${a.citySlug}:${a.source}`.localeCompare(`${b.citySlug}:${b.source}`),
        ),
      );
    expect(normS(repo1.allScrapeStatuses())).toBe(normS(repo2.allScrapeStatuses()));
  });
});

describe("rebuildFromS3 — empty / partial stores", () => {
  it("rebuilds an empty store to an empty projection (no crash)", async () => {
    const store = new MemoryStore();
    const repo = new InMemoryProjectionRepo();

    const summary = await rebuildFromS3(store, { repo });

    expect(summary.documents).toBe(0);
    expect(summary.scrapeStatuses).toBe(0);
    expect(repo.allDocuments()).toHaveLength(0);
  });

  it("projects documents even when no run manifest exists", async () => {
    const store = new MemoryStore();
    const rec = await seedRawDoc(store, {
      source: "avis-publics-orphan",
      sourceUrl: "https://x.qc.ca/a.html",
      body: "<html/>",
      contentType: "text/html",
    });
    const repo = new InMemoryProjectionRepo();

    const summary = await rebuildFromS3(store, { repo });

    expect(summary.documents).toBe(1);
    const doc = repo.allDocuments()[0]!;
    expect(doc.s3Key).toBe(rec.storageKey);
    expect(doc.publishedAt).toBeUndefined();
  });
});

describe("rebuildFromS3 — cursor (projection_meta)", () => {
  it("records the highest applied manifest key in the cursor when one is provided", async () => {
    const store = new MemoryStore();
    await seedMiniCorpus(store);
    const repo = new InMemoryProjectionRepo();

    const summary = await rebuildFromS3(store, { repo });

    // A cursor for the `runs` stream is advanced to the last manifest key seen.
    const cursor = repo.getCursor("runs");
    expect(cursor).toBeDefined();
    expect(cursor).toContain("runs/proces-verbaux-testville/");
    expect(summary.lastManifestKey).toBe(cursor);
  });
});

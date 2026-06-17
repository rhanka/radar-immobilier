import { describe, expect, it } from "vitest";

import {
  buildRawDocumentRecord,
  rawMetaKey,
  type RawDocumentRecord,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { InMemoryProjectionRepo } from "./projection-repo.js";
import { rebuildFromS3 } from "./rebuild-from-s3.js";
import {
  PUBLISHED_AT_REPAIR_SOURCE,
  repairPublishedAtFromS3,
} from "./repair-published-at.js";
import { writeRunManifest } from "./run-manifest.js";

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

async function seedRawDoc(
  store: ObjectStore,
  params: {
    source: string;
    sourceUrl: string;
    body: string;
    title?: string;
    publishedAt?: string;
  },
): Promise<RawDocumentRecord> {
  const record = buildRawDocumentRecord({
    source: params.source,
    sourceUrl: params.sourceUrl,
    body: new TextEncoder().encode(params.body),
    fetchedAt: "2026-06-08T09:30:00.000Z",
    contentType: "application/pdf",
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.publishedAt !== undefined ? { publishedAt: params.publishedAt } : {}),
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
  });
  await store.put(record.storageKey, params.body, record.contentType);
  await store.put(rawMetaKey(record.storageKey), JSON.stringify(record, null, 2));
  return record;
}

function readJsonl(bytes: Uint8Array): unknown[] {
  return new TextDecoder()
    .decode(bytes)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe("repairPublishedAtFromS3", () => {
  it("writes an append-only repair manifest from legacy manifests and safe URL/title dates", async () => {
    const store = new MemoryStore();
    const fromManifest = await seedRawDoc(store, {
      source: "proces-verbaux-testville",
      sourceUrl: "https://testville.qc.ca/pv/no-date.pdf",
      body: "PV from manifest",
    });
    const fromUrl = await seedRawDoc(store, {
      source: "proces-verbaux-testville",
      sourceUrl: "https://testville.qc.ca/docs/PV-2026-05-12.pdf",
      body: "PV from URL",
    });
    const fromTitle = await seedRawDoc(store, {
      source: "proces-verbaux-testville",
      sourceUrl: "https://testville.qc.ca/docs/may.pdf",
      title: "Proces-verbal du 3 juin 2026",
      body: "PV from title",
    });
    const alreadyDated = await seedRawDoc(store, {
      source: "avis-publics-testville",
      sourceUrl: "https://testville.qc.ca/avis/2026-05-20.pdf",
      publishedAt: "2026-05-20",
      body: "Already dated",
    });
    const unsafe = await seedRawDoc(store, {
      source: "avis-publics-testville",
      sourceUrl: "https://testville.qc.ca/avis/DM-2026-0037.pdf",
      body: "Unsafe file id",
    });

    await writeRunManifest(store, {
      source: "proces-verbaux-testville",
      runId: "20260608T093000Z-r",
      entries: [
        {
          sha256: fromManifest.sha256,
          sourceUrl: fromManifest.sourceUrl,
          casKey: fromManifest.storageKey,
          status: "new",
          publishedAt: "2026-04-01",
        },
      ],
    });

    const summary = await repairPublishedAtFromS3(store, {
      runId: "20260617T220000Z-r",
    });

    expect(summary).toMatchObject({
      scannedDocuments: 5,
      alreadyDated: 1,
      repairedFromManifest: 1,
      repairedFromUrlOrTitle: 2,
      unrepaired: 1,
      skippedAlreadyRepaired: 0,
      writtenEntries: 3,
      manifestKey: `runs/${PUBLISHED_AT_REPAIR_SOURCE}/20260617T220000Z-r/manifest.jsonl`,
    });

    const lines = readJsonl(await store.get(summary.manifestKey!)) as Array<{
      sha256: string;
      sourceUrl: string;
      casKey: string;
      publishedAt: string;
      status: string;
    }>;
    const byCasKey = new Map(lines.map((line) => [line.casKey, line]));
    expect(byCasKey.get(fromManifest.storageKey)).toEqual({
      sha256: fromManifest.sha256,
      sourceUrl: fromManifest.sourceUrl,
      casKey: fromManifest.storageKey,
      status: "seen",
      publishedAt: "2026-04-01",
    });
    expect(byCasKey.get(fromUrl.storageKey)).toEqual({
      sha256: fromUrl.sha256,
      sourceUrl: fromUrl.sourceUrl,
      casKey: fromUrl.storageKey,
      status: "seen",
      publishedAt: "2026-05-12",
    });
    expect(byCasKey.get(fromTitle.storageKey)).toEqual({
      sha256: fromTitle.sha256,
      sourceUrl: fromTitle.sourceUrl,
      casKey: fromTitle.storageKey,
      status: "seen",
      publishedAt: "2026-06-03",
    });

    const legacySidecar = JSON.parse(
      new TextDecoder().decode(await store.get(rawMetaKey(fromManifest.storageKey))),
    ) as { publishedAt?: string };
    expect(legacySidecar.publishedAt).toBeUndefined();

    const repo = new InMemoryProjectionRepo();
    await rebuildFromS3(store, { repo });
    const docs = new Map(repo.allDocuments().map((doc) => [doc.s3Key, doc]));
    expect(docs.get(fromManifest.storageKey)?.publishedAt).toBe("2026-04-01");
    expect(docs.get(fromUrl.storageKey)?.publishedAt).toBe("2026-05-12");
    expect(docs.get(fromTitle.storageKey)?.publishedAt).toBe("2026-06-03");
    expect(docs.get(alreadyDated.storageKey)?.publishedAt).toBe("2026-05-20");
    expect(docs.get(unsafe.storageKey)?.publishedAt).toBeUndefined();
  });

  it("does not emit duplicate repair entries when a previous repair manifest exists", async () => {
    const store = new MemoryStore();
    const doc = await seedRawDoc(store, {
      source: "proces-verbaux-testville",
      sourceUrl: "https://testville.qc.ca/docs/PV-2026-05-12.pdf",
      body: "PV",
    });

    await writeRunManifest(store, {
      source: PUBLISHED_AT_REPAIR_SOURCE,
      runId: "previous",
      entries: [
        {
          sha256: doc.sha256,
          sourceUrl: doc.sourceUrl,
          casKey: doc.storageKey,
          status: "seen",
          publishedAt: "2026-05-12",
        },
      ],
    });

    const summary = await repairPublishedAtFromS3(store, { runId: "next" });

    expect(summary).toEqual({
      scannedDocuments: 1,
      alreadyDated: 0,
      repairedFromManifest: 0,
      repairedFromUrlOrTitle: 0,
      unrepaired: 0,
      skippedAlreadyRepaired: 1,
      writtenEntries: 0,
    });
  });
});

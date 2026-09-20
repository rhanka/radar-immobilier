/**
 * recueil.test.ts — RECUEIL persists each raw document as a CAS object PLUS a
 * sidecar `.meta.json` (RawDocumentRecord), so every stored object is
 * self-describing on S3. Spec docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1.
 */
import { describe, expect, it } from "vitest";

import {
  PvSourceFetchError,
  rawMetaKey,
  RawDocumentRecordSchema,
  type RawDocument,
  type RawDocumentRef,
  type SourceAdapter,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  recueilMetricsJson,
  resetRecueilMetrics,
  runRecueil,
  runRecueilWithManifest,
} from "./recueil.js";
import { manifestKey } from "./run-manifest.js";

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

function fakeAdapter(
  body: string,
  refOverrides: Partial<RawDocumentRef> = {},
  text?: string,
): SourceAdapter {
  const ref: RawDocumentRef = {
    sourceKind: "avis-publics",
    city: "testville",
    url: "https://testville.qc.ca/avis",
    discoveredAt: "2026-06-08T00:00:00.000Z",
    ...refOverrides,
  };
  const raw: RawDocument = {
    ref,
    sourceKind: "avis-publics",
    city: "testville",
    url: ref.url,
    fetchedAt: "2026-06-08T09:30:00.000Z",
    // A `.text` payload models a binary (PDF) doc whose adapter attached the
    // pdftotext projection — stored beside the binary at the companion textKey.
    contentType: text !== undefined ? "application/pdf" : "text/html",
    body: new TextEncoder().encode(body),
    ...(text !== undefined ? { text } : {}),
    provenance: {
      adapterVersion: "1.0.0",
      userAgent: "radar/test",
      fetchedViaObscura: false,
    },
  };
  return {
    kind: "avis-publics",
    city: "testville",
    version: "1.0.0",
    async *list() {
      yield ref;
    },
    async fetch() {
      return raw;
    },
    hash() {
      return raw.sha256 ?? "x";
    },
  };
}

function manyDocumentsAdapter(count: number): SourceAdapter {
  const refs = Array.from({ length: count }, (_, i): RawDocumentRef => ({
    sourceKind: "pv",
    city: "testville",
    url: `https://testville.qc.ca/pv-${i}.pdf`,
    discoveredAt: "2026-06-08T00:00:00.000Z",
    contentType: "application/pdf",
  }));
  return {
    kind: "pv", city: "testville", version: "1.0.0",
    async *list() { yield* refs; },
    async fetch(ref) {
      return {
        ref, sourceKind: "pv", city: "testville", url: ref.url,
        fetchedAt: "2026-06-08T09:30:00.000Z", contentType: "application/pdf",
        body: new TextEncoder().encode(ref.url),
        provenance: { adapterVersion: "1.0.0", fetchedViaObscura: false },
      };
    },
    hash() { return "unused"; },
  };
}

describe("runRecueil — raw bytes + sidecar meta.json", () => {
  it("emits the exact terminal JSON for a no-new-documents run", async () => {
    const store = new MemoryStore();
    const adapter = manyDocumentsAdapter(1);
    await runRecueil("proces-verbaux-testville", adapter, store);
    resetRecueilMetrics();
    await runRecueil("proces-verbaux-testville", adapter, store, { limit: 25 });
    expect(recueilMetricsJson()).toBe(
      '{"newDocuments":0,"skippedExisting":1,"remaining":0,"index404":0,"document404":0}',
    );
  });

  it("caps only newly written documents and progresses past existing CAS objects", async () => {
    const store = new MemoryStore();
    const adapter = manyDocumentsAdapter(60);
    const seeded = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 10 });
    expect(seeded.ok && seeded.newDocuments).toBe(10);

    const first = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 25 });
    const second = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 25 });
    const final = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 25 });

    expect(first.ok && { new: first.newDocuments, seen: first.skippedExisting }).toEqual({ new: 25, seen: 10 });
    expect(second.ok && { new: second.newDocuments, seen: second.skippedExisting }).toEqual({ new: 25, seen: 35 });
    expect(final.ok && { new: final.newDocuments, seen: final.skippedExisting }).toEqual({ new: 0, seen: 60 });
  });

  it("stops LISTING once the new-write cap is reached, truncating the rest of the window",
    async () => {
      // This is why REFRESH_ACQUISITION_LIMIT is not just a write cap: the loop
      // breaks, so the documents after the cap are never listed at all. On an
      // index page ordered oldest-first, a cap of 1 hands the refresh the OLDEST
      // unseen document and hides the newest until a later pass.
      const store = new MemoryStore();
      const adapter = manyDocumentsAdapter(6);

      const capped = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 1 });
      expect(capped.ok && capped.count).toBe(1);

      // Already-collected documents do not consume the cap, so a second pass
      // reaches exactly one more — convergence at one document per pass.
      const next = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 1 });
      expect(next.ok && { new: next.newDocuments, seen: next.skippedExisting })
        .toEqual({ new: 1, seen: 1 });

      // A cap of five sees the whole window in one pass instead of four more.
      const wide = await runRecueil("proces-verbaux-testville", adapter, store, { limit: 5 });
      expect(wide.ok && { new: wide.newDocuments, seen: wide.skippedExisting })
        .toEqual({ new: 4, seen: 2 });
    });

  it("filters index representations before the limit and paces the selected fetch", async () => {
    const store = new MemoryStore();
    const indexRef: RawDocumentRef = {
      sourceKind: "pv", city: "testville", url: "https://testville.qc.ca/pv",
      discoveredAt: "2026-06-08T00:00:00.000Z", contentType: "text/html",
    };
    const pdfRef: RawDocumentRef = {
      sourceKind: "pv", city: "testville", url: "https://testville.qc.ca/pv.pdf",
      discoveredAt: "2026-06-08T00:00:00.000Z", contentType: "application/pdf",
    };
    const fetched: string[] = [];
    const paced: string[] = [];
    const adapter: SourceAdapter = {
      kind: "pv", city: "testville", version: "1.0.0",
      async *list() { yield indexRef; yield pdfRef; },
      async fetch(ref) {
        fetched.push(ref.url);
        return { ref, sourceKind: "pv", city: "testville", url: ref.url,
          fetchedAt: "2026-06-08T09:30:00.000Z", contentType: ref.contentType ?? "text/html",
          body: new TextEncoder().encode(ref.url),
          provenance: { adapterVersion: "1.0.0", fetchedViaObscura: false } };
      },
      hash() { return "unused"; },
    };

    const out = await runRecueil("proces-verbaux-testville", adapter, store, {
      limit: 1,
      acceptRef: (ref) => ref.contentType === "application/pdf",
      beforeFetch: async (ref) => { paced.push(ref.url); },
    });

    expect(out.ok && out.count).toBe(1);
    expect(fetched).toEqual([pdfRef.url]);
    expect(paced).toEqual([pdfRef.url]);
  });

  it("writes the CAS raw object and a parseable .meta.json record", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    expect(store.objects.has(rec.storageKey)).toBe(true);

    const metaKey = rawMetaKey(rec.storageKey);
    expect(store.objects.has(metaKey)).toBe(true);
    const meta = JSON.parse(
      new TextDecoder().decode(store.objects.get(metaKey)!),
    );
    expect(() => RawDocumentRecordSchema.parse(meta)).not.toThrow();
    expect(meta.sha256).toBe(rec.sha256);
    expect(meta.storageKey).toBe(rec.storageKey);
    expect(meta.sourceUrl).toBe("https://testville.qc.ca/avis");
  });

  it("persists the parseable text at <storageKey>.txt when the adapter attaches RawDocument.text (PDF)", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "reglements-urbanisme-testville",
      fakeAdapter(
        "%PDF-1.7 …binary…",
        {},
        "Règlement 999-01 concernant le zonage",
      ),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    // The binary body stays the canonical, openable evidence (drawer rawRef).
    expect(store.objects.has(rec.storageKey)).toBe(true);
    // The parseable text lands at the companion textKey (EXPLOITATION reads it).
    expect(rec.textKey).toBe(`${rec.storageKey}.txt`);
    expect(store.objects.has(rec.textKey!)).toBe(true);
    expect(
      new TextDecoder().decode(store.objects.get(rec.textKey!)!),
    ).toBe("Règlement 999-01 concernant le zonage");
  });

  it("attaches NO textKey for a text source (no RawDocument.text) — body IS the parseable substrate", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.records[0]!.textKey).toBeUndefined();
  });

  it("BACK-FILLS the textKey on a re-run whose binary already exists (dedup) — text persisted even when the body is 'seen'", async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter(
      "%PDF-1.7 …binary…",
      {},
      "Règlement 999-01 concernant le zonage",
    );
    // 1st run stored binary + text.
    const first = await runRecueil(
      "reglements-urbanisme-testville",
      adapter,
      store,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rec = first.records[0]!;

    // Simulate a PRIOR run (pre-fix) that stored ONLY the binary: drop the text
    // object, keep the deduped binary.
    store.objects.delete(rec.textKey!);
    expect(store.objects.has(rec.storageKey)).toBe(true);
    expect(store.objects.has(rec.textKey!)).toBe(false);

    // Re-run: the binary is deduped ("seen") but the text MUST be back-filled,
    // else EXPLOITATION would read record.textKey on an absent object.
    const second = await runRecueil(
      "reglements-urbanisme-testville",
      adapter,
      store,
    );
    expect(second.ok).toBe(true);
    expect(store.objects.has(rec.textKey!)).toBe(true);
    expect(
      new TextDecoder().decode(store.objects.get(rec.textKey!)!),
    ).toBe("Règlement 999-01 concernant le zonage");
  });

  it("persists source listing title and publishedAt in sidecar metadata", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>", {
        title: "Avis public du 8 juin",
        publishedAt: "2026-06-08",
      }),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    expect(rec.title).toBe("Avis public du 8 juin");
    expect(rec.publishedAt).toBe("2026-06-08");

    const meta = JSON.parse(
      new TextDecoder().decode(store.objects.get(rawMetaKey(rec.storageKey))!),
    );
    expect(meta.title).toBe("Avis public du 8 juin");
    expect(meta.publishedAt).toBe("2026-06-08");
  });
});

describe("runRecueilWithManifest — run manifest (commit record)", () => {
  it("first run writes runs/{source}/{runId}/manifest.jsonl with status new", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
      { runId: "20260608T093000-r" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const key = manifestKey("avis-publics-testville", "20260608T093000-r");
    expect(key).toBe(
      "runs/avis-publics-testville/20260608T093000-r/manifest.jsonl",
    );
    expect(store.objects.has(key)).toBe(true);

    const body = new TextDecoder().decode(store.objects.get(key)!);
    const lines = body.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(out.records.length);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.status).toBe("new");
    expect(entry.sha256).toBe(out.records[0]!.sha256);
    expect(entry.casKey).toBe(out.records[0]!.storageKey);
    expect(entry.sourceUrl).toBe("https://testville.qc.ca/avis");
  });

  it("writes publishedAt from the persisted record into the manifest", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>", {
        publishedAt: "2026-06-08",
      }),
      store,
      { runId: "run-dated" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const key = manifestKey("avis-publics-testville", "run-dated");
    const body = new TextDecoder().decode(store.objects.get(key)!);
    const entry = JSON.parse(body.split("\n")[0]!);
    expect(entry.publishedAt).toBe("2026-06-08");
  });

  it("second run on byte-identical content is HEAD-skipped → status seen, no new raw object", async () => {
    const store = new MemoryStore();
    const body = "<html>avis 2026-58</html>";

    const first = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter(body),
      store,
      { runId: "run-1" },
    );
    expect(first.ok).toBe(true);
    // After the first run, the raw object + its sidecar exist (2 puts) and the
    // manifest is the 3rd put.
    const rawKeysAfterFirst = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );
    const putsAfterFirst = store.putCount;

    const second = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter(body),
      store,
      { runId: "run-2" },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // No NEW raw/cas object was written on the second run (HEAD-skip dedup).
    const rawKeysAfterSecond = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );
    expect(rawKeysAfterSecond).toEqual(rawKeysAfterFirst);
    // The only put of the second run is the manifest itself.
    expect(store.putCount).toBe(putsAfterFirst + 1);

    const key = manifestKey("avis-publics-testville", "run-2");
    const manifest = new TextDecoder().decode(store.objects.get(key)!);
    const lines = manifest.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.status).toBe("seen");
    expect(entry.sha256).toBe(second.records[0]!.sha256);
  });

  it("derives a default runId from fetchedAt when none is given", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const expectedRunId = `${out.fetchedAt.replace(/[:.]/g, "")}-r`;
    const key = manifestKey("avis-publics-testville", expectedRunId);
    expect(store.objects.has(key)).toBe(true);
  });
});

/**
 * Issue #723 — one dead document link used to cost the WHOLE city.
 * `drummondvilleShapedAdapter` reproduces the exact shape that was measured on
 * the real index: many documents that succeed, one 404 near the end, more
 * documents after it.
 */
function drummondvilleShapedAdapter(
  count: number,
  deadIndex: number,
  options: { listFailsAt?: number } = {},
): SourceAdapter {
  const refs = Array.from({ length: count }, (_, i): RawDocumentRef => ({
    sourceKind: "pv",
    city: "drummondville",
    url: `https://www.drummondville.ca/uploads/pv-${i}.pdf`,
    discoveredAt: "2026-09-20T00:00:00.000Z",
    contentType: "application/pdf",
  }));
  return {
    kind: "pv", city: "drummondville", version: "1.0.0",
    async *list() {
      for (const [i, ref] of refs.entries()) {
        if (options.listFailsAt !== undefined && i === options.listFailsAt) {
          throw new PvSourceFetchError(
            "http", "HTTP 500", "https://www.drummondville.ca/seances/", "index", 500,
          );
        }
        yield ref;
      }
    },
    async fetch(ref) {
      if (ref.url === refs[deadIndex]?.url) {
        throw new PvSourceFetchError("http", "HTTP 404", ref.url, "document", 404);
      }
      return {
        ref, sourceKind: "pv", city: "drummondville", url: ref.url,
        fetchedAt: "2026-09-20T09:30:00.000Z", contentType: "application/pdf",
        body: new TextEncoder().encode(ref.url),
        provenance: { adapterVersion: "1.0.0", fetchedViaObscura: false },
      };
    },
    hash() { return "unused"; },
  };
}

describe("runRecueil — a failed document must not cost the city (#723)", () => {
  it("keeps collecting after a 404 document and reports it as a hole, not a failure", async () => {
    const store = new MemoryStore();
    resetRecueilMetrics();
    // 255 documents, the dead link at rank 253 — the measured drummondville run.
    const out = await runRecueil(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(255, 252),
      store,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The two documents AFTER the dead link were collected too: the loop went on.
    expect(out.count).toBe(254);
    expect(out.newDocuments).toBe(254);
    expect(out.documentFailures).toHaveLength(1);
    expect(out.documentFailures[0]).toEqual({
      url: "https://www.drummondville.ca/uploads/pv-252.pdf",
      phase: "document",
      error: "http",
      detail: "HTTP 404",
      httpStatus: 404,
    });
    expect(out.listingTruncatedBy).toBeUndefined();
    // The 404 is counted as a DOCUMENT 404, never as a lost index.
    expect(JSON.parse(recueilMetricsJson())).toMatchObject({
      document404: 1, index404: 0,
    });
  });

  it("commits the run manifest of a run that has holes, so the failed doc is retried and nothing is orphaned", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(5, 3),
      store,
      { runId: "run-1" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const body = new TextDecoder().decode(
      store.objects.get(manifestKey("proces-verbaux-drummondville", "run-1"))!,
    );
    const urls = body.trim().split("\n").map((l) => JSON.parse(l).sourceUrl as string);
    expect(urls).toHaveLength(4);
    expect(urls).not.toContain("https://www.drummondville.ca/uploads/pv-3.pdf");
  });

  it("still loses the city when the INDEX fails and nothing was collected", async () => {
    const store = new MemoryStore();
    resetRecueilMetrics();
    const out = await runRecueil(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(5, -1, { listFailsAt: 0 }),
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("http");
    expect(out.fetchFailure).toMatchObject({ phase: "index", httpStatus: 500 });
  });

  it("keeps the harvest when enumeration breaks PART WAY, and says the list is truncated", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(10, -1, { listFailsAt: 4 }),
      store,
      { runId: "run-2" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(4);
    expect(out.listingTruncatedBy).toMatchObject({ phase: "index", httpStatus: 500 });
    // Committed: the 4 documents are referenced by a manifest, not orphaned.
    expect(store.objects.has(manifestKey("proces-verbaux-drummondville", "run-2"))).toBe(true);
  });

  it("fails the source when it collected NOTHING and every attempt failed", async () => {
    // A single-reference source (the avis-publics adapters, whose one document
    // IS the index page) lives entirely in this case, and so does a city whose
    // every listed document 404s. `POST /api/sources/collect/:source` answers
    // 502 on it and a pipeline run is PARTIAL — neither may be softened into a
    // "success with holes" by the #723 fix.
    const store = new MemoryStore();
    const out = await runRecueil(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(1, 0),
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("http");
    expect(out.fetchFailure).toMatchObject({ phase: "document", httpStatus: 404 });
  });

  it("does not lose the city on a STORAGE failure of one document either", async () => {
    const store = new MemoryStore();
    let puts = 0;
    const failingStore: ObjectStore = {
      ...store,
      head: (key) => store.head(key),
      get: (key) => store.get(key),
      put: async (key, body) => {
        puts += 1;
        if (puts === 3) throw new Error("S3 unavailable");
        return store.put(key, body);
      },
    };
    const out = await runRecueil(
      "proces-verbaux-drummondville",
      drummondvilleShapedAdapter(4, -1),
      failingStore,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.documentFailures).toHaveLength(1);
    expect(out.documentFailures[0]).toMatchObject({
      error: "storage", detail: "S3 unavailable", phase: "document",
    });
    expect(out.count).toBe(3);
  });
});

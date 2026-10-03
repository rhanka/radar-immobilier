import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";
import type { Extraction } from "@sentropic/graphify";
import { describe, expect, it } from "vitest";

import type { LiveScrapeCityRecap } from "../sources/live-scrape.js";
import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { hydrateGraphDocumentDates } from "../sources/document-date-metadata.js";
import { extractionToV23Graph } from "./refresh-v23.js";
import { refreshCorpusInputHash, type RefreshCorpus, type RefreshCorpusDocument } from "./refresh-corpus.js";
import { acquireRefreshPdfCandidates, bindDocumentSourceIds, DEFAULT_REFRESH_MAX_DOCUMENT_BYTES,
  orderRefreshPdfCandidates, recoverRefreshDocumentDates, refreshSourceDelayMs, writeRefreshPdfManifest,
  type RefreshAcquire } from "./refresh-run.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`missing ${key}`);
    return body;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const body = this.objects.get(key);
    return body ? { key, size: body.byteLength } : null;
  }

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
}

const sha = (digit: string) => digit.repeat(64);

describe("acquireRefreshPdfCandidates", () => {
  it("applies the required two-second pacing jitter bounds", () => {
    expect(refreshSourceDelayMs(() => 0)).toBe(1_700);
    expect(refreshSourceDelayMs(() => 0.5)).toBe(2_000);
    expect(refreshSourceDelayMs(() => 0.999999)).toBe(2_300);
  });

  it("offers every exact PDF as a candidate while retaining valid non-PDF evidence", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;
    const pdfKey = `raw/${sourceId}/cas/${sha("b")}.pdf`;
    const laterPdfKey = `raw/${sourceId}/cas/${sha("c")}.pdf`;

    const { candidates } = await acquireRefreshPdfCandidates({ citySlug: "city", store,
      acquire: async () => [{ city: "city", sourceId, status: "new",
        casKeys: [htmlKey, pdfKey, laterPdfKey], count: 3 }] });

    // Both PDFs remain reachable — that is what lets a later run advance to the
    // second one instead of declaring the city up to date.
    expect(candidates.map((candidate) => candidate.representationKey))
      .toEqual([pdfKey, laterPdfKey]);
    // The manifest still freezes exactly ONE document.
    const manifest = new TextDecoder().decode(
      await store.get(await writeRefreshPdfManifest(store, candidates[0]!)));
    expect(manifest).toContain(pdfKey);
    expect(manifest).not.toContain(htmlKey);
    expect(manifest).not.toContain(laterPdfKey);
  });

  // THE DAILY CYCLE IS AN UPDATE JOB (owner, 2026-09-20): it reads the index —
  // that is the check — and downloads only the differential. A night on which
  // the municipality published nothing collects nothing, and that is the normal
  // result, not a failed Job. This function used to demand `count >= 1` and
  // throw REFRESH_NO_ACQUISITION otherwise, which failed the CronJob on the most
  // ordinary night there is.
  it("returns no candidate instead of failing when the city has nothing new", async () => {
    const store = new MemoryStore();
    const { recap, candidates } = await acquireRefreshPdfCandidates({
      citySlug: "city", store, acquire: async () => [{
        city: "city", sourceId: "proces-verbaux-city", status: "seen", casKeys: [], count: 0,
        skippedKnown: 12,
      }] });
    expect(candidates).toEqual([]);
    expect(recap.skippedKnown).toBe(12);
    // Nothing is published for a run with no input: no manifest, no bytes.
    expect(store.objects.size).toBe(0);
  });

  // The distinction that matters: "nothing new" is not "could not look".
  it("still fails when the index itself could not be read", async () => {
    const store = new MemoryStore();
    await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId: "proces-verbaux-city", status: "error", casKeys: [], count: 0,
      error: "[http] HTTP 404",
    }] })).rejects.toMatchObject({ code: "REFRESH_NO_ACQUISITION" });
  });

  it("asks the scrape to skip documents an earlier run already collected", async () => {
    const store = new MemoryStore();
    let sawGuard: boolean | undefined;
    await acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async (_cities, options) => {
      sawGuard = options.skipAlreadyCollectedUrls;
      return [{ city: "city", sourceId: "proces-verbaux-city", status: "seen", casKeys: [], count: 0 }];
    } });
    // No GET and no HEAD on a document already in storage: the skip is decided
    // on the URL, before any request.
    expect(sawGuard).toBe(true);
  });

  it("caps every document body at 50 MiB unless told otherwise (#805)", async () => {
    const store = new MemoryStore();
    const caps: (number | undefined)[] = [];
    const acquire: RefreshAcquire = async (_cities, options) => {
      caps.push(options.maxDocumentBytes);
      return [{ city: "city", sourceId: "proces-verbaux-city", status: "seen", casKeys: [], count: 0 }];
    };
    await acquireRefreshPdfCandidates({ citySlug: "city", store, acquire });
    await acquireRefreshPdfCandidates({ citySlug: "city", store, acquire, maxDocumentBytes: 1_000 });
    expect(caps).toEqual([DEFAULT_REFRESH_MAX_DOCUMENT_BYTES, 1_000]);
    expect(DEFAULT_REFRESH_MAX_DOCUMENT_BYTES).toBe(52_428_800);
  });

  it("reports the documents set aside even when the city's acquisition then fails (#805)", async () => {
    const store = new MemoryStore();
    const setAside = { url: "https://vsad.ca/zonage.pdf", reason: "oversize" as const, newlySetAside: true,
      markedAt: "2026-10-03T00:00:00.000Z", bytesAnnounced: 180_215_792, bytesRead: 0, capBytes: 52_428_800 };
    const reported: unknown[] = [];
    await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, onSetAside: (d) => reported.push(d),
      acquire: async () => [{ city: "city", sourceId: "proces-verbaux-city", status: "error", casKeys: [],
        count: 0, error: "[http] HTTP 404", setAside: [setAside] }] }))
      .rejects.toMatchObject({ code: "REFRESH_NO_ACQUISITION" });
    expect(reported).toEqual([setAside]);
  });

  it("fails before manifest publication when acquisition has no exact PDF", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;

    await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId, status: "seen", casKeys: [htmlKey], count: 1,
    }] })).rejects.toThrow("Selected city acquisition produced no exact PDF: city");
    expect(store.objects.size).toBe(0);
  });

  it("codes its refusals so a whole-list sweep can tell them apart without parsing messages",
    async () => {
      const store = new MemoryStore();
      await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [] }))
        .rejects.toMatchObject({ code: "REFRESH_NO_ACQUISITION" });
      await expect(acquireRefreshPdfCandidates({ citySlug: "city", store, acquire: async () => [{
        city: "city", sourceId: "proces-verbaux-city", status: "seen",
        casKeys: [`raw/proces-verbaux-city/cas/${sha("a")}.html`], count: 1,
      }] })).rejects.toMatchObject({ code: "REFRESH_NO_PDF" });
    });
});

describe("orderRefreshPdfCandidates", () => {
  const sourceId = "proces-verbaux-city";
  const key = (digit: string) => `raw/${sourceId}/cas/${sha(digit)}.pdf`;

  function recap(documents: { casKey: string; publishedAt?: string }[]): LiveScrapeCityRecap {
    return {
      city: "city", sourceId, status: "seen", count: documents.length,
      casKeys: documents.map((document) => document.casKey),
      documents: documents.map((document) => ({
        casKey: document.casKey, sha256: document.casKey.slice(-68, -4), status: "seen" as const,
        ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
      })),
    };
  }

  it("puts the most recently published document first, whatever order the index page used", () => {
    // An index page that lists its minutes oldest-first is exactly the case the
    // previous positional selection got wrong: it pinned the cycle on the oldest
    // document of the window and never reached the new one.
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: key("a"), publishedAt: "2026-04-14" },
      { casKey: key("b"), publishedAt: "2026-09-15" },
      { casKey: key("c"), publishedAt: "2026-06-09" },
    ]));

    expect(ordered.map((candidate) => candidate.publishedAt))
      .toEqual(["2026-09-15", "2026-06-09", "2026-04-14"]);
  });

  it("keeps the index order for undated documents and puts them after the dated ones", () => {
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: key("a") },
      { casKey: key("b"), publishedAt: "2026-01-20" },
      { casKey: key("c") },
    ]));

    expect(ordered.map((candidate) => candidate.representationKey))
      .toEqual([key("b"), key("a"), key("c")]);
  });

  it("keeps only exact PDFs and carries the identity the run state is keyed on", () => {
    const ordered = orderRefreshPdfCandidates(recap([
      { casKey: `raw/${sourceId}/cas/${sha("d")}.html` },
      { casKey: key("e") },
    ]));

    expect(ordered).toHaveLength(1);
    expect(ordered[0]).toMatchObject({ sourceId, citySlug: "city", sha: sha("e"),
      representationKey: key("e"), sidecarKey: `${key("e")}.meta.json` });
    // The identity MUST be the one the corpus recomputes after extraction,
    // otherwise a document would be re-extracted forever under a second identity.
    expect(ordered[0]!.inputHash).toBe(refreshCorpusInputHash([{ sourceId, citySlug: "city",
      sha256: sha("e"), representationKey: key("e") }]));
  });

  it("still works when the recap carries no per-document metadata", () => {
    const ordered = orderRefreshPdfCandidates({ city: "city", sourceId, status: "seen",
      casKeys: [key("a"), key("b")], count: 2 });

    expect(ordered.map((candidate) => candidate.representationKey)).toEqual([key("a"), key("b")]);
  });
});

describe("documentary dates in the existing refresh", () => {
  const header = "Procès-verbal d'une séance ordinaire du Conseil municipal tenue le 28 juillet 2026, à 19 h";
  async function undatedDocument(store: MemoryStore) {
    const record = buildRawDocumentRecord({ source: "pv-test", sourceUrl: "https://example.test/pv.pdf",
      body: new TextEncoder().encode("original-pdf"), contentType: "application/pdf",
      fetchedAt: "2026-07-30T10:00:00.000Z", provenance: { version: "1", userAgent: "test", viaObscura: false } });
    await store.put(rawMetaKey(record.storageKey), JSON.stringify(record));
    const chunk = { id: `${record.sha256}.1`, docSha: record.sha256, originalKey: record.storageKey,
      sourceUrl: record.sourceUrl, pages: [1], text: `[PDF PAGE 1]\n${header}`,
      documentDate: { status: "unknown" as const }, documentHeader: { page: 1, text: header } };
    const document: RefreshCorpusDocument = { sourceId: "pv-test", citySlug: "testville", sha256: record.sha256,
      originalKey: record.storageKey, sourceUrl: record.sourceUrl, fetchedAt: record.fetchedAt,
      documentDate: { status: "unknown" }, pages: [{ page: 1, text: header }], chunks: [chunk] };
    return { record, chunk, document };
  }
  function sourceExtraction(id: string, docSha: string, rawRef: string, date?: string): Extraction {
    return { nodes: [{ id, label: "PV", node_type: "Source", file_type: "document", source_file: rawRef,
      properties: { docSha, rawRef, ...(date ? { date } : {}) },
      citations: [{ page: 1, excerpt: header, source_file: rawRef, rawRef, docSha,
        sourceUrl: "https://example.test/pv.pdf", modality: "pdf" }] }],
    edges: [], input_tokens: 1, output_tokens: 1 } as unknown as Extraction;
  }

  it("should persist a date recovered with zero signals and carry it, with the scrap date, to graph refs", async () => {
    const store = new MemoryStore();
    const { record, chunk, document } = await undatedDocument(store);
    const extraction = sourceExtraction(`source-${record.sha256}`, record.sha256, record.storageKey, "2026-07-28");
    const [dated] = await recoverRefreshDocumentDates(store, [document], [{ chunk, extraction }]);
    expect(dated).toMatchObject({ publishedAt: "2026-07-28", fetchedAt: record.fetchedAt,
      documentDate: { status: "known", method: "signal-llm", kind: "session" } });
    const persisted = JSON.parse(new TextDecoder().decode(await store.get(rawMetaKey(record.storageKey))));
    expect(persisted).toMatchObject({ publishedAt: "2026-07-28", fetchedAt: record.fetchedAt,
      sha256: record.sha256, documentDate: { method: "signal-llm" } });
    const graph = extractionToV23Graph(extraction, { municipality: "testville", generatedAt: "2026-10-01T00:00:00Z",
      documents: [dated!], baseline: { nodes: [], edges: [] } });
    expect(graph.nodes.map((node) => node.type)).toEqual(["Source"]);
    expect(graph.nodes[0]?.refs?.[0]).toMatchObject({ publishedAt: "2026-07-28", fetchedAt: record.fetchedAt });
  });

  it("should keep a known upstream date and never let the model output replace it", async () => {
    const store = new MemoryStore();
    const { record, chunk, document } = await undatedDocument(store);
    const known = { status: "known" as const, value: "2026-07-27", precision: "day" as const,
      kind: "session" as const, method: "listing" as const, evidence: { field: "publishedAt" } };
    const extraction = sourceExtraction(`source-${record.sha256}`, record.sha256, record.storageKey, "2026-07-28");
    const [dated] = await recoverRefreshDocumentDates(store, [{ ...document, documentDate: known,
      publishedAt: known.value }], [{ chunk, extraction }]);
    expect(dated).toMatchObject({ publishedAt: "2026-07-27", documentDate: { method: "listing" } });
    const persisted = JSON.parse(new TextDecoder().decode(await store.get(rawMetaKey(record.storageKey))));
    expect(persisted).not.toHaveProperty("publishedAt");
  });

  it("should leave the date unknown when the existing call proves none", async () => {
    const store = new MemoryStore();
    const { record, chunk, document } = await undatedDocument(store);
    const [dated] = await recoverRefreshDocumentDates(store, [document], [{ chunk,
      extraction: sourceExtraction(`source-${record.sha256}`, record.sha256, record.storageKey) }]);
    expect(dated).toMatchObject({ documentDate: { status: "unknown" } });
    expect(dated).not.toHaveProperty("publishedAt");
  });

  it("should reuse the published Source identity and date that baseline Source in the same refresh", async () => {
    const store = new MemoryStore();
    const { record, document } = await undatedDocument(store);
    const baseline = { nodes: [{ id: "src:legacy", label: "PV", type: "Source",
      properties: { docSha: record.sha256, rawRef: record.storageKey } }], edges: [] };
    const corpus: RefreshCorpus = { inputHash: "h", documents: [document], chunks: document.chunks };
    const bound = bindDocumentSourceIds(corpus, baseline);
    expect(bound.inputHash).toBe("h");
    expect(bound.chunks[0]?.documentSourceId).toBe("src:legacy");
    const extraction = sourceExtraction("src:legacy", record.sha256, record.storageKey, "2026-07-28");
    await recoverRefreshDocumentDates(store, bound.documents, [{ chunk: bound.chunks[0]!, extraction }]);
    const hydrated = await hydrateGraphDocumentDates(store, baseline);
    expect(hydrated.nodes[0]?.properties).toMatchObject({ date: "2026-07-28" });
    expect(baseline.nodes[0]?.properties).not.toHaveProperty("date");
  });
});

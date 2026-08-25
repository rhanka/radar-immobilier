import { describe, expect, it, vi } from "vitest";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";

import { documentsRoute } from "./documents.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, {
      bytes,
      ...(contentType !== undefined ? { contentType } : {}),
    });
    return { key, size: bytes.byteLength, contentType };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value.bytes;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const value = this.objects.get(key);
    return value
      ? { key, size: value.bytes.byteLength, contentType: value.contentType }
      : null;
  }
}

async function seedPdf(store: ObjectStore) {
  const bytes = new TextEncoder().encode("%PDF-1.4");
  const record = buildRawDocumentRecord({
    source: "proces-verbaux-testville",
    sourceUrl: "https://testville.qc.ca/pv/2026-05-12.pdf",
    title: "Proces-verbal du 12 mai 2026",
    publishedAt: "2026-05-12",
    body: bytes,
    fetchedAt: "2026-06-08T09:30:00.000Z",
    contentType: "application/pdf",
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
  });
  await store.put(record.storageKey, bytes, "application/pdf");
  await store.put(rawMetaKey(record.storageKey), JSON.stringify(record, null, 2));
  return record;
}

describe("GET /api/documents/raw", () => {
  it("rejects unsafe raw refs", async () => {
    const app = documentsRoute({ store: new MemoryStore() });

    const res = await app.request("/api/documents/raw?rawRef=../secret.pdf");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_raw_ref" });
  });

  it("returns 404 when the raw object is absent", async () => {
    const app = documentsRoute({ store: new MemoryStore() });

    const res = await app.request(
      "/api/documents/raw?rawRef=raw/proces-verbaux-testville/cas/missing.pdf",
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "document_not_found" });
  });

  it("serves the raw document bytes with the resolved content type", async () => {
    const store = new MemoryStore();
    const record = await seedPdf(store);
    const app = documentsRoute({ store });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(record.storageKey)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  it("accepts legacy local paths when they contain a canonical raw key", async () => {
    const store = new MemoryStore();
    const record = await seedPdf(store);
    const app = documentsRoute({ store });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(`/tmp/scw-docs/${record.storageKey}`)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("serves CAS PV PDFs that live only in the scrape store", async () => {
    // Regression: CAS PV PDFs (raw/proces-verbaux-<city>/cas/<sha>.pdf) are
    // written by the RECUEIL pipeline to the scrape bucket, NOT to `store`.
    // The viewer must still resolve them via /api/documents/raw.
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const casKey = "raw/proces-verbaux-saint-frederic/cas/fb6fb3096321f1.pdf";
    await scrapeStore.put(casKey, "%PDF-1.4 cas", "application/pdf");
    const app = documentsRoute({ store, scrapeStore });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(casKey)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4 cas");
  });

  it("prefers the scrape store but falls back to the metadata store", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const record = await seedPdf(store); // only in the metadata store
    const app = documentsRoute({ store, scrapeStore });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(record.storageKey)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  // ── immo→geo repoint (zero-copy, read-only) ─────────────────────────────
  const REPOINT_SHA = "b".repeat(64);
  const IMMO_PV_KEY = `raw/proces-verbaux-saint-frederic/cas/${REPOINT_SHA}.pdf`;
  const GEO_PV_KEY = `raw/pv-index/cas/${REPOINT_SHA}.pdf`;

  it("flag OFF: serves the PV from the immo scrape store and never touches geo", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    await scrapeStore.put(IMMO_PV_KEY, "immo bytes", "application/pdf");
    await geoDocumentsReader.put(GEO_PV_KEY, "geo bytes", "application/pdf");
    const geoHead = vi.spyOn(geoDocumentsReader, "head");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: false,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(IMMO_PV_KEY)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("immo bytes");
    expect(geoHead).not.toHaveBeenCalled();
  });

  it("flag ON: serves a mapped PV STRICTLY from geo, never reading the immo stores", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    // Stale immo copy present — must be ignored once the cutover is on.
    await scrapeStore.put(IMMO_PV_KEY, "stale immo bytes", "application/pdf");
    await geoDocumentsReader.put(GEO_PV_KEY, "geo bytes", "application/pdf");
    const scrapeHead = vi.spyOn(scrapeStore, "head");
    const mainHead = vi.spyOn(store, "head");
    const geoGet = vi.spyOn(geoDocumentsReader, "get");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: true,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(IMMO_PV_KEY)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("geo bytes");
    expect(geoGet).toHaveBeenCalledWith(GEO_PV_KEY);
    expect(scrapeHead).not.toHaveBeenCalled();
    expect(mainHead).not.toHaveBeenCalled();
  });

  it("flag ON: a geo miss is a 404 with NO fallback to the stale immo copy", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    await scrapeStore.put(IMMO_PV_KEY, "stale immo bytes", "application/pdf");
    const scrapeHead = vi.spyOn(scrapeStore, "head");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: true,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(IMMO_PV_KEY)}`,
    );

    expect(res.status).toBe(404);
    expect(scrapeHead).not.toHaveBeenCalled();
  });

  it("flag ON: an unmapped (non-PV) key still resolves via the legacy immo stores", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    const nonPvKey = `raw/avis-publics-testville/cas/${REPOINT_SHA}.pdf`;
    await scrapeStore.put(nonPvKey, "legacy bytes", "application/pdf");
    const geoHead = vi.spyOn(geoDocumentsReader, "head");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: true,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(nonPvKey)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("legacy bytes");
    expect(geoHead).not.toHaveBeenCalled();
  });

  it("flag ON: serves a mapped .docx PV STRICTLY from geo, preserving the extension", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    const immoDocxKey = `raw/proces-verbaux-ange-gardien/cas/${REPOINT_SHA}.docx`;
    const geoDocxKey = `raw/pv-index/cas/${REPOINT_SHA}.docx`;
    await geoDocumentsReader.put(geoDocxKey, "geo docx bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const geoGet = vi.spyOn(geoDocumentsReader, "get");
    const scrapeHead = vi.spyOn(scrapeStore, "head");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: true,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(immoDocxKey)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("geo docx bytes");
    expect(geoGet).toHaveBeenCalledWith(geoDocxKey);
    expect(scrapeHead).not.toHaveBeenCalled();
  });

  it("flag ON: an immo-internal artifact ext (docx stored as .bin) is NOT repointed — served from immo, never 404'd on geo", async () => {
    // KNOWN GAP: immo keys a docx PV as `<sha>.bin` (extForContentType has no docx
    // case), so it is not a geo document ext → mapToGeoKey returns null and the
    // resolver falls through to the immo legacy stores rather than missing on geo.
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const geoDocumentsReader = new MemoryStore();
    const immoBinKey = `raw/proces-verbaux-ange-gardien/cas/${REPOINT_SHA}.bin`;
    await scrapeStore.put(immoBinKey, "immo docx-as-bin bytes", "application/octet-stream");
    const geoHead = vi.spyOn(geoDocumentsReader, "head");
    const app = documentsRoute({
      store,
      scrapeStore,
      geoDocumentsReader,
      geoDocumentsRepoint: true,
    });

    const res = await app.request(
      `/api/documents/raw?rawRef=${encodeURIComponent(immoBinKey)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("immo docx-as-bin bytes");
    expect(geoHead).not.toHaveBeenCalled();
  });

  it("refuses to build the route when repoint is on but no geo reader is wired", () => {
    expect(() =>
      documentsRoute({
        store: new MemoryStore(),
        scrapeStore: new MemoryStore(),
        geoDocumentsRepoint: true,
      }),
    ).toThrow(/geoDocumentsReader is required/);
  });
});

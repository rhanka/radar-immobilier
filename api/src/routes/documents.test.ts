import { describe, expect, it } from "vitest";
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
});

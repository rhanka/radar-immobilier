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

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
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
});

describe("GET /api/documents/pdf/:docSha", () => {
  it("returns 404 for a malformed docSha", async () => {
    const app = documentsRoute({ store: new MemoryStore() });

    const res = await app.request("/api/documents/pdf/not-a-sha");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "document_not_found" });
  });

  it("returns 404 when no CAS object matches the docSha", async () => {
    const sha = "a".repeat(64);
    const app = documentsRoute({ store: new MemoryStore() });

    const res = await app.request(`/api/documents/pdf/${sha}`);

    expect(res.status).toBe(404);
  });

  it("streams the PDF resolved via .meta.json siblings", async () => {
    const store = new MemoryStore();
    const record = await seedPdf(store);
    const app = documentsRoute({ store });

    const res = await app.request(`/api/documents/pdf/${record.sha256}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  it("streams the PDF via the CAS fallback when no .meta.json exists", async () => {
    const store = new MemoryStore();
    const sha = "b".repeat(64);
    // CAS object only — no .meta.json sibling (mirrors proces-verbaux-rimouski).
    await store.put(
      `raw/proces-verbaux-rimouski/cas/${sha}.pdf`,
      "%PDF-1.5",
      "application/pdf",
    );
    const app = documentsRoute({ store });

    const res = await app.request(`/api/documents/pdf/${sha}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.5");
  });

  it("prefers the scrapeStore over the main store", async () => {
    const store = new MemoryStore();
    const scrapeStore = new MemoryStore();
    const sha = "c".repeat(64);
    await scrapeStore.put(
      `raw/proces-verbaux-rimouski/cas/${sha}.pdf`,
      "%PDF-scrape",
      "application/pdf",
    );
    const app = documentsRoute({ store, scrapeStore });

    const res = await app.request(`/api/documents/pdf/${sha}`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-scrape");
  });
});

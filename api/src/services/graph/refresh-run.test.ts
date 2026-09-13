import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { acquireRefreshPdfManifest } from "./refresh-run.js";

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

describe("acquireRefreshPdfManifest", () => {
  it("selects exact PDFs while retaining valid non-PDF acquisition evidence", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;
    const pdfKey = `raw/${sourceId}/cas/${sha("b")}.pdf`;
    const laterPdfKey = `raw/${sourceId}/cas/${sha("c")}.pdf`;

    const result = await acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId, status: "new", casKeys: [htmlKey, pdfKey, laterPdfKey], count: 3,
    }] });

    const manifest = new TextDecoder().decode(await store.get(result.manifestKey));
    expect(manifest).toContain(pdfKey);
    expect(manifest).not.toContain(htmlKey);
    expect(manifest).not.toContain(laterPdfKey);
  });

  it("fails before manifest publication when acquisition has no exact PDF", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;

    await expect(acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId, status: "seen", casKeys: [htmlKey], count: 1,
    }] })).rejects.toThrow("Selected city acquisition produced no exact PDF: city");
    expect(store.objects.size).toBe(0);
  });
});

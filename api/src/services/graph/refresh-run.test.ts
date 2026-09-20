import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { acquireRefreshPdfManifest, refreshSourceDelayMs } from "./refresh-run.js";

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
  it("applies the required two-second pacing jitter bounds", () => {
    expect(refreshSourceDelayMs(() => 0)).toBe(1_700);
    expect(refreshSourceDelayMs(() => 0.5)).toBe(2_000);
    expect(refreshSourceDelayMs(() => 0.999999)).toBe(2_300);
  });

  it("selects exact PDFs while retaining valid non-PDF acquisition evidence", async () => {
    const store = new MemoryStore();
    const sourceId = "proces-verbaux-city";
    const htmlKey = `raw/${sourceId}/cas/${sha("a")}.html`;
    const pdfKey = `raw/${sourceId}/cas/${sha("b")}.pdf`;
    const laterPdfKey = `raw/${sourceId}/cas/${sha("c")}.pdf`;

    const result = await acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId, status: "new", casKeys: [htmlKey, pdfKey, laterPdfKey], count: 3,
    }] });

    const manifest = new TextDecoder().decode(await store.get(result!.manifestKey));
    expect(manifest).toContain(pdfKey);
    expect(manifest).not.toContain(htmlKey);
    expect(manifest).not.toContain(laterPdfKey);
  });

  // THE DAILY CYCLE IS AN UPDATE JOB (owner, 2026-09-20): it reads the index —
  // that is the check — and downloads only the differential. A night on which
  // the municipality published nothing collects nothing, and that is the normal
  // result, not a failed Job. This function used to demand `count >= 1`.
  it("reports 'up to date' instead of failing when the city has nothing new", async () => {
    const store = new MemoryStore();
    const result = await acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId: "proces-verbaux-city", status: "seen", casKeys: [], count: 0,
      skippedKnown: 12,
    }] });
    expect(result).toBeNull();
    // Nothing is published for a run with no input: no manifest, no bytes.
    expect(store.objects.size).toBe(0);
  });

  // The distinction that matters: "nothing new" is not "could not look".
  it("still fails when the index itself could not be read", async () => {
    const store = new MemoryStore();
    await expect(acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async () => [{
      city: "city", sourceId: "proces-verbaux-city", status: "error", casKeys: [], count: 0,
      error: "[http] HTTP 404",
    }] })).rejects.toThrow("Selected city acquisition failed: city");
  });

  it("asks the scrape to skip documents an earlier run already collected", async () => {
    const store = new MemoryStore();
    let sawGuard: boolean | undefined;
    await acquireRefreshPdfManifest({ citySlug: "city", store, acquire: async (_cities, options) => {
      sawGuard = options.skipAlreadyCollectedUrls;
      return [{ city: "city", sourceId: "proces-verbaux-city", status: "seen", casKeys: [], count: 0 }];
    } });
    expect(sawGuard).toBe(true);
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

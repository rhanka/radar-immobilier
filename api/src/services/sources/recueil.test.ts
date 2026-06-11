/**
 * recueil.test.ts — RECUEIL persists each raw document as a CAS object PLUS a
 * sidecar `.meta.json` (RawDocumentRecord), so every stored object is
 * self-describing on S3. Spec docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1.
 */
import { describe, expect, it } from "vitest";

import {
  rawMetaKey,
  RawDocumentRecordSchema,
  type RawDocument,
  type RawDocumentRef,
  type SourceAdapter,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { runRecueil } from "./recueil.js";

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
}

function fakeAdapter(body: string): SourceAdapter {
  const ref: RawDocumentRef = {
    sourceKind: "avis-publics",
    city: "testville",
    url: "https://testville.qc.ca/avis",
    discoveredAt: "2026-06-08T00:00:00.000Z",
  };
  const raw: RawDocument = {
    ref,
    sourceKind: "avis-publics",
    city: "testville",
    url: ref.url,
    fetchedAt: "2026-06-08T09:30:00.000Z",
    contentType: "text/html",
    body: new TextEncoder().encode(body),
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

describe("runRecueil — raw bytes + sidecar meta.json", () => {
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
});

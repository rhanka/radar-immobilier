/**
 * Document-resolver unit tests.
 *
 * Régression INCIDENT « l'API signal ne répond pas » : `findDocumentMetadata`
 * ne doit PLUS JAMAIS balayer le bucket (`store.list("raw/")` + GET de chaque
 * `.meta.json`) quand le `.meta.json` d'un rawRef manque — en prod (~20k
 * objets, GET séquentiels ~356 ms) ce repli prenait ~50 min PAR ref et
 * l'endpoint per-city ne répondait jamais. Meta absent → `null`, point.
 *
 * Anti-régression : le chemin NOMINAL (meta présent) reste inchangé.
 */

import { describe, it, expect, vi } from "vitest";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";

import {
  findDocumentMetadata,
  loadDocumentMetadata,
  resolveRawContentType,
} from "./document-resolver.js";
import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const value = this.objects.get(key);
    return value ? { key, size: value.byteLength } : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
  }
}

async function seedRecord(store: MemoryStore) {
  const record = buildRawDocumentRecord({
    source: "proces-verbaux-plaisance",
    sourceUrl: "https://plaisance.ca/pv/2026-04-07.pdf",
    title: "Proces-verbal du 7 avril 2026",
    publishedAt: "2026-04-07",
    body: new TextEncoder().encode("%PDF-1.4"),
    fetchedAt: "2026-06-01T12:00:00.000Z",
    contentType: "application/pdf",
    provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
  });
  await store.put(record.storageKey, "%PDF-1.4", "application/pdf");
  await store.put(rawMetaKey(record.storageKey), JSON.stringify(record));
  return record;
}

describe("findDocumentMetadata", () => {
  it("resolves metadata by rawRef when the .meta.json is present (nominal path unchanged)", async () => {
    const store = new MemoryStore();
    const record = await seedRecord(store);

    const meta = await findDocumentMetadata(store, {
      rawRef: record.storageKey,
      docSha: record.sha256,
    });

    expect(meta).toMatchObject({
      rawRef: record.storageKey,
      docSha: record.sha256,
      sourceUrl: "https://plaisance.ca/pv/2026-04-07.pdf",
      contentType: "application/pdf",
      fetchedAt: "2026-06-01T12:00:00.000Z",
      title: "Proces-verbal du 7 avril 2026",
      publishedAt: "2026-04-07",
    });
  });

  // ── Régression : incident « l'API signal ne répond pas » ──────────────────
  it("returns null WITHOUT any bucket scan when the rawRef meta is missing (even with a docSha)", async () => {
    const store = new MemoryStore();
    await seedRecord(store); // le bucket contient d'AUTRES documents scannables
    const listSpy = vi.spyOn(store, "list").mockImplementation(() => {
      throw new Error("full bucket scan attempted — the incident regressed");
    });
    const getSpy = vi.spyOn(store, "get");

    const meta = await findDocumentMetadata(store, {
      rawRef: "raw/proces-verbaux-plaisance/cas/0000000000000000.pdf",
      docSha: "0000000000000000000000000000000000000000000000000000000000000000",
    });

    expect(meta).toBeNull();
    // Preuve du fix : AUCUN list (pas de scan) et AUCUN get (le head suffit à
    // constater l'absence du meta) — l'appel reste O(1) côté object store.
    expect(listSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("returns null WITHOUT any bucket scan for a docSha-only lookup", async () => {
    const store = new MemoryStore();
    const record = await seedRecord(store); // ce docSha EXISTE dans le bucket…
    const listSpy = vi.spyOn(store, "list");
    const headSpy = vi.spyOn(store, "head");
    const getSpy = vi.spyOn(store, "get");

    // …mais sans rawRef, on ne le cherche plus par scan : null, zéro I/O.
    const meta = await findDocumentMetadata(store, { docSha: record.sha256 });

    expect(meta).toBeNull();
    expect(listSpy).not.toHaveBeenCalled();
    expect(headSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("returns null for an unsafe rawRef without touching the store", async () => {
    const store = new MemoryStore();
    const headSpy = vi.spyOn(store, "head");

    expect(await findDocumentMetadata(store, { rawRef: "raw/../etc/passwd" })).toBeNull();
    expect(headSpy).not.toHaveBeenCalled();
  });
});

describe("loadDocumentMetadata", () => {
  it("returns null when the meta object is absent (head miss, no get)", async () => {
    const store = new MemoryStore();
    const getSpy = vi.spyOn(store, "get");

    const meta = await loadDocumentMetadata(
      store,
      "raw/proces-verbaux-plaisance/cas/deadbeef.pdf",
    );

    expect(meta).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("resolveRawContentType", () => {
  it("falls back to the meta record's contentType when head lacks one", async () => {
    const store = new MemoryStore();
    const record = await seedRecord(store);

    expect(await resolveRawContentType(store, record.storageKey)).toBe("application/pdf");
  });

  it("degrades to application/octet-stream when nothing is known", async () => {
    const store = new MemoryStore();

    expect(await resolveRawContentType(store, "raw/unknown/cas/na.pdf")).toBe(
      "application/octet-stream",
    );
  });
});

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
  mapToGeoKey,
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

// ── immo→geo repoint: pure O(1) CAS-key rewrite (NEVER a bucket scan) ──────
describe("mapToGeoKey", () => {
  const sha = "a".repeat(64);

  it.each([
    "plaisance",
    "saint-frederic",
    "salaberry-de-valleyfield",
    "sainte-catherine-de-la-jacques-cartier",
    "quebec",
  ])(
    "rewrites the immo PV CAS prefix for %s to the geo key, carrying the sha unchanged",
    (city) => {
      expect(mapToGeoKey(`raw/proces-verbaux-${city}/cas/${sha}.pdf`)).toBe(
        `raw/pv-index/cas/${sha}.pdf`,
      );
    },
  );

  // Extension is PRESERVED, not forced to `.pdf`: geo keys the real file type.
  it.each(["pdf", "docx", "doc", "odt", "rtf"])(
    "preserves the real .%s extension across the rewrite",
    (ext) => {
      expect(
        mapToGeoKey(`raw/proces-verbaux-ange-gardien/cas/${sha}.${ext}`),
      ).toBe(`raw/pv-index/cas/${sha}.${ext}`);
    },
  );

  it.each(["pdf", "docx"])(
    "is idempotent: an already-geo .%s key maps to itself",
    (ext) => {
      const geoKey = `raw/pv-index/cas/${sha}.${ext}`;
      expect(mapToGeoKey(geoKey)).toBe(geoKey);
    },
  );

  it("never injects a sha256: prefix — the 64-hex digest is copied verbatim", () => {
    const out = mapToGeoKey(`raw/proces-verbaux-quebec/cas/${sha}.pdf`);
    expect(out).toBe(`raw/pv-index/cas/${sha}.pdf`);
    expect(out).not.toContain("sha256:");
  });

  it.each([
    // non-PV source — not covered by the PV CAS contract
    ["non-PV source", `raw/avis-publics-testville/cas/${sha}.pdf`],
    // sha too short / not 64 hex
    ["short sha", "raw/proces-verbaux-testville/cas/deadbeef.pdf"],
    // uppercase hex is not a canonical CAS digest
    ["uppercase sha", `raw/proces-verbaux-testville/cas/${"A".repeat(64)}.pdf`],
    // wrong extension casing
    ["uppercase extension", `raw/proces-verbaux-testville/cas/${sha}.PDF`],
    // immo-internal artifacts under the same prefix: NOT geo documents, so they
    // return null (→ served from the immo legacy stores, never 404'd on geo).
    ["unknown-type .bin (immo docx download)", `raw/proces-verbaux-ange-gardien/cas/${sha}.bin`],
    ["extracted text .txt", `raw/proces-verbaux-testville/cas/${sha}.txt`],
    ["Office-viewer .html", `raw/proces-verbaux-ange-gardien/cas/${sha}.html`],
    // metadata sidecar, never the served payload
    ["meta sidecar", `raw/proces-verbaux-testville/cas/${sha}.pdf.meta.json`],
    // empty city segment
    ["empty city", `raw/proces-verbaux-/cas/${sha}.pdf`],
    // nested path under cas/
    ["nested path", `raw/proces-verbaux-testville/cas/nested/${sha}.pdf`],
    // traversal attempt
    ["traversal", `raw/proces-verbaux-testville/cas/../${sha}.pdf`],
    // not even a raw/ key
    ["non-raw key", `proces-verbaux-testville/cas/${sha}.pdf`],
  ])("does not fabricate a geo key for a %s (returns null)", (_label, key) => {
    expect(mapToGeoKey(key)).toBeNull();
  });
});

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

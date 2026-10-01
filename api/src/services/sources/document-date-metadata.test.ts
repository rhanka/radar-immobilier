import { buildRawDocumentRecord, documentDateFromPublishedAt, rawMetaKey } from "@radar/sources";
import { describe, expect, it } from "vitest";
import type { ObjectStore } from "../../storage/object-store.js";
import { hydrateGraphDocumentDates, persistDocumentDate, previewDocumentDateRecovery } from "./document-date-metadata.js";

function fixture(publishedAt?: string) {
  const objects = new Map<string, Uint8Array>();
  let writes = 0;
  const store: ObjectStore = {
    async get(key) { const body = objects.get(key); if (!body) throw new Error("missing"); return body; },
    async head(key) { return objects.has(key) ? { key } : null; },
    async put(key, body) { writes++; objects.set(key, typeof body === "string"
      ? new TextEncoder().encode(body) : new Uint8Array(body)); return { key }; },
  };
  const record = buildRawDocumentRecord({ source: "pv-test", sourceUrl: "https://example.test/pv.pdf",
    body: new TextEncoder().encode("original-pdf"), contentType: "application/pdf",
    fetchedAt: "2026-09-28T20:49:00.000Z", ...(publishedAt ? { publishedAt } : {}),
    provenance: { version: "1", userAgent: "test", viaObscura: false } });
  return { store, record, objects, writes: () => writes };
}

describe("document date persistence and stock preview", () => {
  it("should hydrate existing graph refs from exact metadata in the existing publication input", async () => {
    const fx = fixture("2026-07-28");
    await fx.store.put(rawMetaKey(fx.record.storageKey), JSON.stringify(fx.record));
    const graph = { nodes: [{ id: "existing-event", label: "Existing event", type: "DesignationEvent",
      refs: [{ rawRef: fx.record.storageKey, docSha: fx.record.sha256, page: 1, excerpt: "original" }] }], edges: [] };
    const hydrated = await hydrateGraphDocumentDates(fx.store, graph);
    expect(hydrated.nodes[0]?.refs?.[0]).toMatchObject({ publishedAt: "2026-07-28",
      fetchedAt: fx.record.fetchedAt, documentDate: { status: "known" } });
    expect(graph.nodes[0]?.refs?.[0]).not.toHaveProperty("publishedAt");
  });
  it("should enrich metadata idempotently without altering identity or the first scrap timestamp", async () => {
    const fx = fixture();
    await fx.store.put(rawMetaKey(fx.record.storageKey), JSON.stringify(fx.record));
    const date = documentDateFromPublishedAt("2026-07-28");
    const updated = await persistDocumentDate(fx.store, fx.record.storageKey, date);
    expect(updated).toMatchObject({ publishedAt: "2026-07-28", sha256: fx.record.sha256,
      storageKey: fx.record.storageKey, fetchedAt: fx.record.fetchedAt });
    const writes = fx.writes();
    await persistDocumentDate(fx.store, fx.record.storageKey, date);
    expect(fx.writes()).toBe(writes);
  });
  it("should preserve a known date, including month-only precision, against a later model candidate", async () => {
    const fx = fixture("2026-07");
    await fx.store.put(rawMetaKey(fx.record.storageKey), JSON.stringify(fx.record));
    const updated = await persistDocumentDate(fx.store, fx.record.storageKey,
      documentDateFromPublishedAt("2026-09-29"));
    expect(updated?.documentDate).toMatchObject({ status: "known", value: "2026-07", precision: "month" });
    expect(updated?.publishedAt).toBe("2026-07");
  });
  it("should leave a schema-incompatible sidecar untouched instead of failing the caller", async () => {
    const fx = fixture();
    const legacy = JSON.stringify({ sourceUrl: fx.record.sourceUrl });
    await fx.store.put(rawMetaKey(fx.record.storageKey), legacy);
    await expect(persistDocumentDate(fx.store, fx.record.storageKey, documentDateFromPublishedAt("2026-07-28")))
      .resolves.toBeNull();
    expect(new TextDecoder().decode(fx.objects.get(rawMetaKey(fx.record.storageKey)))).toBe(legacy);
    expect(fx.writes()).toBe(1);
  });
  it("should refuse cross-document metadata before any enrichment write", async () => {
    const fx = fixture();
    const other = fx.record.storageKey.replace(fx.record.sha256, "a".repeat(64));
    await fx.store.put(rawMetaKey(other), JSON.stringify(fx.record));
    await expect(persistDocumentDate(fx.store, other, documentDateFromPublishedAt("2026-07-28")))
      .rejects.toThrow("identity mismatch");
    expect(fx.writes()).toBe(1);
  });
  it("should preview manifest recovery, unknowns and conflicts without mutating storage", () => {
    const fx = fixture();
    expect(previewDocumentDateRecovery(fx.record, ["2026-07-28"]).status).toBe("recoverable");
    expect(previewDocumentDateRecovery(fx.record, []).status).toBe("unknown");
    expect(previewDocumentDateRecovery(fx.record, ["2026-07-28", "2026-09-29"]).status).toBe("conflict");
    expect(fx.writes()).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { matchesDocumentDateWindow } from "@radar/domain";
import { buildRawDocumentRecord, rawMetaKey } from "@radar/sources";
import {
  buildScopedSignalCardViews,
  toSignalCardView,
  type StoredSignalNode,
} from "../src/services/facets/scoped-signal-cards.js";
import type { GraphSignalCard } from "../src/routes/graph-signals.js";
import type { ObjectInfo, ObjectStore } from "../src/storage/object-store.js";

function card(props: Record<string, unknown>): GraphSignalCard {
  return {
    id: "sig-1", type: "Signal", label: "Avis", citySlug: "valleyfield", sourceRef: null,
    facetFingerprint: "fp", createdAt: null, description: "d", publishedAt: null,
    docRefs: [], evidence: {} as GraphSignalCard["evidence"],
    classification: {} as GraphSignalCard["classification"],
    legacySubset: {} as GraphSignalCard["legacySubset"],
    bPrime: {} as GraphSignalCard["bPrime"], etape: "avis_motion",
    regulatoryStatus: "anticipation", props,
  };
}

describe("toSignalCardView", () => {
  it("keeps allowlisted card fields and drops unknown props keys", () => {
    const view = toSignalCardView(card({
      properties: { category: "rezonage", etape: "avis_motion", adresse: "1 rue X", demandeur: "Y" },
      secretKey: "drop", properties2: {},
    }));
    expect(view.etape).toBe("avis_motion");
    expect(view.props).toEqual({ properties: { category: "rezonage", etape: "avis_motion" } });
  });
  it("keeps projected ref dates needed by the date lens", () => {
    const view = toSignalCardView(card({ refs: [{ publishedAt: "2026-01-05", rawRef: "s3://x", excerpt: "e" }] }));
    expect(view.props).toEqual({ refs: [{ publishedAt: "2026-01-05", excerpt: "e" }] });
  });
  it("projects nested properties.refs with the same bounded item shape", () => {
    const view = toSignalCardView(card({
      properties: { category: "rezonage", refs: [{ publishedAt: "2026-01-05", rawRef: "s3://x", excerpt: "e" }] },
    }));
    expect(view.props).toEqual({
      properties: { category: "rezonage", refs: [{ publishedAt: "2026-01-05", excerpt: "e" }] },
    });
  });
  it("restores S3-only dates via one cached lightweight meta read per distinct ref", async () => {
    const record = buildRawDocumentRecord({
      source: "proces-verbaux-westmount",
      sourceUrl: "https://westmount.ca/pv/2026-11-02.pdf",
      title: "Proces-verbal",
      publishedAt: "2026-11-02",
      body: new TextEncoder().encode("%PDF-1.4"),
      fetchedAt: "2026-11-03T12:00:00.000Z",
      contentType: "application/pdf",
      provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
    });
    const objects = new Map<string, Uint8Array>();
    objects.set(rawMetaKey(record.storageKey), new TextEncoder().encode(JSON.stringify(record)));
    const head = vi.fn(async (key: string): Promise<ObjectInfo | null> =>
      objects.has(key) ? { key, size: objects.get(key)!.byteLength } : null);
    const get = vi.fn(async (key: string): Promise<Uint8Array> => objects.get(key)!);
    const store = { head, get } as unknown as ObjectStore;
    const node = (id: string): StoredSignalNode => ({
      id, type: "Signal", citySlug: "westmount", sourceRef: null,
      createdAt: new Date("2026-01-01"), label: "Avis",
      props: { secretKey: "drop", refs: [{ docSha: record.sha256, rawRef: record.storageKey, excerpt: "preuve", page: 2 }] },
    });
    const views = await buildScopedSignalCardViews({ store }, [node("s1"), node("s2")], "westmount");
    expect(views[0]!.publishedAt).toBe("2026-11-02");
    expect(views[0]!.docRefs[0]!.publishedAt).toBe("2026-11-02");
    expect(views[0]!.evidence.documentDate).toBe("2026-11-02");
    expect(views[0]!.evidence.completeness.hasDocumentDate).toBe(true);
    expect(views[0]!.props).not.toHaveProperty("secretKey");
    // Cache: two cards sharing one document cost one head + one get, no list/scan.
    expect(head).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("does not touch the store when the graph already carries the dates", async () => {
    const head = vi.fn(async () => null);
    const store = { head, get: vi.fn(async () => new Uint8Array()) } as unknown as ObjectStore;
    const node: StoredSignalNode = {
      id: "s1", type: "Signal", citySlug: "westmount", sourceRef: null,
      createdAt: new Date("2026-01-01"), label: "Avis",
      props: { refs: [{ docSha: "d".repeat(64), rawRef: "raw/x/pv.pdf", publishedAt: "2026-01-05", excerpt: "e" }] },
    };
    const views = await buildScopedSignalCardViews({ store }, [node], "westmount");
    expect(views[0]!.publishedAt).toBe("2026-01-05");
    expect(head).not.toHaveBeenCalled();
  });
  it("returns degraded cards within budget when the store hangs in-flight", async () => {
    let seenSignal: AbortSignal | undefined;
    const head = vi.fn(async (_key: string, opts?: { signal?: AbortSignal }) => {
      seenSignal = opts?.signal;
      return new Promise<never>(() => {});
    });
    const store = { head, get: vi.fn(async () => new Uint8Array()) } as unknown as ObjectStore;
    const node: StoredSignalNode = {
      id: "s1", type: "Signal", citySlug: "westmount", sourceRef: null,
      createdAt: new Date("2026-01-01"), label: "Avis",
      props: { refs: [{ docSha: "d".repeat(64), rawRef: "raw/x/pv.pdf", excerpt: "e" }] },
    };
    const started = Date.now();
    const views = await buildScopedSignalCardViews({ store, docEnrichmentBudgetMs: 80 }, [node], "westmount");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(views[0]!.publishedAt).toBeNull();
    expect(seenSignal?.aborted).toBe(true);
  });
  it("bounds concurrent distinct-ref reads and applies the date to the matching ref only", async () => {
    const makeRecord = (n: number) => buildRawDocumentRecord({
      source: "proces-verbaux-westmount",
      sourceUrl: `https://westmount.ca/pv/${n}.pdf`,
      title: "Proces-verbal",
      publishedAt: "2026-11-02",
      body: new TextEncoder().encode(`%PDF-${n}`),
      fetchedAt: "2026-11-03T12:00:00.000Z",
      contentType: "application/pdf",
      provenance: { version: "1.0.0", userAgent: "radar/test", viaObscura: false },
    });
    const records = Array.from({ length: 20 }, (_, n) => makeRecord(n));
    const objects = new Map(records.map((r) => [rawMetaKey(r.storageKey), new TextEncoder().encode(JSON.stringify(r))]));
    let active = 0; let maxActive = 0;
    const head = vi.fn(async (key: string) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 25));
      active--;
      return objects.has(key) ? { key, size: objects.get(key)!.byteLength } : null;
    });
    const get = vi.fn(async (key: string) => objects.get(key)!);
    const store = { head, get } as unknown as ObjectStore;
    const nodes = records.map((r, n): StoredSignalNode => ({
      id: `s${n}`, type: "Signal", citySlug: "westmount", sourceRef: null,
      createdAt: new Date("2026-01-01"), label: "Avis",
      props: { refs: [{ docSha: r.sha256, rawRef: r.storageKey, excerpt: "e" }] },
    }));
    // Second-ref fallback (B2) + matching-ref attribution (B3) on nodes[0]:
    nodes[0]!.props = { refs: [
      { docSha: "a".repeat(64), rawRef: "raw/missing.pdf", excerpt: "e" },
      { docSha: records[0]!.sha256, rawRef: records[0]!.storageKey, excerpt: "e" },
    ] };
    const views = await buildScopedSignalCardViews({ store, docEnrichmentBudgetMs: 5_000 }, nodes, "westmount");
    expect(maxActive).toBeLessThanOrEqual(8);
    expect(views[1]!.publishedAt).toBe("2026-11-02");
    expect(views[0]!.docRefs[0]!.publishedAt).toBeUndefined();
    expect(views[0]!.docRefs[1]!.publishedAt).toBe("2026-11-02");
    const propsRefs = views[0]!.props.refs as Array<Record<string, unknown>>;
    expect(propsRefs[0]!.publishedAt).toBeUndefined();
    expect(propsRefs[1]!.publishedAt).toBe("2026-11-02");
  });
  it("keeps the client date lens in parity on a nested-refs-only node", () => {
    const full = {
      properties: { etape: "avis_motion", refs: [{ publishedAt: "2026-01-05", fetchedAt: "2026-01-05T12:00:00.000Z" }] },
    };
    const window = { dateFrom: "2026-01-01", dateTo: "2026-01-31" };
    const outside = { dateFrom: "2026-02-01", dateTo: "2026-02-28" };
    const view = toSignalCardView(card(full));
    expect(matchesDocumentDateWindow(full, window)).toBe(true);
    expect(matchesDocumentDateWindow(view.props, window)).toBe(true);
    expect(matchesDocumentDateWindow(view.props, outside)).toBe(false);
  });
});

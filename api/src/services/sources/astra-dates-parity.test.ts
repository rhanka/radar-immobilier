import { describe, expect, it, vi } from "vitest";
import { z as bundledV3 } from "zod/v3";
import { buildRawDocumentRecord, resolveDocumentDate } from "@radar/sources";
import { loadDocumentMetadata } from "./document-resolver.js";
import { projectSignalCard } from "../facets/classification-card.js";
import { toDegradedSignalCard } from "../../routes/graph-signals.js";

const z3: typeof bundledV3 = process.env.ZOD3_REFERENCE
  ? (await import(/* @vite-ignore */ process.env.ZOD3_REFERENCE)).z : bundledV3;
const values = ["2026-10-27T12:30Z", "2026-10-27T12:30:00-0400",
  "2026-10-27T12:30-0400", "2026-10-27T12:30+04:00",
  "2024-02-29T00:00Z", "2026-02-29T12:30Z", "2026-10-27T24:00Z"];
describe("Astra historical documentary dates survive read boundaries", () => {
  for (const value of values) it("preserves source date " + value, async () => {
    const accepted = z3.string().datetime({ offset: true }).safeParse(value).success;
    const documentDate = { status: "known" as const, value, precision: "day" as const,
      kind: "document" as const, method: "manifest" as const, evidence: { field: "publishedAt" } };
    expect(resolveDocumentDate({ publishedAt: value })).toEqual(accepted
      ? { ...documentDate, method: "listing" } : { status: "unknown" });
    const seed = buildRawDocumentRecord({ source: "proces-verbaux-testville",
      sourceUrl: "https://docs.test/pv.pdf", fetchedAt: "2026-10-27T12:30:00Z",
      body: new TextEncoder().encode("pdf"), contentType: "application/pdf",
      provenance: { version: "1", userAgent: "radar/test", viaObscura: false } });
    const record = { ...seed, publishedAt: value, documentDate, fetchedAt: "2026-10-27T12:30Z" };
    const reader = { get: vi.fn(async () => new TextEncoder().encode(JSON.stringify(record))),
      head: vi.fn(async (key: string) => ({ key })) };
    expect(await loadDocumentMetadata(reader, seed.storageKey)).toEqual(accepted ? {
      rawRef: seed.storageKey, docSha: seed.sha256, sourceUrl: seed.sourceUrl,
      contentType: seed.contentType, fetchedAt: record.fetchedAt, documentDate, publishedAt: value,
    } : null);
    const canonical = toDegradedSignalCard({ id: "id", type: "Signal", citySlug: "city",
      sourceRef: null, label: "Dated signal", createdAt: new Date("2026-10-27"), props: {
        refs: [{ docSha: seed.sha256, sourceUrl: seed.sourceUrl, page: 1, excerpt: "Citation" }],
      } });
    const projected = projectSignalCard({ ...canonical, docRefs: canonical.docRefs.map(
      (ref) => ({ ...ref, publishedAt: value, fetchedAt: record.fetchedAt })) }, "2026-10-27");
    expect(projected.docRefs[0]!.publishedAt).toBe(accepted ? value : null);
    expect(projected.docRefs[0]!.fetchedAt).toBe(record.fetchedAt);
    expect(projected.missingEvidence.includes("documentDate")).toBe(!accepted);
  });
});

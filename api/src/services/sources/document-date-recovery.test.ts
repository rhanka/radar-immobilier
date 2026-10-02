import { describe, expect, it } from "vitest";
import { matchesDocumentDateWindow } from "@radar/domain";

import type { DocumentMetadata } from "./document-resolver.js";
import { collectGraphRawRefs, planGraphDocumentDateRecovery } from "./document-date-recovery.js";

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const rawA = `raw/proces-verbaux-val-des-monts/cas/${shaA}.pdf`;
const rawB = `raw/proces-verbaux-val-des-monts/cas/${shaB}.pdf`;
const september = { status: "known", value: "2026-09-29", precision: "day", kind: "session", method: "header",
  evidence: { page: 1, excerpt: "Séance du 29 septembre 2026" } } as const;

const metadata: Record<string, DocumentMetadata> = {
  [rawA]: { rawRef: rawA, docSha: shaA, sourceUrl: "https://example.test/a.pdf", contentType: "application/pdf",
    fetchedAt: "2026-09-30T01:30:00.000Z", documentDate: september, publishedAt: "2026-09-29" },
  // July agenda: the documentary date is unknown in metadata, only the collection instant is.
  [rawB]: { rawRef: rawB, docSha: shaB, sourceUrl: "https://example.test/b.pdf", contentType: "application/pdf",
    fetchedAt: "2026-09-29T14:00:00.000Z", documentDate: { status: "unknown" } },
};
const lookup = async (rawRef: string) => metadata[rawRef] ?? null;

function legacyRef(rawRef: string, docSha: string) {
  return { page: 1, docSha, rawRef, excerpt: "Projet de huit logements", sourceUrl: "https://example.test" };
}

function graph() {
  return {
    nodes: [
      { id: "event-lot", type: "DesignationEvent", refs: [legacyRef(rawA, shaA)], properties: { etape_date: "2026-09-29" } },
      { id: "signal-parcs", type: "Signal", refs: [legacyRef(rawA, shaA)], properties: {} },
      { id: "signal-july", type: "Signal", refs: [legacyRef(rawB, shaB)], properties: {} },
      { id: "signal-missing", type: "Signal", refs: [legacyRef(`raw/x/cas/${"c".repeat(64)}.pdf`, "c".repeat(64))] },
      { id: "zone-1", type: "Zone", properties: { refs: [legacyRef(rawB, shaB)] } },
    ],
    edges: [{ source: "event-lot", target: "zone-1", type: "concerne", refs: [legacyRef(rawA, shaA)] }],
  };
}

describe("planGraphDocumentDateRecovery", () => {
  it("projects fetchedAt and the known documentary date with provenance onto legacy refs", async () => {
    const plan = await planGraphDocumentDateRecovery(graph(), lookup);
    const nodes = plan.nextGraph.nodes as { id: string; refs?: Record<string, unknown>[]; properties?: Record<string, unknown> }[];
    expect(nodes[0]!.refs![0]).toMatchObject({ fetchedAt: "2026-09-30T01:30:00.000Z", documentDate: september,
      publishedAt: "2026-09-29", excerpt: "Projet de huit logements" });
    expect(nodes[2]!.refs![0]).toMatchObject({ fetchedAt: "2026-09-29T14:00:00.000Z" });
    expect(nodes[2]!.refs![0]).not.toHaveProperty("documentDate");
    expect((nodes[4]!.properties!.refs as Record<string, unknown>[])[0]).toHaveProperty("fetchedAt");
    expect(plan.stats).toMatchObject({ refs: 6, refsUpdated: 5, fetchedAtAdded: 5, documentDateAdded: 3,
      refsWithoutMetadata: 1, refsWithoutDocumentDate: 3, refsWithoutFetchedAt: 1, conflicts: 0, documentsUpdated: 2,
      signals: 4, signalsUpdated: 3, signalsWithoutDocumentDate: 2, signalsWithoutFetchedAt: 1 });
    expect(plan.updatedSignalIds).toEqual(["event-lot", "signal-parcs", "signal-july"]);
  });

  it("makes the recovered refs visible to the shared date rule in both clocks", async () => {
    const plan = await planGraphDocumentDateRecovery(graph(), lookup);
    const nodes = plan.nextGraph.nodes as { id: string }[];
    const period = { dateFrom: "2026-09-29", dateTo: "2026-09-30" };
    expect(nodes.filter((node) => matchesDocumentDateWindow(node, period)).map((node) => node.id))
      .toEqual(["event-lot", "signal-parcs"]);
    expect(nodes.filter((node) => matchesDocumentDateWindow(node, { ...period, dateBasis: "scrap" }))
      .map((node) => node.id)).toEqual(["event-lot", "signal-parcs", "signal-july", "zone-1"]);
  });

  it("is idempotent: a second run on its own output changes nothing", async () => {
    const first = await planGraphDocumentDateRecovery(graph(), lookup);
    const second = await planGraphDocumentDateRecovery(first.nextGraph, lookup);
    expect(second.changed).toBe(false);
    expect(second.nextGraph).toBe(first.nextGraph);
    expect(second.stats).toMatchObject({ refsUpdated: 0, fetchedAtAdded: 0, documentDateAdded: 0, conflicts: 0,
      refsWithoutDocumentDate: 3 });
  });

  it("never overwrites an existing value and reports disagreements as conflicts", async () => {
    const input = { nodes: [{ id: "signal-x", type: "Signal", refs: [
      { ...legacyRef(rawA, shaA), publishedAt: "2026-09-01", fetchedAt: "2026-09-02T00:00:00.000Z" },
      { ...legacyRef(rawB, shaA) },
    ] }] };
    const plan = await planGraphDocumentDateRecovery(input, lookup);
    expect(plan.changed).toBe(false);
    expect(plan.nextGraph).toBe(input);
    expect(plan.conflicts.map((conflict) => conflict.field)).toEqual(["fetchedAt", "documentDate", "docSha"]);
    expect(plan.stats.conflicts).toBe(3);
  });

  it("completes an explicit unknown documentary status but keeps an ambiguous one", async () => {
    const plan = await planGraphDocumentDateRecovery({ nodes: [{ id: "s", type: "Signal", refs: [
      { ...legacyRef(rawA, shaA), documentDate: { status: "unknown" } },
      { ...legacyRef(rawA, shaA), documentDate: { status: "ambiguous", candidates: ["2026-09-29", "2026-09-30"], reason: "x" } },
    ] }] }, lookup);
    const refs = (plan.nextGraph.nodes as { refs: Record<string, unknown>[] }[])[0]!.refs;
    expect(refs[0]).toMatchObject({ documentDate: september, publishedAt: "2026-09-29" });
    expect(refs[1]!.documentDate).toMatchObject({ status: "ambiguous" });
    expect(plan.stats.conflicts).toBe(1);
  });

  it("collects each cited rawRef once across nodes, nested refs and edges", () => {
    expect(collectGraphRawRefs(graph()).sort()).toEqual([rawA, rawB, `raw/x/cas/${"c".repeat(64)}.pdf`].sort());
  });
});

/**
 * GH #812 — classifier of the city-key repair (pure, no DB). Spec K11.
 */
import { describe, expect, it } from "vitest";

import {
  cityDocShas,
  classifyNode,
  comparable,
  idsWithLostContent,
  jsonEqual,
  lostElements,
  refDocSha,
  type ComparableNodeRow,
} from "./city-key-repair.js";
import { buildNodeRow, prepareCityProjection } from "./graph-store.js";

const ref = (city: string, sha: string, extra: Record<string, unknown> = {}) => ({
  docSha: sha,
  rawRef: `raw/proces-verbaux-${city}/cas/${sha}.pdf`,
  excerpt: `${city} ${sha}`,
  page: 1,
  ...extra,
});

function row(city: string, id: string, over: Partial<{ label: string; refs: unknown[]; properties: Record<string, unknown>; description: string; source_file: string }> = {}): ComparableNodeRow {
  return comparable(
    buildNodeRow(
      {
        id,
        type: "Bylaw",
        label: over.label ?? `${id} (${city})`,
        ...(over.refs ? { refs: over.refs as Array<Record<string, unknown>> } : {}),
        ...(over.properties ? { properties: over.properties } : {}),
        ...(over.description ? { description: over.description } : {}),
        ...(over.source_file ? { source_file: over.source_file } : {}),
      },
      city,
    ),
  );
}

describe("jsonEqual / refDocSha", () => {
  it("compares objects regardless of key order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
  it("reads the docSha from the field, else from a CAS rawRef, never from a generated ref", () => {
    expect(refDocSha({ docSha: "X" })).toBe("X");
    expect(refDocSha({ rawRef: "raw/proces-verbaux-gore/cas/Y.pdf" })).toBe("Y");
    expect(refDocSha({ rawRef: "generated://gore/cas/Z.pdf" })).toBeNull();
  });
});

describe("lostElements", () => {
  it("is empty when the PG row equals the city's own S3 row", () => {
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")], properties: { etape: "adoption" } });
    expect(lostElements(s3, s3)).toEqual([]);
  });
  it("lists every projected field and ref that S3 does not carry", () => {
    const pg = row("gore", "bylaw-242", { label: "old", refs: [ref("gore", "G1"), ref("barkmere", "B1")], properties: { etape: "avis" } });
    const s3 = row("gore", "bylaw-242", { label: "new", refs: [ref("gore", "G1")], properties: { etape: "adoption" } });
    const lost = lostElements(pg, s3);
    expect(lost).toContainEqual({ kind: "field", path: "label", value: "old" });
    expect(lost).toContainEqual({ kind: "field", path: "props.properties.etape", value: "avis" });
    expect(lost).toContainEqual({ kind: "ref", value: ref("barkmere", "B1") });
    expect(lost.filter((e) => e.kind === "ref")).toHaveLength(1);
  });
  it("detects a citation or rawRef changed under an unchanged docSha", () => {
    const pg = row("gore", "x", { refs: [ref("gore", "G1", { excerpt: "foreign citation" })] });
    const s3 = row("gore", "x", { refs: [ref("gore", "G1")] });
    expect(lostElements(pg, s3)).toEqual([{ kind: "ref", value: ref("gore", "G1", { excerpt: "foreign citation" }) }]);
  });
  it("treats a node absent from the city's file as fully lost", () => {
    const pg = row("gore", "x");
    expect(lostElements(pg, undefined).length).toBeGreaterThan(0);
  });
});

describe("classifyNode (K11)", () => {
  const goreShas = new Set(["G1", "G2"]);

  it("clean when nothing is lost", () => {
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")] });
    expect(classifyNode(s3, s3, [], goreShas).class).toBe("clean");
  });

  it("foreign: the whole row is barkmere's (anchored on a docSha foreign to gore's file)", () => {
    const bark = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1")], properties: { resolution: "2026-14" } });
    const pg = { ...bark };
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")] });
    const c = classifyNode(pg, s3, [{ city: "barkmere", row: bark }], goreShas);
    expect(c.class).toBe("foreign");
    expect(c.explainedBy).toEqual(["barkmere"]);
  });

  it("foreign even when the other city's ref has gained a field since (date recovery)", () => {
    const pg = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1")] });
    const barkNow = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1", { date: "2026-03-02" })] });
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")] });
    expect(classifyNode(pg, s3, [{ city: "barkmere", row: barkNow }], goreShas).class).toBe("foreign");
  });

  it("a docSha also cited elsewhere in the city's file is not an anchor; not the other city's whole row → clean (guards apply)", () => {
    // B1 is cited elsewhere in gore's file → not an anchor; the row is not barkmere's whole row → clean (standard guards apply)
    const pg = row("gore", "bylaw-242", { label: "Règlement 242", refs: [ref("barkmere", "B1")] });
    const s3 = row("gore", "bylaw-242", { label: "Règlement 242" });
    const bark = row("barkmere", "bylaw-242", { label: "Autre", refs: [ref("barkmere", "B1")] });
    expect(classifyNode(pg, s3, [{ city: "barkmere", row: bark }], new Set(["G1", "B1"])).class).toBe("clean");
  });

  it("unknown: legacy merge — foreign refs mixed with a lost local value no other city explains", () => {
    const bark = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1")] });
    // PG = gore's OLD local ref (G0, no longer in gore's file) ∪ barkmere's ref
    const pg = row("barkmere", "bylaw-242", { refs: [ref("gore", "G0"), ref("barkmere", "B1")] });
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")] });
    const c = classifyNode(pg, s3, [{ city: "barkmere", row: bark }], goreShas);
    expect(c.class).toBe("unknown");
  });

  it("unknown: a foreign docSha that no other city's same-id row carries anymore", () => {
    const pg = row("gore", "bylaw-242", { refs: [ref("barkmere", "B9")] });
    const s3 = row("gore", "bylaw-242");
    expect(classifyNode(pg, s3, [{ city: "barkmere", row: row("barkmere", "bylaw-242") }], goreShas).class).toBe("unknown");
  });

  it("unknown: property changed under the foreign evidence (not the same value in the other city)", () => {
    const bark = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1")], properties: { etape: "adoption" } });
    const pg = row("barkmere", "bylaw-242", { refs: [ref("barkmere", "B1")], properties: { etape: "avis" } });
    const s3 = row("gore", "bylaw-242", { refs: [ref("gore", "G1")] });
    expect(classifyNode(pg, s3, [{ city: "barkmere", row: bark }], goreShas).class).toBe("unknown");
  });

  it("foreign: ref-less contamination when the PG row is another city's whole row (zone node)", () => {
    const bark = row("barkmere", "zone-c-6", { label: "C-6 (barkmere)", description: "zone commerciale barkmere" });
    const s3 = row("gore", "zone-c-6", { label: "C-6 (gore)" });
    expect(classifyNode({ ...bark }, s3, [{ city: "barkmere", row: bark }], goreShas).class).toBe("foreign");
  });

  it("foreign: a foreign sourceRef / root prop only, when the row is the other city's row", () => {
    const bark = row("barkmere", "x", { label: "same", source_file: "raw/proces-verbaux-barkmere/cas/B1.pdf" });
    const s3 = row("gore", "x", { label: "same" });
    expect(classifyNode({ ...bark }, s3, [{ city: "barkmere", row: bark }], goreShas).class).toBe("foreign");
  });

  it("clean: the city's own evolution (label changed, no foreign anchor, not another city's row)", () => {
    const pg = row("gore", "zone-h-1", { label: "Zone H-1" });
    const s3 = row("gore", "zone-h-1", { label: "Zone H-1 (résidentielle)" });
    const coincidence = row("barkmere", "zone-h-1", { label: "Zone H-1", description: "autre contenu" });
    expect(classifyNode(pg, s3, [{ city: "barkmere", row: coincidence }], goreShas).class).toBe("clean");
  });

  it("unknown: a docSha absent from the city's file that no other city explains (refused, never dropped silently)", () => {
    // G0 is gore's own old PV: absent from gore's file → anchored, but unexplained → unknown (refused)
    const pg = row("gore", "x", { refs: [ref("gore", "G0")] });
    const s3 = row("gore", "x");
    expect(classifyNode(pg, s3, [], goreShas).class).toBe("unknown");
  });
});

describe("cityDocShas / idsWithLostContent", () => {
  const graph = {
    nodes: [
      { id: "bylaw-242", type: "Bylaw", label: "242", refs: [ref("gore", "G1")] },
      { id: "zone-c-6", type: "Zone", label: "C-6" },
    ],
    edges: [{ source: "bylaw-242", target: "zone-c-6", type: "regulates", refs: [{ docSha: "G2" }] }],
  };
  const projection = prepareCityProjection("gore", graph);

  it("collects docShas from node and edge refs", () => {
    expect([...cityDocShas(projection)].sort()).toEqual(["G1", "G2"]);
  });

  it("returns only the ids whose PG content differs from the city's S3 rows", () => {
    const pg = projection.nodeRows.map(comparable);
    pg[1] = { ...pg[1]!, label: "C-6 (barkmere)" };
    expect(idsWithLostContent(pg, projection)).toEqual(["zone-c-6"]);
  });
});

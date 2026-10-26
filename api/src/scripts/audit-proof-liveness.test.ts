import { describe, expect, it } from "vitest";
import { collectFromNode, collectFromGraph } from "./audit-proof-liveness.js";

describe("collectFromNode", () => {
  it("extrait sourceUrl depuis refs et properties, avec docSha d'archive", () => {
    const node = {
      type: "Source",
      refs: [{ docSha: "abc123", sourceUrl: "https://ville.example/pv.pdf" }],
      properties: { docSha: "abc123", sourceUrl: "https://ville.example/pv.pdf" },
    };
    const found = collectFromNode(node);
    const bySrc = found.filter((f) => f.url === "https://ville.example/pv.pdf");
    expect(bySrc.length).toBeGreaterThanOrEqual(1);
    expect(bySrc.every((f) => f.docSha === "abc123")).toBe(true);
    expect(found.map((f) => f.field)).toContain("refs.sourceUrl");
    expect(found.map((f) => f.field)).toContain("properties.sourceUrl");
  });

  it("collecte rawRef, documentUrl, url_grille et source_ref", () => {
    const node = {
      type: "Signal",
      refs: [{ rawRef: "https://a.example/1", documentUrl: "https://b.example/2" }],
      properties: { url_grille: "https://c.example/grille" },
      source_ref: "https://d.example/src",
    };
    const urls = collectFromNode(node).map((f) => f.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://a.example/1",
        "https://b.example/2",
        "https://c.example/grille",
        "https://d.example/src",
      ]),
    );
  });

  it("ignore les valeurs non-URL (chemins locaux, vides, non-http)", () => {
    const node = {
      type: "Source",
      refs: [{ sourceUrl: "/tmp/local.pdf", path: "/tmp/x" }],
      properties: { sourceUrl: "", url_grille: "ftp://nope" },
      source_ref: "  ",
    };
    expect(collectFromNode(node)).toEqual([]);
  });

  it("tolère refs absents ou properties malformés sans jeter", () => {
    expect(collectFromNode({ type: "Zone" })).toEqual([]);
    expect(collectFromNode({ refs: "not-an-array", properties: null })).toEqual([]);
  });
});

describe("collectFromGraph", () => {
  it("agrège les villes et les champs par URL distincte", () => {
    const map = new Map();
    collectFromGraph("ville-a", {
      nodes: [{ type: "Source", refs: [{ sourceUrl: "https://x.example/pv.pdf", docSha: "sha1" }] }],
    }, map);
    collectFromGraph("ville-b", {
      nodes: [{ type: "Signal", properties: { sourceUrl: "https://x.example/pv.pdf" } }],
    }, map);

    expect(map.size).toBe(1);
    const entry = map.get("https://x.example/pv.pdf");
    expect([...entry.cities].sort()).toEqual(["ville-a", "ville-b"]);
    expect([...entry.fields].sort()).toEqual(["properties.sourceUrl", "refs.sourceUrl"]);
    expect([...entry.docShas]).toEqual(["sha1"]);
  });

  it("tolère un graphe sans nœuds", () => {
    const map = new Map();
    collectFromGraph("vide", { nodes: [] }, map);
    collectFromGraph("vide2", {}, map);
    expect(map.size).toBe(0);
  });
});

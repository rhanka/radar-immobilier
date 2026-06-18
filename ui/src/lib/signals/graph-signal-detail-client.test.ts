/**
 * Tests for extractDocRefs — the type-guard that parses props.refs from
 * graph_nodes into typed SignalDocRef[].
 */
import { describe, it, expect } from "vitest";
import {
  extractDocRefs,
  extractSignalEvidence,
} from "./graph-signal-detail-client.js";

describe("extractDocRefs", () => {
  it("returns [] when props has no refs key", () => {
    expect(extractDocRefs({})).toEqual([]);
  });

  it("returns [] when props.refs is not an array", () => {
    expect(extractDocRefs({ refs: "not-an-array" })).toEqual([]);
    expect(extractDocRefs({ refs: null })).toEqual([]);
    expect(extractDocRefs({ refs: 42 })).toEqual([]);
  });

  it("keeps citation-only refs instead of dropping evidence", () => {
    expect(extractDocRefs({ refs: [{ excerpt: "foo" }] })).toEqual([
      { docSha: "ref-1", excerpt: "foo" },
    ]);
  });

  it("returns [] when refs items have no usable identifier, URL or citation", () => {
    expect(extractDocRefs({ refs: [{ docSha: 123 }] })).toEqual([]);
  });

  it("extracts a minimal ref with only docSha", () => {
    const result = extractDocRefs({ refs: [{ docSha: "abc123" }] });
    expect(result).toEqual([{ docSha: "abc123" }]);
  });

  it("extracts a full vaudreuil-dorion-style ref (sourceUrl + excerpt, no page)", () => {
    const result = extractDocRefs({
      refs: [
        {
          docSha: "17f2227e",
          excerpt: "Projet de reglement no 1835-01",
          sourceUrl: "https://www.ville.vaudreuil-dorion.qc.ca/uploads/20260601_cons.pdf",
        },
      ],
    });
    expect(result).toEqual([
      {
        docSha: "17f2227e",
        excerpt: "Projet de reglement no 1835-01",
        sourceUrl: "https://www.ville.vaudreuil-dorion.qc.ca/uploads/20260601_cons.pdf",
      },
    ]);
    expect(result[0].page).toBeUndefined();
    expect(result[0].rawRef).toBeUndefined();
  });

  it("extracts a saints-anges-style ref (page + rawRef + excerpt, no sourceUrl)", () => {
    const result = extractDocRefs({
      refs: [
        {
          docSha: "a74652366eeffeea",
          excerpt: "mineures aux règlements d'urbanisme",
          rawRef: "/tmp/scw-docs/raw/proces-verbaux-saints-anges/cas/a74652366eeffeea.pdf",
          page: 3,
        },
      ],
    });
    expect(result).toEqual([
      {
        docSha: "a74652366eeffeea",
        excerpt: "mineures aux règlements d'urbanisme",
        rawRef: "raw/proces-verbaux-saints-anges/cas/a74652366eeffeea.pdf",
        documentUrl:
          "/api/documents/raw?rawRef=raw%2Fproces-verbaux-saints-anges%2Fcas%2Fa74652366eeffeea.pdf",
        page: 3,
      },
    ]);
    expect(result[0].sourceUrl).toBeUndefined();
  });

  it("extracts graphify file/ref/citation aliases", () => {
    const result = extractDocRefs({
      refs: [
        {
          file: "a74652366eeffeea.pdf",
          citation: "Avis de motion concernant le règlement de zonage.",
          page: "4",
        },
      ],
    });

    expect(result).toEqual([
      {
        docSha: "a74652366eeffeea.pdf",
        excerpt: "Avis de motion concernant le règlement de zonage.",
        rawRef: "a74652366eeffeea.pdf",
        page: 4,
      },
    ]);
  });

  it("extracts top-level citation and PDF URL when refs is absent", () => {
    const result = extractDocRefs({
      citation: "Le conseil donne avis de motion.",
      pdfUrl: "https://example.test/pv.pdf",
    });

    expect(result).toEqual([
      {
        docSha: "https://example.test/pv.pdf",
        excerpt: "Le conseil donne avis de motion.",
        sourceUrl: "https://example.test/pv.pdf",
      },
    ]);
  });

  it("deduplicates identical refs from refs and top-level fields", () => {
    const result = extractDocRefs({
      refs: [{ docSha: "aaa", excerpt: "foo" }],
      docSha: "aaa",
      excerpt: "foo",
    });

    expect(result).toEqual([{ docSha: "aaa", excerpt: "foo" }]);
  });

  it("extracts API-enriched document metadata fields", () => {
    const result = extractDocRefs({
      refs: [
        {
          docSha: "abc123",
          documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
          title: "Proces-verbal du 12 mai 2026",
          contentType: "application/pdf",
          fetchedAt: "2026-06-08T09:30:00.000Z",
          publishedAt: "2026-05-12",
        },
      ],
    });

    expect(result).toEqual([
      {
        docSha: "abc123",
        documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
        title: "Proces-verbal du 12 mai 2026",
        contentType: "application/pdf",
        fetchedAt: "2026-06-08T09:30:00.000Z",
        publishedAt: "2026-05-12",
      },
    ]);
  });

  it("keeps documentUrl-only refs produced by the API fallback route", () => {
    const result = extractDocRefs({
      refs: [{ documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf" }],
    });

    expect(result).toEqual([
      {
        docSha: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
        documentUrl: "/api/documents/raw?rawRef=raw%2Fpv.pdf",
      },
    ]);
  });

  it("extracts multiple refs and skips invalid items in the same array", () => {
    const result = extractDocRefs({
      refs: [
        { docSha: "aaa", page: 1 },
        "not-an-object",
        null,
        { no_docsha: "here" },
        { docSha: "bbb", excerpt: "foo" },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].docSha).toBe("aaa");
    expect(result[1].docSha).toBe("bbb");
  });

  it("extracts bbox when available", () => {
    const result = extractDocRefs({
      refs: [
        {
          docSha: "aaa",
          page: 7,
          bbox: [0.12, 0.34, 0.56, 0.78],
        },
      ],
    });
    expect(result).toEqual([
      {
        docSha: "aaa",
        page: 7,
        bbox: [0.12, 0.34, 0.56, 0.78],
      },
    ]);
  });
});

describe("extractSignalEvidence", () => {
  it("builds complete evidence from a graph node with refs and properties", () => {
    const evidence = extractSignalEvidence({
      id: "sig-1",
      type: "Signal",
      label: "Signal",
      citySlug: "ville",
      sourceRef: "raw/proces-verbaux-ville/cas/abc.pdf",
      createdAt: "2026-06-01T00:00:00.000Z",
      props: {
        properties: {
          description: "Description grounded in the source.",
          date: "2026-05-19",
        },
        refs: [
          {
            docSha: "abc",
            excerpt: "verbatim excerpt",
            sourceUrl: "https://example.test/pv.pdf",
            page: 2,
            bbox: [0.1, 0.2, 0.3, 0.4],
          },
        ],
      },
    });

    expect(evidence.description).toBe("Description grounded in the source.");
    expect(evidence.citation).toBe("verbatim excerpt");
    expect(evidence.sourceUrl).toBe("https://example.test/pv.pdf");
    expect(evidence.documentDate).toBe("2026-05-19");
    expect(evidence.page).toBe(2);
    expect(evidence.bbox).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(evidence.completeness.missing).toEqual([]);
  });

  it("marks missing citation/page/bbox explicitly for legacy sourceRef-only nodes", () => {
    const evidence = extractSignalEvidence({
      id: "sig-2",
      type: "DesignationEvent",
      label: "Signal",
      citySlug: "ville",
      sourceRef: "raw/proces-verbaux-ville/cas/abc.txt",
      createdAt: null,
      props: {},
    });

    expect(evidence.rawRef).toBe("raw/proces-verbaux-ville/cas/abc.txt");
    expect(evidence.completeness.hasPdfLink).toBe(true);
    expect(evidence.completeness.missing).toContain("description");
    expect(evidence.completeness.missing).toContain("citation");
    expect(evidence.completeness.missing).toContain("documentDate");
    expect(evidence.completeness.missing).toContain("page");
    expect(evidence.completeness.missing).toContain("bbox");
  });
});

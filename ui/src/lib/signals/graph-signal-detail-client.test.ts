/**
 * Tests for extractDocRefs — the type-guard that parses props.refs from
 * graph_nodes into typed SignalDocRef[].
 */
import { describe, it, expect } from "vitest";
import { extractDocRefs } from "./graph-signal-detail-client.js";

describe("extractDocRefs", () => {
  it("returns [] when props has no refs key", () => {
    expect(extractDocRefs({})).toEqual([]);
  });

  it("returns [] when props.refs is not an array", () => {
    expect(extractDocRefs({ refs: "not-an-array" })).toEqual([]);
    expect(extractDocRefs({ refs: null })).toEqual([]);
    expect(extractDocRefs({ refs: 42 })).toEqual([]);
  });

  it("returns [] when refs items have no docSha string", () => {
    expect(extractDocRefs({ refs: [{ excerpt: "foo" }] })).toEqual([]);
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
        rawRef: "/tmp/scw-docs/raw/proces-verbaux-saints-anges/cas/a74652366eeffeea.pdf",
        page: 3,
      },
    ]);
    expect(result[0].sourceUrl).toBeUndefined();
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
});

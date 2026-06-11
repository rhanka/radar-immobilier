/**
 * object-store.test.ts
 *
 * Content-addressed raw key (CAS) — the key must NOT embed the fetch date,
 * so the same document content always maps to the same key (dedup + idempotence).
 * Spec: docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1.
 */
import { describe, expect, it } from "vitest";

import { casObjectKey, casMetaKey } from "./object-store.js";

describe("casObjectKey — content-addressed raw key (no fetch date)", () => {
  it("builds raw/{city}/{source}/cas/{sha}.{ext}", () => {
    expect(
      casObjectKey({
        citySlug: "beloeil",
        sourceKind: "proces-verbaux",
        sha256: "abc123",
        ext: "pdf",
      }),
    ).toBe("raw/beloeil/proces-verbaux/cas/abc123.pdf");
  });

  it("contains NO date partition (same content → same key whenever fetched)", () => {
    const key = casObjectKey({
      citySlug: "delson",
      sourceKind: "avis-publics",
      sha256: "deadbeef",
      ext: ".html",
    });
    expect(key).toBe("raw/delson/avis-publics/cas/deadbeef.html");
    expect(key).not.toMatch(/\/\d{4}\/\d{2}\/\d{2}\//); // no YYYY/MM/DD
  });

  it("strips a leading dot from ext", () => {
    expect(
      casObjectKey({ citySlug: "x", sourceKind: "y", sha256: "s", ext: ".pdf" }),
    ).toBe("raw/x/y/cas/s.pdf");
  });

  it("casMetaKey returns the sibling .meta.json key", () => {
    expect(
      casMetaKey({
        citySlug: "beloeil",
        sourceKind: "proces-verbaux",
        sha256: "abc123",
      }),
    ).toBe("raw/beloeil/proces-verbaux/cas/abc123.meta.json");
  });
});

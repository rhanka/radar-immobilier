import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalRecordBytes, hashRecord, type RecordKind } from "@sentropic/comments";
import { createAnnotationHostPorts, snapshotResource } from "./host-ports.js";
import { prepareSyntheticSourceUnit, type SyntheticSourceContribution } from "./prepare-source-unit.js";
import { SYNTHETIC_BODY, SYNTHETIC_CAPACITY, SYNTHETIC_EXECUTION, SYNTHETIC_SCOPE } from "./fixtures.js";

const resource = snapshotResource({ scope: SYNTHETIC_SCOPE, namespace: "immo.sheet", citySlug: "synthetic-city",
  kind: "row-contribution", nativeId: "row-1/cell-B", sourceVersion: "source-v1" });
const input: SyntheticSourceContribution = {
  dataClass: "synthetic", unitId: "source-unit-1", scope: SYNTHETIC_SCOPE, kind: "discussion",
  primary: { resource, source: { variant: "fixed-at-conversion", sourceVersion: "source-v1",
    conversionRef: "synthetic-conversion", historicalGap: true } },
  secondary: [], body: SYNTHETIC_BODY, attribution: { variant: "unknown", classification: "source-unknown" },
  sourceTime: { lexical: "2026-10-01", dateKind: "date", precision: "day" }, execution: SYNTHETIC_EXECUTION,
};
const registration = { principal: "subject-a", registeredAt: 1_791_792_000_000 };
function host(granted = true) {
  return createAnnotationHostPorts({ hasCapability: async () => granted,
    resources: async (ref) => [{ ref, sourceVersion: "source-v1", frozenDigest: "a".repeat(64),
      currentDigest: "a".repeat(64), available: true }] });
}

describe("synthetic source preparation against exact M1", () => {
  it("should replay all producer canonical bytes and hash vectors unchanged", () => {
    const vectors = JSON.parse(readFileSync(new URL("../../../../vendor/comments-m1/revision-hash-v1.json", import.meta.url), "utf8")) as {
      records: Array<{ kind: RecordKind; envelope: Record<string, unknown>; canonical: string; digest: string }>;
    };
    for (const vector of vectors.records) {
      expect(canonicalRecordBytes(vector.kind, vector.envelope)).toBe(vector.canonical);
      expect(hashRecord(vector.kind, vector.envelope)).toBe(vector.digest);
    }
  });

  it("should preserve exact text, unknown attribution, lexical day and structure pin on retry", async () => {
    const prepared = await prepareSyntheticSourceUnit(input, registration, host(), SYNTHETIC_CAPACITY);
    expect(await prepareSyntheticSourceUnit(input, registration, host(), SYNTHETIC_CAPACITY)).toEqual(prepared);
    const [structure, comment] = prepared.records;
    expect(structure!.kind).toBe("thread-structure-revision");
    expect(comment!.kind).toBe("comment-revision");
    if (comment!.kind !== "comment-revision") throw new Error("Unexpected candidate");
    expect(comment.body.text).toBe(SYNTHETIC_BODY.text);
    expect(comment.provenance.attribution.variant).toBe("unknown");
    expect(comment.provenance.sourceTime).toEqual(input.sourceTime);
    expect(comment.structureRevision.hash).toBe(structure!.hash);
    expect(comment.annotationPin).toBeNull();
  });

  it("should prepare one multi-target annotation without inventing a discussion or review", async () => {
    const prepared = await prepareSyntheticSourceUnit({ ...input, kind: "annotation",
      secondary: [{ ...input.primary, resource: { ...resource, id: "second-qualified-snapshot" } }] }, registration, host(), SYNTHETIC_CAPACITY);
    expect(prepared.records.map((r) => r.kind)).toEqual(["annotation-revision"]);
  });

  it("should reject real data, missing access, unknown bindings and excessive bodies without truncation", async () => {
    await expect(prepareSyntheticSourceUnit({ ...input, dataClass: "real" } as unknown as SyntheticSourceContribution,
      registration, host(), SYNTHETIC_CAPACITY)).rejects.toThrow(/synthetic/);
    await expect(prepareSyntheticSourceUnit(input, registration, host(false), SYNTHETIC_CAPACITY)).rejects.toThrow(/denied/);
    await expect(prepareSyntheticSourceUnit({ ...input, primary: { resource,
      source: { variant: "unknown", classification: "gap" } } }, registration, host(), SYNTHETIC_CAPACITY)).rejects.toThrow(/exact/);
    await expect(prepareSyntheticSourceUnit(input, registration, host(), { ...SYNTHETIC_CAPACITY,
      body: { limit: 1, unit: "utf8-bytes" } })).rejects.toThrow();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, canonicalRecordBytes, hashRecord, quantizeMillionths,
  validateGeometry, RECORD_KINDS, REVISION_HASH_VERSION,
  type GeometryFrame, type GeometryInput, type RecordKind } from "@sentropic/comments";

const corpus = JSON.parse(readFileSync(new URL("../../../../vendor/comments-m1/revision-hash-v1.json", import.meta.url), "utf8")) as {
  hashVersion: string;
  records: Array<{ id: string; kind: RecordKind; envelope: Record<string, unknown>; canonical: string; digest: string }>;
  canonicalVectors: Array<{ id: string; value: unknown; canonical: string; digest: string }>;
  geometry: Array<{ id: string; input: string | GeometryInput; frame?: GeometryFrame; millionths?: number; quantized?: unknown }>;
  rejections: Array<{ id: string; code: string; input?: string | GeometryInput; frame?: GeometryFrame;
    charCodes?: number[]; value?: unknown; kind?: RecordKind }>;
};

describe("entire frozen M1 producer corpus", () => {
  it("should cover the declared version and every record kind", () => {
    expect(corpus.hashVersion).toBe(REVISION_HASH_VERSION);
    expect(corpus.records.map((v) => v.kind).sort()).toEqual([...RECORD_KINDS].sort());
  });
  it.each(corpus.records)("should reproduce record $id", (vector) => {
    expect(canonicalRecordBytes(vector.kind, vector.envelope)).toBe(vector.canonical);
    expect(hashRecord(vector.kind, vector.envelope)).toBe(vector.digest);
  });
  it.each(corpus.canonicalVectors)("should reproduce canonical vector $id", (vector) => {
    expect(canonicalJson(vector.value)).toBe(vector.canonical);
    expect(sha256Hex(vector.canonical)).toBe(vector.digest);
  });
  it.each(corpus.geometry)("should reproduce geometry $id", (vector) => {
    if (typeof vector.input === "string") expect(quantizeMillionths(vector.input)).toBe(vector.millionths);
    else expect(validateGeometry(vector.frame!, vector.input)).toEqual(vector.quantized);
  });
  it.each(corpus.rejections)("should reject $id with its declared code", (vector) => {
    const replay = () => {
      if (vector.input !== undefined) {
        return typeof vector.input === "string" ? quantizeMillionths(vector.input)
          : validateGeometry(vector.frame!, vector.input);
      }
      if (vector.charCodes) return hashRecord("review-event", { actor: { principal: String.fromCharCode(...vector.charCodes) } });
      if (vector.value !== undefined) return hashRecord("review-event", { actor: { principal: "p" }, score: vector.value });
      if (vector.id === "envelope-kind-override") return hashRecord("review-event", { kind: "other" });
      if (vector.id === "unknown-record-kind") return hashRecord(vector.kind!, {});
      throw new Error("Unrecognized producer rejection vector");
    };
    expect(replay).toThrowError(expect.objectContaining({ code: vector.code }));
  });
});

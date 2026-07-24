/**
 * Pure unit tests for the InputSet CONTRACT (foundation lot). No I/O, no S3,
 * no materializer — validation + hashing only.
 */
import { describe, it, expect } from "vitest";
import {
  INPUTSET_SCHEMA_VERSION,
  EMPTY_PATCH_LOG_HASH,
  parseInputSet,
  safeParseInputSet,
  canonicalizeInputSet,
  computeInputsetHash,
  type InputSet,
} from "./input-set-contract.js";

const H = (n: number): string => `sha256:${String(n).padStart(64, "0")}`;

function baseInputSet(): InputSet {
  return parseInputSet({
    schema: INPUTSET_SCHEMA_VERSION,
    city: "delson",
    members: [
      {
        businessKey: "pv-2025-001",
        rawCasKey: "raw/delson/pv-2025-001",
        rawSha256: H(1),
        sidecarSha256: H(2),
        sourceKind: "proces-verbaux",
        sourceManifestRef: { runId: "run-a", entryId: "e1" },
      },
      {
        businessKey: "pv-2025-002",
        rawCasKey: "raw/delson/pv-2025-002",
        rawSha256: H(3),
        sidecarSha256: null,
        sourceKind: "proces-verbaux",
        sourceManifestRef: { runId: "run-a", entryId: "e2" },
      },
    ],
    tombstones: [
      { businessKey: "pv-2024-099", reason: "superseded-by-consolidated", rawSha256: H(9) },
    ],
    patchLogHash: EMPTY_PATCH_LOG_HASH,
    versions: {
      parser: "pv-parser@3.4.0",
      prompt: "graphify-desc@1",
      model: "claude-x",
      ontology: "2.2",
      materializer: "replay@3.4.0",
    },
  });
}

describe("InputSet contract — validation", () => {
  it("parses a well-formed InputSet and applies defaults", () => {
    const parsed = parseInputSet({
      schema: INPUTSET_SCHEMA_VERSION,
      city: "delson",
      members: [
        {
          businessKey: "k1",
          rawCasKey: "raw/k1",
          rawSha256: H(1),
          sourceKind: "proces-verbaux",
          sourceManifestRef: { runId: "r", entryId: "e" },
        },
      ],
      patchLogHash: EMPTY_PATCH_LOG_HASH,
      versions: {
        parser: "p", prompt: "pr", model: "m", ontology: "o", materializer: "mz",
      },
    });
    expect(parsed.tombstones).toEqual([]); // default
    expect(parsed.members[0]!.sidecarSha256).toBeNull(); // default
  });

  it("EMPTY_PATCH_LOG_HASH is a valid sha256 identity", () => {
    expect(EMPTY_PATCH_LOG_HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects a malformed sha256 identity", () => {
    const r = safeParseInputSet({
      ...baseInputSet(),
      patchLogHash: "not-a-hash",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    const r = safeParseInputSet({ ...baseInputSet(), extra: true });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate member businessKeys", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      members: [base.members[0]!, { ...base.members[1]!, businessKey: base.members[0]!.businessKey }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a businessKey that is both a member and a tombstone", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      tombstones: [{ businessKey: base.members[0]!.businessKey, reason: "x", rawSha256: null }],
    });
    expect(r.success).toBe(false);
  });

  it("requires every pinned version", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      versions: { parser: "p", prompt: "pr", model: "m", ontology: "o" },
    });
    expect(r.success).toBe(false);
  });

  it("requires a non-empty tombstone reason (no silent skip)", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      tombstones: [{ businessKey: "ghost", reason: "", rawSha256: null }],
    });
    expect(r.success).toBe(false);
  });
});

describe("InputSet contract — inputsetHash", () => {
  it("is a sha256 identity", () => {
    expect(computeInputsetHash(baseInputSet())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of member/tombstone order", () => {
    const a = baseInputSet();
    const b: InputSet = {
      ...a,
      members: [a.members[1]!, a.members[0]!],
    };
    expect(computeInputsetHash(b)).toBe(computeInputsetHash(a));
  });

  it("canonicalizeInputSet sorts members and tombstones by businessKey", () => {
    const a = baseInputSet();
    const shuffled: InputSet = { ...a, members: [a.members[1]!, a.members[0]!] };
    const canon = canonicalizeInputSet(shuffled);
    expect(canon.members.map((m) => m.businessKey)).toEqual([
      "pv-2025-001",
      "pv-2025-002",
    ]);
  });

  it("changes when a raw member hash changes", () => {
    const a = baseInputSet();
    const b: InputSet = {
      ...a,
      members: [{ ...a.members[0]!, rawSha256: H(42) }, a.members[1]!],
    };
    expect(computeInputsetHash(b)).not.toBe(computeInputsetHash(a));
  });

  it("changes when a pinned version changes (cache-invalidating)", () => {
    const a = baseInputSet();
    const b: InputSet = { ...a, versions: { ...a.versions, model: "claude-y" } };
    expect(computeInputsetHash(b)).not.toBe(computeInputsetHash(a));
  });

  it("changes when the patch-log hash changes", () => {
    const a = baseInputSet();
    const b: InputSet = { ...a, patchLogHash: H(7) };
    expect(computeInputsetHash(b)).not.toBe(computeInputsetHash(a));
  });
});

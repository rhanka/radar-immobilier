/**
 * Pure unit tests for the InputSet CONTRACT (foundation lot). No network, no S3,
 * no materializer — validation + canonicalization + hashing only. The manifest
 * resolution test writes through an IN-MEMORY ObjectStore so the manifest bytes
 * it resolves against are produced by the REAL `writeRunManifest` serializer.
 */
import { describe, it, expect } from "vitest";
import { manifestKey, writeRunManifest } from "../../sources/run-manifest.js";
import type { ObjectInfo, ObjectStore } from "../../../storage/object-store.js";
import {
  INPUTSET_SCHEMA_VERSION,
  EMPTY_PATCH_LOG_HASH,
  parseInputSet,
  safeParseInputSet,
  canonicalizeInputSet,
  computeInputsetHash,
  serializeCanonicalInputSet,
  sourceManifestObjectKey,
  selectManifestEntry,
  manifestContentIdentity,
  type InputSet,
} from "./input-set-contract.js";

/** In-memory ObjectStore: the manifest bytes stay in the process, no S3. */
class MemoryStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const value = this.objects.get(key);
    return value ? { key, size: value.byteLength } : null;
  }
}

/** `sha256:<hex>` content identity (member/patch-log hashes). */
const H = (n: number): string => `sha256:${String(n).padStart(64, "0")}`;
/** Raw 64-char hex — the run-manifest idempotency-key shape. */
const HX = (n: number): string => String(n).padStart(64, "0");

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
        sourceManifestRef: { source: "proces-verbaux", runId: "run-a", sha256: HX(1) },
      },
      {
        businessKey: "pv-2025-002",
        rawCasKey: "raw/delson/pv-2025-002",
        rawSha256: H(3),
        sidecarSha256: null,
        sourceKind: "proces-verbaux",
        sourceManifestRef: { source: "proces-verbaux", runId: "run-a", sha256: HX(3) },
      },
    ],
    tombstones: [
      { businessKey: "pv-2024-099", reason: "superseded-by-consolidated", rawSha256: H(9) },
      { businessKey: "pv-2024-050", reason: "duplicate-of-051", rawSha256: null },
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
          rawSha256: H(7),
          sourceKind: "proces-verbaux",
          sourceManifestRef: { source: "proces-verbaux", runId: "r", sha256: HX(7) },
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

describe("InputSet contract — sourceManifestRef resolvability", () => {
  it("rejects an invented entryId / missing source (old shape)", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      members: [
        { ...base.members[0]!, sourceManifestRef: { runId: "run-a", entryId: "e1" } },
        base.members[1]!,
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-hex manifest sha256 selector", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      members: [
        { ...base.members[0]!, sourceManifestRef: { source: "s", runId: "r", sha256: "nope" } },
        base.members[1]!,
      ],
    });
    expect(r.success).toBe(false);
  });

  it("resolves to the real run-manifest object key", () => {
    const ref = baseInputSet().members[0]!.sourceManifestRef;
    expect(sourceManifestObjectKey(ref)).toBe(manifestKey(ref.source, ref.runId));
    expect(sourceManifestObjectKey(ref)).toBe("runs/proces-verbaux/run-a/manifest.jsonl");
  });
});

describe("InputSet contract — rawSha256 IS the manifest entry digest", () => {
  it("NEGATIVE: rejects rawSha256 that does not match sourceManifestRef.sha256", () => {
    const base = baseInputSet();
    // H(1) bytes claimed, but the cited manifest line is the HX(2) document.
    const r = safeParseInputSet({
      ...base,
      members: [withRef0(base, { sha256: HX(2) }).members[0]!, base.members[1]!],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("content identity of sourceManifestRef.sha256");
    }
  });

  it("NEGATIVE: rejects a `sha256:`-prefixed digest smuggled into the ref", () => {
    const base = baseInputSet();
    const r = safeParseInputSet({
      ...base,
      members: [
        { ...base.members[0]!, sourceManifestRef: { source: "s", runId: "r", sha256: H(1) } },
        base.members[1]!,
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts the coherent pair (same digest, two notations)", () => {
    expect(manifestContentIdentity(HX(1))).toBe(H(1));
    expect(() => parseInputSet(baseInputSet())).not.toThrow();
  });

  it("the SELECTED manifest line matches both the digest AND the rawCasKey", async () => {
    const member = baseInputSet().members[0]!;
    const store = new MemoryStore();
    // Manifest bytes produced by the REAL writer, not a hand-rolled string.
    const key = await writeRunManifest(store, {
      source: member.sourceManifestRef.source,
      runId: member.sourceManifestRef.runId,
      entries: [
        { sha256: HX(2), sourceUrl: "https://x/other.pdf", casKey: "raw/delson/other", status: "seen" },
        {
          sha256: HX(1),
          sourceUrl: "https://x/pv-2025-001.pdf",
          casKey: "raw/delson/pv-2025-001",
          status: "new",
        },
      ],
    });
    expect(key).toBe(sourceManifestObjectKey(member.sourceManifestRef));

    const jsonl = new TextDecoder().decode(await store.get(key));
    const entry = selectManifestEntry(jsonl, member.sourceManifestRef);
    expect(entry).not.toBeNull();
    // The line the ref selects describes THE SAME bytes AND the same CAS object.
    expect(manifestContentIdentity(entry!.sha256)).toBe(member.rawSha256);
    expect(entry!.casKey).toBe(member.rawCasKey);
  });

  it("an unresolvable ref selects no line (visible null, not a silent pass)", async () => {
    const member = baseInputSet().members[0]!;
    const store = new MemoryStore();
    const key = await writeRunManifest(store, {
      source: member.sourceManifestRef.source,
      runId: member.sourceManifestRef.runId,
      entries: [{ sha256: HX(2), sourceUrl: "https://x/other.pdf", casKey: "raw/o", status: "seen" }],
    });
    const jsonl = new TextDecoder().decode(await store.get(key));
    expect(selectManifestEntry(jsonl, member.sourceManifestRef)).toBeNull();
  });
});

describe("InputSet contract — inputsetHash", () => {
  // KNOWN-ANSWER: the canonical hash of baseInputSet(). If canonicalization,
  // field set, or serialization changes, this fails — regenerate ONLY when the
  // contract intentionally changes.
  const KNOWN_ANSWER =
    "sha256:1f23e43d60e473f78f6044181eecf10e82d030d78c1f878493b3b38eb0a2d4f9";

  it("is a sha256 identity", () => {
    expect(computeInputsetHash(baseInputSet())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches the frozen known-answer hash", () => {
    expect(computeInputsetHash(baseInputSet())).toBe(KNOWN_ANSWER);
  });

  it("is independent of member order (and byte-stable)", () => {
    const a = baseInputSet();
    const b: InputSet = { ...a, members: [a.members[1]!, a.members[0]!] };
    expect(computeInputsetHash(b)).toBe(computeInputsetHash(a));
    // Same hash AND same persisted bytes — no divergent artifact per identity.
    expect(serializeCanonicalInputSet(b).json).toBe(serializeCanonicalInputSet(a).json);
  });

  it("is independent of tombstone order (and byte-stable)", () => {
    const a = baseInputSet();
    const b: InputSet = { ...a, tombstones: [a.tombstones[1]!, a.tombstones[0]!] };
    expect(computeInputsetHash(b)).toBe(computeInputsetHash(a));
    expect(serializeCanonicalInputSet(b).json).toBe(serializeCanonicalInputSet(a).json);
  });

  it("canonicalizeInputSet sorts members and tombstones by businessKey", () => {
    const a = baseInputSet();
    const shuffled: InputSet = {
      ...a,
      members: [a.members[1]!, a.members[0]!],
      tombstones: [a.tombstones[1]!, a.tombstones[0]!],
    };
    const canon = canonicalizeInputSet(shuffled);
    expect(canon.members.map((m) => m.businessKey)).toEqual(["pv-2025-001", "pv-2025-002"]);
    expect(canon.tombstones.map((t) => t.businessKey)).toEqual(["pv-2024-050", "pv-2024-099"]);
  });

  it("serializeCanonicalInputSet persists exactly the hashed bytes", () => {
    const s = serializeCanonicalInputSet(baseInputSet());
    expect(s.inputsetHash).toBe(computeInputsetHash(s.inputSet));
  });

  // Every authority field is load-bearing: mutating ANY one must change the hash.
  const mutations: Array<[string, (b: InputSet) => InputSet]> = [
    ["city", (b) => ({ ...b, city: "sainte-catherine" })],
    ["member.businessKey", (b) => withMember0(b, { businessKey: "pv-2025-999" })],
    ["member.rawCasKey", (b) => withMember0(b, { rawCasKey: "raw/other" })],
    // rawSha256 and ref.sha256 are ONE digest in two notations (the contract
    // binds them), so they can only move TOGETHER — hence a single entry.
    ["member.rawSha256 + ref.sha256", (b) => withRawDigest0(b, 42)],
    ["member.sidecarSha256", (b) => withMember0(b, { sidecarSha256: H(43) })],
    ["member.sourceKind", (b) => withMember0(b, { sourceKind: "reglements" })],
    ["ref.source", (b) => withRef0(b, { source: "reglements" })],
    ["ref.runId", (b) => withRef0(b, { runId: "run-z" })],
    ["tombstone.businessKey", (b) => withTombstone0(b, { businessKey: "pv-2024-098" })],
    ["tombstone.reason", (b) => withTombstone0(b, { reason: "other-reason" })],
    ["tombstone.rawSha256", (b) => withTombstone0(b, { rawSha256: H(77) })],
    ["patchLogHash", (b) => ({ ...b, patchLogHash: H(7) })],
    ["versions.parser", (b) => withVersions(b, { parser: "pv-parser@3.5.0" })],
    ["versions.prompt", (b) => withVersions(b, { prompt: "graphify-desc@2" })],
    ["versions.model", (b) => withVersions(b, { model: "claude-y" })],
    ["versions.ontology", (b) => withVersions(b, { ontology: "2.3" })],
    ["versions.materializer", (b) => withVersions(b, { materializer: "replay@3.5.0" })],
  ];

  for (const [field, mutate] of mutations) {
    it(`changes when ${field} changes`, () => {
      const a = baseInputSet();
      expect(computeInputsetHash(mutate(a))).not.toBe(computeInputsetHash(a));
    });
  }
});

function withMember0(b: InputSet, patch: Partial<InputSet["members"][number]>): InputSet {
  return { ...b, members: [{ ...b.members[0]!, ...patch }, b.members[1]!] };
}
function withRef0(
  b: InputSet,
  patch: Partial<InputSet["members"][number]["sourceManifestRef"]>,
): InputSet {
  return withMember0(b, {
    sourceManifestRef: { ...b.members[0]!.sourceManifestRef, ...patch },
  });
}
/** Move a member's raw digest COHERENTLY (member + manifest selector). */
function withRawDigest0(b: InputSet, n: number): InputSet {
  return withMember0(b, {
    rawSha256: H(n),
    sourceManifestRef: { ...b.members[0]!.sourceManifestRef, sha256: HX(n) },
  });
}
function withTombstone0(b: InputSet, patch: Partial<InputSet["tombstones"][number]>): InputSet {
  return { ...b, tombstones: [{ ...b.tombstones[0]!, ...patch }, b.tombstones[1]!] };
}
function withVersions(b: InputSet, patch: Partial<InputSet["versions"]>): InputSet {
  return { ...b, versions: { ...b.versions, ...patch } };
}

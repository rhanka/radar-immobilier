/**
 * Graphify 3.4 — canonical InputSet CONTRACT (foundation lot).
 *
 * This module freezes the SHAPE and VALIDATION of the immutable, canonical
 * per-city InputSet described in:
 *   - execution plan, "Immutable artifacts and hashes" (InputSet row) and
 *     Lot 1 "Construct the unique raw InputSet";
 *   - adversarial consensus D1 "Cumulative authority and two equal paths".
 *
 * SCOPE GUARD — this is the contract ONLY. It intentionally does NOT:
 *   - build an InputSet from S3 / source run manifests (that is Lot 1),
 *   - read, head, or write any object store (no I/O whatsoever),
 *   - materialize, compare, or project a graph,
 *   - call an LLM.
 * Everything here is pure, synchronous, and offline-testable.
 *
 * The InputSet is the SOLE authority for a run: sorted raw CAS members (each
 * hashed), explicit tombstones with reasons, the approved human patch-log hash,
 * and the pinned parser / prompt / model / ontology / materializer versions.
 * Parsed and LLM artifacts are versioned caches, never authority (D1.1).
 *
 * PROVENANCE INVARIANT: a member's `rawSha256` and the `sourceManifestRef.sha256`
 * it points at are the SAME digest of the SAME raw bytes, so the contract binds
 * them (`rawSha256 === "sha256:" + sourceManifestRef.sha256`) instead of letting
 * a member cite a manifest line that describes different bytes.
 *
 * `inputsetHash` is DERIVED (it is the object key `graph-inputsets/{city}/
 * {inputsetHash}.json`), so it is NOT a field of the hashed body. There is a
 * SINGLE canonical entry point, {@link serializeCanonicalInputSet}, which
 * validates → normalizes (sorts membership) → serializes → hashes in one pass,
 * so the persisted bytes are ALWAYS the exact bytes that were hashed. Never
 * hand-serialize a parsed InputSet (that would let two byte-different artifacts
 * share one hash); go through this module.
 */
import { z } from "zod";
import { manifestKey, type RunManifestEntry } from "../../sources/run-manifest.js";
import { canonicalJson, sha256Of } from "./canonical-json.js";

export const INPUTSET_SCHEMA_VERSION = "graphify-inputset/v1" as const;

/** `sha256:<64 lowercase hex>` — the plan's content-identity format. */
export const sha256Schema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "must be a sha256:<hex> content identity");

const nonEmpty = z.string().min(1);

/**
 * Raw SHA-256 hex (no `sha256:` prefix) — the shape of `RunManifestEntry.sha256`,
 * the per-entry idempotency key that identifies a document line inside a run
 * manifest (`api/src/services/sources/run-manifest.ts`).
 */
export const manifestSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a 64-char lowercase hex run-manifest sha256");

/**
 * RESOLVABLE reference into an existing run manifest (evidence provenance).
 *
 * The real manifest lives at `runs/{source}/{runId}/manifest.jsonl`
 * ({@link manifestKey}) — one JSON object per document — and an entry is
 * identified there by its `sha256` idempotency key. So `{ source, runId }`
 * resolve the manifest object and `sha256` selects the line: no invented
 * `entryId`. {@link sourceManifestObjectKey} composes the real object key.
 */
export const sourceManifestRefSchema = z
  .object({
    source: nonEmpty,
    runId: nonEmpty,
    sha256: manifestSha256Schema,
  })
  .strict();

/**
 * Object-storage key of the run manifest a {@link SourceManifestRef} points
 * into. Pure — delegates to the real {@link manifestKey}, proving the ref
 * resolves against the manifest that actually exists (no I/O, no fetch).
 */
export function sourceManifestObjectKey(ref: SourceManifestRef): string {
  return manifestKey(ref.source, ref.runId);
}

/**
 * Content identity (`sha256:<hex>`) of a run-manifest entry digest.
 *
 * `RunManifestEntry.sha256` IS the SHA-256 of the raw bytes (run-manifest.ts),
 * the same digest a member carries as `rawSha256`: only the prefix differs. So
 * the two are not two independent hashes to be reconciled — they are ONE hash
 * in two notations, and the contract below enforces exactly that.
 */
export function manifestContentIdentity(entrySha256: string): string {
  return `sha256:${entrySha256}`;
}

/**
 * Select the manifest LINE a ref points at, from the manifest JSONL bytes.
 * Pure (the bytes are passed in — this module never fetches). Returns `null`
 * when no line carries the ref's idempotency key: an unresolvable ref is a
 * visible null, never a silently-tolerated dangling pointer.
 */
export function selectManifestEntry(
  manifestJsonl: string,
  ref: SourceManifestRef,
): RunManifestEntry | null {
  for (const line of manifestJsonl.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as RunManifestEntry;
    if (entry.sha256 === ref.sha256) return entry;
  }
  return null;
}

/** One raw CAS member: an immutable input document resolved to bytes + hash. */
export const rawCasMemberSchema = z
  .object({
    /** Declared business key — the canonical sort key and identity of a member. */
    businessKey: nonEmpty,
    /** Immutable content-addressed object key of the raw bytes. */
    rawCasKey: nonEmpty,
    /** sha256 of the raw bytes (rehashed at resolution time in Lot 1). */
    rawSha256: sha256Schema,
    /** sha256 of the sidecar metadata, when the source produced one. */
    sidecarSha256: sha256Schema.nullable().default(null),
    /** Source kind (e.g. proces-verbaux) — provenance, not classification. */
    sourceKind: nonEmpty,
    /** Pointer to the source run-manifest entry this member came from. */
    sourceManifestRef: sourceManifestRefSchema,
  })
  .strict()
  .superRefine((member, ctx) => {
    // The member's raw digest and the manifest entry's idempotency key are the
    // SAME sha256 of the SAME bytes. Accepting two different values would let a
    // member claim provenance from a manifest line describing other bytes —
    // an incoherent CAS provenance that no later replay could detect.
    const expected = manifestContentIdentity(member.sourceManifestRef.sha256);
    if (member.rawSha256 !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rawSha256"],
        message:
          `rawSha256 must be the content identity of sourceManifestRef.sha256 ` +
          `(expected ${expected}, got ${member.rawSha256})`,
      });
    }
  });

/** An explicit removal. Never a silent skip — a reason is mandatory (D1.2). */
export const tombstoneSchema = z
  .object({
    businessKey: nonEmpty,
    /** Approved, explicit exclusion reason. */
    reason: nonEmpty,
    /** Last-known raw hash of the tombstoned document, if it ever existed. */
    rawSha256: sha256Schema.nullable().default(null),
  })
  .strict();

/**
 * Pinned implementation versions. A changed version invalidates caches and can
 * produce a new materialization even when membership is unchanged (D1.4).
 */
export const inputSetVersionsSchema = z
  .object({
    parser: nonEmpty,
    prompt: nonEmpty,
    model: nonEmpty,
    ontology: nonEmpty,
    materializer: nonEmpty,
  })
  .strict();

export const inputSetSchema = z
  .object({
    schema: z.literal(INPUTSET_SCHEMA_VERSION),
    /** City slug this InputSet is scoped to. */
    city: nonEmpty,
    /** Complete raw CAS membership. Order is normalized before hashing. */
    members: z.array(rawCasMemberSchema),
    /** Explicit tombstones (removals with reasons). */
    tombstones: z.array(tombstoneSchema).default([]),
    /** sha256 of the approved human patch log ([] → EMPTY_PATCH_LOG_HASH). */
    patchLogHash: sha256Schema,
    versions: inputSetVersionsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const memberKeys = value.members.map((m) => m.businessKey);
    const dupMember = firstDuplicate(memberKeys);
    if (dupMember !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: `duplicate member businessKey: ${dupMember}`,
      });
    }
    const tombKeys = value.tombstones.map((t) => t.businessKey);
    const dupTomb = firstDuplicate(tombKeys);
    if (dupTomb !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tombstones"],
        message: `duplicate tombstone businessKey: ${dupTomb}`,
      });
    }
    // A member cannot also be tombstoned — that is a contradictory membership,
    // not a silent resolution (D1.2 "none is silently skipped").
    const memberSet = new Set(memberKeys);
    for (const key of tombKeys) {
      if (memberSet.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tombstones"],
          message: `businessKey is both a member and a tombstone: ${key}`,
        });
      }
    }
  });

export type SourceManifestRef = z.infer<typeof sourceManifestRefSchema>;
export type RawCasMember = z.infer<typeof rawCasMemberSchema>;
export type Tombstone = z.infer<typeof tombstoneSchema>;
export type InputSetVersions = z.infer<typeof inputSetVersionsSchema>;
export type InputSet = z.infer<typeof inputSetSchema>;

function firstDuplicate(keys: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/** Canonical hash of an EMPTY patch log — the default `patchLogHash`. */
export const EMPTY_PATCH_LOG_HASH = sha256Of(canonicalJson([]));

/**
 * Return a structurally-identical InputSet with members and tombstones sorted
 * by `businessKey` — the canonical membership order used before serialization,
 * so the content identity is independent of the order a caller assembled in.
 */
export function canonicalizeInputSet(inputSet: InputSet): InputSet {
  const byBusinessKey = <T extends { businessKey: string }>(a: T, b: T): number =>
    a.businessKey < b.businessKey ? -1 : a.businessKey > b.businessKey ? 1 : 0;
  return {
    ...inputSet,
    members: [...inputSet.members].sort(byBusinessKey),
    tombstones: [...inputSet.tombstones].sort(byBusinessKey),
  };
}

/**
 * Validate `input` and return it in CANONICAL form (membership sorted). Because
 * the returned object is already canonical, serializing it yields exactly the
 * bytes {@link serializeCanonicalInputSet} hashes — a parsed InputSet is never
 * left in an unsorted state that a caller could persist with a divergent hash.
 */
export function parseInputSet(input: unknown): InputSet {
  return canonicalizeInputSet(inputSetSchema.parse(input));
}

/** Non-throwing validation; canonicalizes on success (same normalization as parse). */
export function safeParseInputSet(input: unknown) {
  const result = inputSetSchema.safeParse(input);
  return result.success
    ? { success: true as const, data: canonicalizeInputSet(result.data) }
    : result;
}

/** Validated canonical InputSet plus the exact serialized bytes and their hash. */
export interface SerializedInputSet {
  /** Validated, canonicalized (membership-sorted) InputSet. */
  inputSet: InputSet;
  /** The canonical JSON string — the SAME bytes persisted and hashed. */
  json: string;
  /** `sha256:<hex>` content identity over `json`. */
  inputsetHash: string;
}

/**
 * SINGLE canonical entry point: validate → normalize → serialize → hash.
 *
 * Returns the canonical InputSet, its canonical JSON bytes, and the derived
 * `inputsetHash` together, so the artifact a caller persists (`json`) and the
 * key it stores it under (`inputsetHash`) can never disagree. Throws on any
 * contract violation.
 */
export function serializeCanonicalInputSet(input: unknown): SerializedInputSet {
  const inputSet = parseInputSet(input);
  const json = canonicalJson(inputSet);
  return { inputSet, json, inputsetHash: sha256Of(json) };
}

/**
 * Derive the immutable `inputsetHash` (`sha256:<hex>`) for an InputSet. Validates
 * and canonicalizes first (via {@link serializeCanonicalInputSet}), so two
 * InputSets with identical content but different member order hash identically,
 * and an invalid InputSet is rejected rather than silently hashed.
 */
export function computeInputsetHash(input: InputSet): string {
  return serializeCanonicalInputSet(input).inputsetHash;
}

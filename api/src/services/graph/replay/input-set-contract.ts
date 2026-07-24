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
 * `inputsetHash` is DERIVED (it is the object key `graph-inputsets/{city}/
 * {inputsetHash}.json`), so it is NOT a field of the hashed body. Compute it
 * with {@link computeInputsetHash}, which canonicalizes membership order first
 * so a caller that supplies members in any order gets the same content identity.
 */
import { z } from "zod";
import { canonicalHash, canonicalJson, sha256Of } from "./canonical-json.js";

export const INPUTSET_SCHEMA_VERSION = "graphify-inputset/v1" as const;

/** `sha256:<64 lowercase hex>` — the plan's content-identity format. */
export const sha256Schema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "must be a sha256:<hex> content identity");

const nonEmpty = z.string().min(1);

/**
 * Reference into a source run manifest entry (evidence provenance). The full
 * source manifest schema lives in api/src/services/sources/run-manifest.ts and
 * is reused as collection evidence — this is only the pointer the InputSet needs.
 */
export const sourceManifestRefSchema = z
  .object({
    runId: nonEmpty,
    entryId: nonEmpty,
  })
  .strict();

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
  .strict();

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

/** Validate `input` against the InputSet contract, throwing on any violation. */
export function parseInputSet(input: unknown): InputSet {
  return inputSetSchema.parse(input);
}

/** Non-throwing validation (Zod SafeParseReturnType). */
export function safeParseInputSet(input: unknown) {
  return inputSetSchema.safeParse(input);
}

/**
 * Return a structurally-identical InputSet with members and tombstones sorted
 * by `businessKey`. This is the canonical ordering used before hashing so that
 * `inputsetHash` is independent of the order a caller happened to assemble in.
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
 * Derive the immutable `inputsetHash` (`sha256:<hex>`) for an InputSet.
 *
 * The input is validated and canonicalized (membership order normalized) before
 * hashing, so two InputSets with identical content but different member order
 * hash identically — the evidence identity the plan requires.
 */
export function computeInputsetHash(inputSet: InputSet): string {
  return canonicalHash(canonicalizeInputSet(inputSet));
}

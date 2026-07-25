/**
 * Graphify 3.4 — canonical JSON + content hashing (contract primitive only).
 *
 * FOUNDATION LOT scope: this module is a PURE, deterministic serializer used to
 * derive the content identities the 3.4 replay contract depends on (notably
 * `inputsetHash`). It performs NO I/O — no S3, no filesystem, no network, no
 * clock. It does not materialize a graph and it does not read a selected graph.
 *
 * Canonicalization rules (per the execution plan "Immutable artifacts and
 * hashes" section and adversarial consensus D3):
 *   - object keys are sorted recursively (lexicographic, by code unit);
 *   - array element ORDER is preserved verbatim (arrays are schema-declared
 *     ordering — the caller sorts members before hashing);
 *   - `undefined` object properties are dropped (JSON semantics), but an
 *     explicit `null` is preserved;
 *   - non-finite numbers (NaN, ±Infinity) are rejected, because they are not
 *     representable in canonical JSON and would silently become `null`;
 *   - no clock, transport, or run metadata is injected here — volatile envelope
 *     fields must be stripped by the caller BEFORE hashing.
 *
 * Identity strings are `sha256:<hex>` over the canonical UTF-8 bytes, matching
 * the plan's stated `sha256:<hex>` convention.
 */
import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Thrown when a value cannot be represented in canonical JSON. */
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function canonicalize(value: unknown, path: string): JsonValue {
  if (value === null) return null;
  const t = typeof value;
  if (t === "boolean" || t === "string") return value as boolean | string;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new CanonicalJsonError(
        `non-finite number at ${path || "<root>"} is not canonicalizable`,
      );
    }
    return value as number;
  }
  if (t === "bigint") {
    throw new CanonicalJsonError(`bigint at ${path || "<root>"} is not canonicalizable`);
  }
  if (Array.isArray(value)) {
    // Array order is authoritative (schema-declared) — never reordered here.
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  }
  if (t === "object") {
    const source = value as Record<string, unknown>;
    const out: { [key: string]: JsonValue } = {};
    // Recursive lexicographic key sort — the single source of determinism.
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined) continue; // JSON drops undefined properties
      out[key] = canonicalize(child, path ? `${path}.${key}` : key);
    }
    return out;
  }
  // functions, symbols, undefined at root
  throw new CanonicalJsonError(
    `value of type ${t} at ${path || "<root>"} is not canonicalizable`,
  );
}

/** Return the canonical JSON string (recursively key-sorted, order-stable arrays). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, ""));
}

/** Return the canonical UTF-8 bytes for `value`. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

/** `sha256:<hex>` over an already-serialized canonical string or raw bytes. */
export function sha256Of(input: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? Buffer.from(input, "utf8") : input);
  return `sha256:${hash.digest("hex")}`;
}

/** `sha256:<hex>` over the canonical serialization of `value`. */
export function canonicalHash(value: unknown): string {
  return sha256Of(canonicalBytes(value));
}

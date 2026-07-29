/**
 * Bytes AND the version of those exact bytes, reported by a SINGLE read.
 *
 * A `get()` followed by a separate `head()` cannot produce this: another writer
 * may publish between the two calls, and the pair then reports version N with
 * the bytes of version N-1. Anything that records "these bytes are version X"
 * — the canonical-graph archive above all — must read them together.
 */
export interface StoredObject {
  key: string;
  body: Uint8Array;
  /** ETag carried by the same response as `body`; `null` when none was returned. */
  etag: string | null;
}

/** A stored object's metadata returned by head/put. */
export interface ObjectInfo {
  key: string;
  size?: number | undefined;
  contentType?: string | undefined;
  /**
   * Opaque server-side version of the stored bytes (S3 `ETag`), quotes
   * included. Used by the canonical-graph writer to detect a concurrent
   * overwrite between the moment an archive was taken and the moment the
   * replacement is PUT. `undefined` when the backend did not return one.
   */
  etag?: string | undefined;
}

/**
 * `graph/<city>/latest.json` — the single key the graph projector
 * (`project-graph-from-s3.ts`) and the S3 replay read as truth for a city.
 *
 * Overwriting it is irreversible: the previous bytes are gone unless someone
 * archived them first. Every writer of this key must therefore go through
 * `services/graph/canonical-graph-writer.ts`, which archives the pre-image and
 * refuses the write when the object moved under it. `S3ObjectStore.put()`
 * enforces that by refusing this key outright — the guard lives on the write
 * path, not in the goodwill of each caller.
 */
export function isCanonicalGraphKey(key: string): boolean {
  return /^graph\/[^/]+\/latest\.json$/.test(key);
}

/** The canonical key for a city — never build this string by hand. */
export function canonicalGraphKey(citySlug: string): string {
  return `graph/${citySlug}/latest.json`;
}

/**
 * Storage boundary for raw source documents. Backed by S3 (Scaleway) in
 * prod and MinIO locally. Adapters live behind this interface so the rest
 * of the code never talks to a concrete SDK.
 */
export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
  ): Promise<ObjectInfo>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<ObjectInfo | null>;
  /**
   * Read bytes and their version in one call, or `null` when the key is absent.
   *
   * Optional on the general boundary — most callers only need the bytes — but
   * REQUIRED of any store passed to `services/graph/canonical-graph-writer.ts`,
   * which must not record an ETag it obtained from a second round trip.
   */
  getWithEtag?(key: string): Promise<StoredObject | null>;
  /**
   * List object keys under a prefix. Optional: only the real S3/MinIO store
   * and stores that back sharded aggregates (e.g. scrape-status `state/`)
   * need it. Aggregates degrade to an empty list when a store omits it.
   */
  list?(prefix: string): Promise<string[]>;
}

/**
 * Build the content-addressed (CAS) raw-object key — spec
 * docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1:
 *   raw/{citySlug}/{sourceKind}/cas/{sha256}.{ext}
 *
 * The fetch date is deliberately NOT part of the key: the same document
 * content always maps to the same key, giving free dedup + idempotence
 * (a HEAD on the key tells you whether the doc is already stored). The
 * temporal axis lives in the run manifests, not in the object key.
 */
export function casObjectKey(params: {
  citySlug: string;
  sourceKind: string;
  sha256: string;
  ext: string;
}): string {
  const { citySlug, sourceKind, sha256, ext } = params;
  const cleanExt = ext.replace(/^\./, "");
  return `raw/${citySlug}/${sourceKind}/cas/${sha256}.${cleanExt}`;
}

/**
 * Sibling metadata key for a CAS object (RawDocumentRecord: url, fetchedAt,
 * httpStatus, robotsOk, contentType, provenance):
 *   raw/{citySlug}/{sourceKind}/cas/{sha256}.meta.json
 */
export function casMetaKey(params: {
  citySlug: string;
  sourceKind: string;
  sha256: string;
}): string {
  const { citySlug, sourceKind, sha256 } = params;
  return `raw/${citySlug}/${sourceKind}/cas/${sha256}.meta.json`;
}

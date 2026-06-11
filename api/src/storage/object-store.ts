/** A stored object's metadata returned by head/put. */
export interface ObjectInfo {
  key: string;
  size?: number | undefined;
  contentType?: string | undefined;
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

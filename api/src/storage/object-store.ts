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
}

/**
 * Build the canonical raw-object key (rules/sources.md):
 *   raw/<source>/<YYYY>/<MM>/<DD>/<sha256>.<ext>
 */
export function rawObjectKey(params: {
  source: string;
  date: Date;
  sha256: string;
  ext: string;
}): string {
  const { source, date, sha256, ext } = params;
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const cleanExt = ext.replace(/^\./, "");
  return `raw/${source}/${yyyy}/${mm}/${dd}/${sha256}.${cleanExt}`;
}

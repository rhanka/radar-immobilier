/**
 * Served-contract pointer reader, precondition P1 (I-1A, converged r3 §2).
 *
 * The pointer `exports/immo/geo-served-contract/v1/latest.json` lives in the
 * geo bucket `sentropic-geo` and is read ONLY through configuration: the
 * `GEO_SERVED_CONTRACT_S3_*` variables below name the read credential, which
 * does not exist yet. When the credential is absent — or the object is absent
 * or unreadable — the reader reports `missing source` explicitly and never
 * fabricates a value (no snapshot_sha256 invented).
 *
 * Prefix scoping (geo-review-r3 G2): the reader refuses any key outside
 * `exports/immo/geo-served-contract/v1/` BEFORE any upstream call. The
 * granted credential itself must be scoped by the geo side (dedicated export
 * bucket, or a prefix-scoped read verified by a negative test — see the
 * runbook); this in-code guard is the second, fail-closed layer, and it is
 * covered by negative tests that assert zero upstream calls on refusal.
 */

/** Exact pointer key the facade is allowed to read. */
export const SERVED_CONTRACT_POINTER_KEY =
  "exports/immo/geo-served-contract/v1/latest.json";

/**
 * Prefix outside of which every read is refused (G2 negative test target).
 *
 * Scoped to the served-contract tree only: a credential granted the wider
 * `exports/immo/` prefix could also read unrelated immo exports, so keys
 * outside `exports/immo/geo-served-contract/v1/` are refused in code even
 * when they sit under `exports/immo/`.
 */
export const SERVED_CONTRACT_ALLOWED_PREFIX = "exports/immo/geo-served-contract/v1/";

/** Env vars naming the read credential (all optional — absent ⇒ missing source). */
export const SERVED_CONTRACT_ENV_VARS = [
  "GEO_SERVED_CONTRACT_S3_ENDPOINT",
  "GEO_SERVED_CONTRACT_S3_REGION",
  "GEO_SERVED_CONTRACT_S3_BUCKET",
  "GEO_SERVED_CONTRACT_S3_ACCESS_KEY",
  "GEO_SERVED_CONTRACT_S3_SECRET_KEY",
] as const;

export interface ServedContractStoreConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

/** Minimal env subset the resolver reads (injectable for tests). */
export interface ServedContractEnv {
  readonly GEO_SERVED_CONTRACT_S3_ENDPOINT?: string | undefined;
  readonly GEO_SERVED_CONTRACT_S3_REGION?: string | undefined;
  readonly GEO_SERVED_CONTRACT_S3_BUCKET?: string | undefined;
  readonly GEO_SERVED_CONTRACT_S3_ACCESS_KEY?: string | undefined;
  readonly GEO_SERVED_CONTRACT_S3_SECRET_KEY?: string | undefined;
}

/**
 * Resolve the read credential from configuration only. Returns undefined
 * when ANY field is missing — the caller then reports `missing source`.
 * Never falls back to another bucket or credential.
 */
export function resolveServedContractStoreConfig(
  env: ServedContractEnv,
): ServedContractStoreConfig | undefined {
  const endpoint = env.GEO_SERVED_CONTRACT_S3_ENDPOINT;
  const region = env.GEO_SERVED_CONTRACT_S3_REGION;
  const bucket = env.GEO_SERVED_CONTRACT_S3_BUCKET;
  const accessKey = env.GEO_SERVED_CONTRACT_S3_ACCESS_KEY;
  const secretKey = env.GEO_SERVED_CONTRACT_S3_SECRET_KEY;
  if (!endpoint || !region || !bucket || !accessKey || !secretKey) return undefined;
  return { endpoint, region, bucket, accessKey, secretKey };
}

/** Injectable object-store seam (a future S3 GetObject plugs in here). */
export interface ServedContractClient {
  getObjectText(bucket: string, key: string): Promise<string | null>;
}

export type ServedContractPointer =
  | { readonly status: "ok"; readonly snapshotSha256: string }
  | { readonly status: "missing source"; readonly reason: string }
  | { readonly status: "refused"; readonly reason: string };

/**
 * Guard: refuse any read outside `exports/immo/geo-served-contract/v1/`.
 * Pure — no upstream call.
 *
 * Beyond the prefix, traversal (`..`), empty segments (`//`) and control
 * characters are refused outright: S3 keys are opaque strings, so
 * `exports/immo/geo-served-contract/v1/../../raw/...` must never satisfy
 * the guard by prefix alone.
 */
export function assertContractKeyAllowed(key: string): boolean {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key !== SERVED_CONTRACT_POINTER_KEY && !key.startsWith(SERVED_CONTRACT_ALLOWED_PREFIX)) {
    return false;
  }
  if (key.includes("..")) return false;
  if (key.includes("//")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  return true;
}

/** True when the parsed pointer body carries a usable snapshot marker. */
export function parseSnapshotSha256(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const marker = (body as Record<string, unknown>)["snapshot_sha256"];
  if (typeof marker !== "string" || marker.length === 0) return undefined;
  return marker;
}

/**
 * Read the served-contract pointer through configuration only.
 *
 * Outcomes: `ok` with the snapshot marker; `missing source` when the
 * credential is absent, the object is absent/unreadable, or the body carries
 * no marker; `refused` when the requested key escapes `exports/immo/`
 * (checked before any client call — the client is never invoked then).
 */
export async function readServedContractPointer(options: {
  env?: ServedContractEnv | undefined;
  client?: ServedContractClient | undefined;
  key?: string | undefined;
}): Promise<ServedContractPointer> {
  const key = options.key ?? SERVED_CONTRACT_POINTER_KEY;
  if (!assertContractKeyAllowed(key)) {
    return { status: "refused", reason: "read-outside-exports-immo-refused" };
  }
  const config = resolveServedContractStoreConfig(options.env ?? {});
  if (!config) {
    return { status: "missing source", reason: "credential-not-configured" };
  }
  if (!options.client) {
    return { status: "missing source", reason: "reader-not-wired" };
  }
  let text: string | null;
  try {
    text = await options.client.getObjectText(config.bucket, key);
  } catch {
    return { status: "missing source", reason: "pointer-unreadable" };
  }
  if (text === null) {
    return { status: "missing source", reason: "pointer-absent" };
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { status: "missing source", reason: "pointer-invalid" };
  }
  const snapshotSha256 = parseSnapshotSha256(body);
  if (!snapshotSha256) {
    return { status: "missing source", reason: "pointer-without-snapshot" };
  }
  return { status: "ok", snapshotSha256 };
}

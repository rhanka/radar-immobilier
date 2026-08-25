import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { AppConfig, ScrapeS3Config } from "../config.js";
import { resolveGeoDocumentsS3Config, resolveScrapeS3Config } from "../config.js";
import type { ProbeResult } from "../routes/health.js";
import {
  isCanonicalGraphKey,
  type ObjectInfo,
  type ObjectReader,
  type ObjectStore,
  type StoredObject,
} from "./object-store.js";

/** Whether an S3 error means "object absent" (vs. a real access/network fault). */
function isMissingObjectError(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/** Thrown when an unguarded `put()` targets `graph/<city>/latest.json`. */
export class CanonicalGraphWriteRefused extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `refusing unguarded write to canonical graph key ${key}: this key is read as truth ` +
        "by the projector and the replay, and overwriting it is irreversible. Write it " +
        "through services/graph/canonical-graph-writer.ts (archive + expected-version check).",
    );
    this.name = "CanonicalGraphWriteRefused";
    this.key = key;
  }
}

/** Options for the guarded canonical write (see `putCanonicalGraph`). */
export interface ConditionalPutOptions {
  /** Expect the stored object to still carry this ETag; `null` = expect absent. */
  ifMatch: string | null;
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  /**
   * Write an object. Refuses `graph/<city>/latest.json`: that key is the
   * canonical city snapshot and only the guarded writer may replace it. The
   * refusal is deliberate — a guard carried by one caller protects nothing
   * against the next caller, so it is carried by the write path instead.
   */
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
  ): Promise<ObjectInfo> {
    if (isCanonicalGraphKey(key)) throw new CanonicalGraphWriteRefused(key);
    return this.putUnchecked(key, body, contentType);
  }

  private async putUnchecked(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
    conditions?: { IfMatch?: string; IfNoneMatch?: string },
  ): Promise<ObjectInfo> {
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(conditions ?? {}),
      }),
    );
    return { key, contentType, etag: res.ETag };
  }

  /**
   * The only door through the canonical-key guard. Callers must supply the
   * ETag they archived (`null` when the object did not exist), which is sent
   * as a conditional `If-Match` / `If-None-Match` header so the backend
   * rejects the write if another writer moved the object in between.
   *
   * LIMIT, declared: conditional writes on PUT are honoured by AWS S3 and by
   * MinIO, but Scaleway's Object Storage support is not verified here. The
   * caller therefore ALSO performs a HEAD re-check immediately before this
   * call (`canonical-graph-writer.ts`). That pair narrows the race to the few
   * milliseconds between HEAD and PUT when the header is ignored; it does not
   * close it. Do not describe this as atomic.
   */
  async putCanonicalGraph(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType: string | undefined,
    options: ConditionalPutOptions,
  ): Promise<ObjectInfo> {
    const conditions = options.ifMatch === null
      ? { IfNoneMatch: "*" }
      : { IfMatch: options.ifMatch };
    return this.putUnchecked(key, body, contentType, conditions);
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return res.Body.transformToByteArray();
  }

  /**
   * Read bytes and the ETag of those exact bytes in ONE round trip.
   *
   * `GetObjectCommand` already returns the `ETag` of the version it served, so
   * a second `head()` is not merely redundant: between the two calls another
   * writer may publish, and the caller then holds version N-1's bytes labelled
   * with version N's ETag. The canonical-graph archive used to do exactly that
   * and would then let a guarded write erase a version it had never copied.
   *
   * Returns `null` when the key does not exist — an absent object is a state,
   * not a failure, and the guarded writer distinguishes the two.
   */
  async getWithEtag(key: string): Promise<StoredObject | null> {
    let res;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      const name = (error as { name?: string })?.name ?? "";
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
      throw error;
    }
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return { key, body: await res.Body.transformToByteArray(), etag: res.ETag ?? null };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: res.ContentLength,
        contentType: res.ContentType,
        etag: res.ETag,
      };
    } catch {
      return null;
    }
  }

  /** List all object keys under a prefix (paginated). */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /** Throws if the bucket is not reachable. Used by the health probe. */
  async checkBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Create the bucket if it does not exist (dev/test convenience). */
  async ensureBucket(): Promise<void> {
    try {
      await this.checkBucket();
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (e) {
        // On a shared MinIO/S3 namespace the bucket may already exist (created
        // by a peer between our check and create) — that's success, not an
        // error. Only a genuine create failure should propagate. (poc-k8s
        // flagged the `BucketAlreadyExists` warn noise at boot, 2026-07-03.)
        const name = (e as { name?: string })?.name ?? "";
        if (name !== "BucketAlreadyExists" && name !== "BucketAlreadyOwnedByYou") {
          throw e;
        }
      }
    }
  }
}

/**
 * Read-only S3 capability for the immo→geo document repoint. It exposes ONLY
 * `get`/`head` (the `ObjectReader` boundary) — no `put`, `list`, `ensureBucket`,
 * or any write/mutate/enumerate method exists on this class. That is the
 * enforcement of zero-copy + read-only: the immo api physically cannot write to,
 * copy within, or scan the geo bucket through this object.
 *
 * `head` returns `null` for a genuinely absent object but PROPAGATES any other
 * failure (e.g. AccessDenied on a misconfigured read key): a silent null there
 * would masquerade a credential/endpoint fault as a plain 404 and hide the
 * cutover breaking.
 */
export class S3ObjectReader implements ObjectReader {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return res.Body.transformToByteArray();
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: res.ContentLength,
        contentType: res.ContentType,
        etag: res.ETag,
      };
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  }
}

/**
 * Build the read-only geo document reader from a full AppConfig. Only called
 * when GEO_DOCUMENTS_REPOINT=1; `resolveGeoDocumentsS3Config` throws if the
 * dedicated GEO_DOCUMENTS_S3_* wiring is incomplete (no immo fallback).
 */
export function getGeoDocumentsReader(config: AppConfig): S3ObjectReader {
  const geoConfig = resolveGeoDocumentsS3Config(config);
  return new S3ObjectReader(createScrapeS3Client(geoConfig), geoConfig.bucket);
}

export function createS3Client(config: AppConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  };
  return new S3Client(clientConfig);
}

export function createObjectStore(config: AppConfig): S3ObjectStore {
  return new S3ObjectStore(createS3Client(config), config.S3_BUCKET);
}

/**
 * Build an S3Client from a resolved ScrapeS3Config (not a full AppConfig).
 * Used by `getScrapeObjectStore` and testable in isolation.
 */
export function createScrapeS3Client(scrapeConfig: ScrapeS3Config): S3Client {
  const clientConfig: S3ClientConfig = {
    region: scrapeConfig.region,
    endpoint: scrapeConfig.endpoint,
    forcePathStyle: scrapeConfig.forcePathStyle,
    credentials: {
      accessKeyId: scrapeConfig.accessKey,
      secretAccessKey: scrapeConfig.secretKey,
    },
  };
  return new S3Client(clientConfig);
}

/**
 * Build the dedicated scraping-document store from a full AppConfig.
 * In production (SCRAPE_S3_* set to SCW), this targets `radar-immobilier-docs`
 * on `https://s3.fr-par.scw.cloud`. Locally (no SCRAPE_S3_* set), it falls back
 * to the same MinIO instance as the main store, using the `radar-immobilier-docs`
 * bucket name (which ensureBucket will create on first use).
 */
export function getScrapeObjectStore(config: AppConfig): S3ObjectStore {
  const scrapeConfig = resolveScrapeS3Config(config);
  return new S3ObjectStore(createScrapeS3Client(scrapeConfig), scrapeConfig.bucket);
}

/** Health probe: bucket exists / is reachable. */
export function makeObjectStoreProbe(
  store: S3ObjectStore,
): () => Promise<ProbeResult> {
  return async () => {
    await store.checkBucket();
    return { ok: true };
  };
}

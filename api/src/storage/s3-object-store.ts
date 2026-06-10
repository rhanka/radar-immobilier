import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { AppConfig, ScrapeS3Config } from "../config.js";
import { resolveScrapeS3Config } from "../config.js";
import type { ProbeResult } from "../routes/health.js";
import type { ObjectInfo, ObjectStore } from "./object-store.js";

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
  ): Promise<ObjectInfo> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, contentType };
  }

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
      };
    } catch {
      return null;
    }
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
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
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

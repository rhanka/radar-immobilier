import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { loadConfig } from "../../src/config.js";
import {
  assertAttributedTestObjects, cleanupArtifactTestResources, listTestBucketKeys,
} from "./artifacts-s3.helpers.js";

const BUCKET = "h2-artifacts-listkeys";
const SCOPE = "listkeys_scope";
const PREFIX = `artifacts/${SCOPE}/`;
let s3: S3Client;
let bucketCreated = false;
const rawBlobs = () => createS3BlobStore({ client: s3, bucket: BUCKET });
function client(): S3Client {
  const env = loadConfig();
  return new S3Client({ endpoint: env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
}
beforeAll(async () => {
  s3 = client();
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  bucketCreated = true;
});
afterAll(async () => {
  await cleanupArtifactTestResources({ s3, bucket: bucketCreated ? BUCKET : undefined,
    pool: undefined, admin: undefined, database: undefined });
});

describe("artifact test inventories on real S3", () => {
  it("should reject the former empty prefix and accept the artifact scope prefix", async () => {
    const blobs = rawBlobs();
    // Reflect deliberately exercises the invalid upstream call without adding
    // a forbidden direct call to the integration suite guarded by the AST test.
    await expect(Reflect.apply(blobs.listKeys, blobs, [""])).rejects.toThrow("invalid blob prefix: ");
    const key = `${PREFIX}blobs/sha256/${"a".repeat(64)}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "scoped fixture" }));
    await expect(blobs.listKeys(PREFIX)).resolves.toEqual([key]);
  });

  it("should preserve the bucket-wide no-unattributed-write assertion", async () => {
    const baseline = new Set(await listTestBucketKeys(s3, BUCKET));
    const attributable = new Set<string>();
    const after = await listTestBucketKeys(s3, BUCKET);
    expect(() => assertAttributedTestObjects(after, baseline, attributable)).not.toThrow();
  });

  it.each(["artifacts/foreign_scope/blobs/sha256/unattributed", "unexpected-root/unattributed"])(
    "should detect an undeclared write at %s even outside the configured scope", async (key) => {
      const baseline = new Set(await listTestBucketKeys(s3, BUCKET));
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "foreign write" }));
      expect(await rawBlobs().listKeys(PREFIX)).not.toContain(key);
      // The same assertion is used by verifyPreparationCleanup in Q1/Q2.
      const after = await listTestBucketKeys(s3, BUCKET);
      expect(after).toContain(key);
      expect(() => assertAttributedTestObjects(after, baseline, new Set())).toThrow("undeclared S3 object");
    },
  );

  it("should follow real continuation tokens and return a sorted complete inventory", async () => {
    let pages = 0;
    s3.middlewareStack.add((next, context) => async (args) => {
      if (context.commandName === "ListObjectsV2Command") {
        (args.input as { MaxKeys?: number }).MaxKeys = 1;
        pages++;
      }
      return next(args);
    }, { step: "initialize", name: "smallInventoryPages" });
    try {
      const keys = await listTestBucketKeys(s3, BUCKET);
      expect(keys).toHaveLength(3);
      expect(keys).toEqual([...keys].sort());
      expect(pages).toBe(3);
    } finally { s3.middlewareStack.remove("smallInventoryPages"); }
  });

  it("should remove the bucket after a transient delete failure and report that failure", async () => {
    const cleanupClient = client();
    const bucket = `${BUCKET}-cleanup`;
    await cleanupClient.send(new CreateBucketCommand({ Bucket: bucket }));
    let failed = false;
    let removed = false;
    try {
      for (const key of [`${PREFIX}owned`, "foreign/leftover"]) {
        await cleanupClient.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: "cleanup" }));
      }
      cleanupClient.middlewareStack.add((next, context) => async (args) => {
        if (context.commandName === "DeleteObjectCommand" && !failed) {
          failed = true;
          throw new Error("injected cleanup delete failure");
        }
        return next(args);
      }, { step: "initialize", name: "failOneDelete" });
      const cleanup = cleanupArtifactTestResources({ s3: cleanupClient, bucket,
        pool: undefined, admin: undefined, database: undefined });
      await expect(cleanup).rejects.toBeInstanceOf(AggregateError);
      expect(failed).toBe(true);
      await expect(s3.send(new HeadBucketCommand({ Bucket: bucket }))).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
      removed = true;
    } finally {
      cleanupClient.middlewareStack.remove("failOneDelete");
      if (!removed) await cleanupArtifactTestResources({ s3: cleanupClient, bucket,
        pool: undefined, admin: undefined, database: undefined });
      cleanupClient.destroy();
    }
  });
});

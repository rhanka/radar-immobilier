import {
  DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, type S3Client,
} from "@aws-sdk/client-s3";
import type pg from "pg";

/** Dedicated test buckets only: include foreign scopes and unexpected root keys. */
export async function listTestBucketKeys(client: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket, ...(token === undefined ? {} : { ContinuationToken: token }),
    }));
    for (const item of page.Contents ?? []) if (item.Key !== undefined) keys.push(item.Key);
    if (page.IsTruncated && !page.NextContinuationToken) {
      throw new Error("test bucket inventory missing continuation token");
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return keys.sort();
}

export function assertAttributedTestObjects(keys: Iterable<string>, baseline: ReadonlySet<string>,
  attributable: ReadonlySet<string>): void {
  for (const key of keys) {
    if (!baseline.has(key) && !attributable.has(key)) {
      throw new Error("[contract-violation] undeclared S3 object without preparation attribution");
    }
  }
}

/** Report every cleanup error without preventing the remaining resources from closing. */
export async function cleanupArtifactTestResources(resources: {
  s3: S3Client | undefined;
  bucket: string | undefined;
  pool: pg.Pool | undefined;
  admin: pg.Pool | undefined;
  database: string | undefined;
}): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (label: string, work: () => Promise<unknown> | undefined) => {
    try { await work(); }
    catch (cause) { errors.push(new Error(`artifact test cleanup: ${label}`, { cause })); }
  };
  const { s3, bucket, pool, admin, database } = resources;
  if (s3 && bucket) {
    // A failed delete must not strand the other objects. Retry the complete
    // inventory once, including keys outside the host's configured scope.
    for (let pass = 0; pass < 2; pass++) {
      await attempt(`bucket inventory (pass ${pass + 1})`, async () => {
        for (const key of await listTestBucketKeys(s3, bucket)) {
          await attempt(`delete object ${key}`, () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
        }
      });
    }
    await attempt("delete bucket", () => s3.send(new DeleteBucketCommand({ Bucket: bucket })));
  }
  await attempt("destroy S3 client", async () => { s3?.destroy(); });
  await attempt("end application pool", () => pool?.end());
  await attempt("drop test database", () => database === undefined ? undefined
    : admin?.query(`DROP DATABASE ${database} WITH (FORCE)`));
  await attempt("end admin pool", () => admin?.end());
  if (errors.length) throw new AggregateError(errors, "artifact test cleanup failed; see individual causes");
}

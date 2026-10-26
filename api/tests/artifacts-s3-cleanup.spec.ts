import type pg from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { cleanupArtifactTestResources, listTestBucketKeys } from "./integration/artifacts-s3.helpers.js";

describe("artifact test resource cleanup", () => {
  it("should retain each failure and attempt all database cleanup steps", async () => {
    const pool = { end: vi.fn().mockRejectedValue(new Error("pool end failed")) };
    const admin = { query: vi.fn().mockRejectedValue(new Error("drop failed")),
      end: vi.fn().mockRejectedValue(new Error("admin end failed")) };
    const error = await cleanupArtifactTestResources({ s3: undefined, bucket: undefined,
      pool: pool as unknown as pg.Pool, admin: admin as unknown as pg.Pool, database: "test_listkeys" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((cause: Error) => cause.message)).toEqual([
      "artifact test cleanup: end application pool", "artifact test cleanup: drop test database",
      "artifact test cleanup: end admin pool",
    ]);
    expect((error as AggregateError).errors.map((cause: Error) => (cause.cause as Error).message))
      .toEqual(["pool end failed", "drop failed", "admin end failed"]);
    expect(admin.query).toHaveBeenCalledWith("DROP DATABASE test_listkeys WITH (FORCE)");
    expect(admin.end).toHaveBeenCalledOnce();
  });

  it("should retry a failed inventory, delete the bucket, and retain the inventory failure", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("inventory unavailable"))
      .mockResolvedValueOnce({ Contents: [{ Key: "foreign/object" }] })
      .mockResolvedValue({});
    const destroy = vi.fn();
    const error = await cleanupArtifactTestResources({ s3: { send, destroy } as unknown as S3Client,
      bucket: "dedicated-test-bucket", pool: undefined, admin: undefined, database: undefined })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(1);
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      "ListObjectsV2Command", "ListObjectsV2Command", "DeleteObjectCommand", "DeleteBucketCommand",
    ]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("should reject a truncated inventory without a continuation token", async () => {
    const s3 = { send: vi.fn().mockResolvedValue({ IsTruncated: true, Contents: [{ Key: "first" }] }) };
    await expect(listTestBucketKeys(s3 as unknown as S3Client, "test-bucket"))
      .rejects.toThrow("missing continuation token");
  });
});

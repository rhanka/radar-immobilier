import { type S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createTestMemoryBlobStore } from "./artifacts-blob-store.helpers.js";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { describe, expect, it, vi } from "vitest";

describe.each(["memory", "S3"] as const)("%s provider blob prefix contract", (kind) => {
  it.each(["", "..", "artifacts/../", "artifacts/scope..name/"])("should refuse prefix %j before I/O", async (prefix) => {
    const send = vi.fn();
    const blobs = kind === "memory" ? await createTestMemoryBlobStore()
      : createS3BlobStore({ client: { send } as unknown as S3Client, bucket: "prefix-test" });
    await expect(blobs.listKeys(prefix)).rejects.toBeInstanceOf(ArtifactOperationError);
    await expect(blobs.listKeys(prefix)).rejects.toMatchObject({ code: "invalid_blob_prefix", kind: "invalid_request" });
    expect(send).not.toHaveBeenCalled();
  });
});

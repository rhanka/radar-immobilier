import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { describe, expect, it, vi } from "vitest";
import { createTestMemoryBlobStore, createTestS3BlobStore } from "./artifacts-blob-store.helpers.js";

const keys = ["runtime/b", "runtime/a", "other/c"].map((value) => {
  const [scope, hex] = value.split("/");
  return `artifacts/${scope}/blobs/sha256/${hex!.repeat(64)}`;
});

describe("published blob listing parity", () => {
  it.each(["artifacts/", "artifacts/runtime/", "artifacts/missing/"])(
    "should return the same sorted keys for prefix %s", async (prefix) => {
      const memory = await createTestMemoryBlobStore();
      for (const key of keys) await memory.putBlob(key, new Uint8Array([1]));
      const send = vi.fn(async (command: ListObjectsV2Command) => ({
        Contents: keys.filter((key) => key.startsWith(command.input.Prefix!)).map((Key) => ({ Key })),
      }));
      const s3 = createS3BlobStore({ client: { send } as unknown as S3Client, bucket: "parity-test" });
      const expected = keys.filter((key) => key.startsWith(prefix)).sort();
      await expect(memory.listKeys(prefix)).resolves.toEqual(expected);
      await expect(s3.listKeys(prefix)).resolves.toEqual(expected);
      expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "parity-test", Prefix: prefix });
    },
  );

  it("should retain the provider's typed refusal through the S3 test helper", async () => {
    const send = vi.fn();
    const blobs = createTestS3BlobStore({ client: { send } as unknown as S3Client, bucket: "parity-test" });
    await expect(blobs.listKeys("")).rejects.toMatchObject({ code: "invalid_blob_prefix" });
    expect(send).not.toHaveBeenCalled();
  });
});

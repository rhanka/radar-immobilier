import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { describe, expect, it, vi } from "vitest";
import { createTestS3BlobStore, withTestBlobPrefixes } from "./artifacts-blob-store.helpers.js";

const prefix = "artifacts/runtime/";
const keys = [`${prefix}blobs/sha256/${"a".repeat(64)}`, "artifacts/other/blob"];

function fakeClient() {
  const send = vi.fn(async (command: ListObjectsV2Command) => ({
    Contents: keys.filter((key) => key.startsWith(command.input.Prefix ?? "")).map((Key) => ({ Key })),
  }));
  return { send, client: { send } as unknown as S3Client };
}

function fixture(kind: "memory" | "S3") {
  const { client, send } = fakeClient();
  const inner = kind === "S3" ? createS3BlobStore({ client, bucket: "runtime-test" }) : {
    keys,
    async listKeys(value: string) { return this.keys.filter((key) => key.startsWith(value)); },
  };
  const delegate = vi.spyOn(inner, "listKeys");
  return { blobs: withTestBlobPrefixes(inner), delegate, send };
}

describe.each(["memory", "S3"] as const)("%s test blob prefix runtime guard", (kind) => {
  it.each(["", "..", "artifacts/../", "artifacts/scope..name/", undefined, null, 42, {}, []])(
    "should reject invalid prefix %j before calling the underlying store", async (value) => {
      const { blobs, delegate, send } = fixture(kind);
      await expect(Reflect.apply(blobs.listKeys, blobs, [value]))
        .rejects.toThrow(`invalid blob prefix: ${String(value)}`);
      expect(delegate).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("should reject an omitted prefix before delegation", async () => {
    const { blobs, delegate } = fixture(kind);
    await expect(Reflect.apply(blobs.listKeys, blobs, []))
      .rejects.toThrow("invalid blob prefix: undefined");
    expect(delegate).not.toHaveBeenCalled();
  });

  it("should accept a scoped prefix and preserve the store receiver", async () => {
    const { blobs, delegate, send } = fixture(kind);
    await expect(blobs.listKeys(prefix)).resolves.toEqual([keys[0]]);
    expect(delegate).toHaveBeenCalledExactlyOnceWith(prefix);
    if (kind === "S3") {
      expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(ListObjectsV2Command));
      expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "runtime-test", Prefix: prefix });
    }
  });
});

describe("S3 test store factory", () => {
  it("should apply the runtime contract before invoking the S3 adapter", async () => {
    const { client, send } = fakeClient();
    const blobs = createTestS3BlobStore({ client, bucket: "runtime-test" });
    await expect(Reflect.apply(blobs.listKeys, blobs, [42])).rejects.toThrow("invalid blob prefix: 42");
    expect(send).not.toHaveBeenCalled();
    await expect(blobs.listKeys(prefix)).resolves.toEqual([keys[0]]);
  });
});

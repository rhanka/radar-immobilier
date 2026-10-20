import type { S3Client } from "@aws-sdk/client-s3";
import { PassThrough } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it, vi } from "vitest";
import {
  ArtifactS3TimeoutError,
  createTimeoutBlobStore,
  createTimeoutS3Client,
  withS3Timeout,
} from "./s3-timeout.js";

function fakeS3Client(
  sendImpl: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>,
): S3Client {
  return { send: vi.fn(sendImpl), destroy: vi.fn() } as unknown as S3Client;
}

async function sendOnce(client: S3Client, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
  return (client.send as unknown as (command: unknown, options?: unknown) => Promise<unknown>)({}, options);
}

function hangingSend(
  seen: { signal?: AbortSignal | undefined },
): (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown> {
  return async (_command, options) => {
    seen.signal = options?.abortSignal;
    await new Promise<unknown>((_resolve, reject) => {
      options?.abortSignal?.addEventListener(
        "abort",
        () => reject(options.abortSignal?.reason ?? new Error("aborted")),
        { once: true },
      );
    });
    return "unreached";
  };
}

describe("s3 operation timeout", () => {
  it("rejects a hanging operation with a typed error", async () => {
    await expect(withS3Timeout(new Promise<never>(() => {}), "test-op", 20)).rejects.toBeInstanceOf(
      ArtifactS3TimeoutError,
    );
  });

  it("passes a fast operation through", async () => {
    await expect(withS3Timeout(Promise.resolve("ok"), "test-op", 50)).resolves.toBe("ok");
  });

  it("bounds blob reads and stays reusable afterwards", async () => {
    const inner = {
      getBlob: vi.fn((_key: string) => new Promise<Uint8Array>(() => {})),
      listKeys: vi.fn(async () => ["a"]),
    };
    const blobs = createTimeoutBlobStore(inner, 20);
    await expect(blobs.getBlob("missing")).rejects.toBeInstanceOf(ArtifactS3TimeoutError);
    await expect(blobs.listKeys()).resolves.toEqual(["a"]);
  });

  it("aborts a hanging S3 send and surfaces a typed error", async () => {
    const seen: { signal?: AbortSignal | undefined } = {};
    const inner = fakeS3Client(hangingSend(seen));
    const client = createTimeoutS3Client(inner, 20);
    await expect(sendOnce(client)).rejects.toBeInstanceOf(ArtifactS3TimeoutError);
    expect(inner.send).toHaveBeenCalledTimes(1);
    expect(seen.signal?.aborted).toBe(true);
  });

  it("forwards user abort signals without masking them", async () => {
    const seen: { signal?: AbortSignal | undefined } = {};
    const inner = fakeS3Client(hangingSend(seen));
    const client = createTimeoutS3Client(inner, 1000);
    const controller = new AbortController();
    const pending = sendOnce(client, { abortSignal: controller.signal });
    controller.abort(new Error("user stop"));
    await expect(pending).rejects.toThrow("user stop");
  });

  it.each(["deadline", "user abort"])("interrupts the response body after headers on %s", async (reason) => {
    const body = new PassThrough();
    const controller = new AbortController();
    const client = createTimeoutS3Client(fakeS3Client(async () => ({ Body: body })), 20);
    try {
      await sendOnce(client, { abortSignal: controller.signal });
      const rejected = expect(buffer(body)).rejects.toThrow(
        reason === "deadline" ? "artifact s3 operation timed out" : "user stop",
      );
      if (reason === "user abort") controller.abort(new Error("user stop"));
      await rejected;
      expect(body.destroyed).toBe(true);
    } finally {
      body.destroy();
    }
  });

  it("cleans up cancellation when a response body finishes", async () => {
    const body = new PassThrough();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const client = createTimeoutS3Client(fakeS3Client(async () => ({ Body: body })), 1000);
    await sendOnce(client, { abortSignal: controller.signal });
    body.end("ok");
    expect((await buffer(body)).toString()).toBe("ok");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

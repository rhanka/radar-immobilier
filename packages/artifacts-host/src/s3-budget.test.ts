import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeArtifactHost } from "./composition.js";
import { blob, failureOf, startS3, stubConfig, stubPool, type S3Stub } from "./s3-stub.test-support.js";

vi.mock("./storage.js", () => ({
  initializeArtifactScope: vi.fn().mockResolvedValue(undefined),
}));

const { bytes: BYTES, key: KEY } = blob("<!doctype html><title>probe</title>");
const FAST_BUDGET = { attemptTimeoutMs: 300, maxAttempts: 3, operationTimeoutMs: 1500 };
const RETRIABLE_503 = { category: "provider_unavailable", httpStatus: 503, publicCode: "capability_unavailable", retriable: true };

async function withHost<T>(s3: S3Stub, extra: Record<string, unknown>,
  run: (host: Awaited<ReturnType<typeof composeArtifactHost>>) => Promise<T>): Promise<T> {
  const host = await composeArtifactHost(stubPool(), stubConfig(s3.url, extra));
  try { return await run(host); } finally { host.close(); await s3.close(); }
}

const settle = (work: Promise<unknown>) => work.then(() => "stored", (error: unknown) => error);

describe("artifact S3 budget against a stalling provider", () => {
  // The preparation sweeper ticks against the stub pool; its error line is noise here.
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("stores the blob when the first connection stalls, with the production budget", async () => {
    const s3 = await startS3({ stalled: (connection) => connection === 1 });
    await withHost(s3, {}, async (host) => {
      await host.blobs.putBlob(KEY, BYTES);
      expect(Buffer.from(s3.object(KEY) ?? [])).toEqual(Buffer.from(BYTES));
      expect(s3.connections).toBe(2);
    });
  }, 30_000);

  it("retries a stalled read-back on new connections inside the configured budget", async () => {
    const s3 = await startS3({ stalled: (connection) => connection === 2 || connection === 3, close: true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      await host.blobs.putBlob(KEY, BYTES);
      await expect(host.blobs.getBlob(KEY)).resolves.toEqual(BYTES);
      expect(s3.connections).toBe(4);
    });
  }, 30_000);

  it("stays a retriable 503 once every bounded attempt has stalled", async () => {
    const s3 = await startS3({ stalled: () => true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const cause = await settle(host.blobs.putBlob(KEY, BYTES));
      expect(cause).not.toBe("stored");
      expect(s3.connections).toBe(3);
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
    });
  }, 30_000);

  it("stays a retriable 503 when the SDK spends its attempts on provider 503s", async () => {
    const s3 = await startS3({ fail: () => ({ status: 503, code: "ServiceUnavailable", delayMs: 100 }) });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const cause = await settle(host.blobs.putBlob(KEY, BYTES));
      // The SDK error itself reaches the mapper, before the host deadline.
      expect(cause).toMatchObject({ name: "ServiceUnavailable", $metadata: { httpStatusCode: 503, attempts: 3 } });
      expect(s3.requests).toBe(3);
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
    });
  }, 30_000);

  it("retries a 429, then stays a retriable 503", async () => {
    const s3 = await startS3({ fail: () => ({ status: 429, code: "TooManyRequests" }) });
    // Throttling backs off up to 3 s over 3 attempts: give the operation room to show it.
    await withHost(s3, { s3Budget: { ...FAST_BUDGET, operationTimeoutMs: 5000 } }, async (host) => {
      const cause = await settle(host.blobs.putBlob(KEY, BYTES));
      expect(cause).toMatchObject({ $metadata: { httpStatusCode: 429, attempts: 3 } });
      expect(s3.requests).toBe(3);
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
    });
  }, 30_000);

  it("does not retry or mask a permanent refusal", async () => {
    const s3 = await startS3({ fail: () => ({ status: 403, code: "AccessDenied" }) });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const cause = await settle(host.blobs.putBlob(KEY, BYTES));
      expect(cause).toMatchObject({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      expect(s3.requests).toBe(1);
      expect(failureOf(cause)).toMatchObject({ httpStatus: 500, retriable: false });
    });
  }, 30_000);
});


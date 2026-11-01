import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeArtifactHost } from "./composition.js";
import { withS3Deadline } from "./s3-timeout.js";
import { blob, failureOf, startS3, stubConfig, stubPool, thirdAttemptOnly, type S3Stub } from "./s3-stub.test-support.js";

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

/** Same order as a publish: stage every file, then read every file back. */
async function stageAndReadBack(blobs: { putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined> }, files: number) {
  const staged = Array.from({ length: files }, (_, index) => blob(`<p>file ${index}</p>`));
  for (const file of staged) await blobs.putBlob(file.key, file.bytes);
  for (const file of staged) expect(await blobs.getBlob(file.key)).toEqual(file.bytes);
}

describe("one deadline shared by every blob operation of an invocation", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Every operation succeeds on its third attempt only: >= 600 ms each with 300 ms attempts.
  it("finishes inside the deadline when the operations fit", async () => {
    const s3 = await startS3({ stalled: thirdAttemptOnly, close: true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const started = Date.now();
      await withS3Deadline(started + 4000, () => stageAndReadBack(host.blobs, 1));
      expect(Date.now() - started).toBeLessThan(4000);
      expect(s3.connections).toBe(6);
    });
  }, 30_000);

  it("ends with a retriable 503 at the deadline and starts nothing after it", async () => {
    const s3 = await startS3({ stalled: thirdAttemptOnly, close: true });
    await withHost(s3, { s3Budget: FAST_BUDGET }, async (host) => {
      const started = Date.now();
      const deadline = started + 2000;
      // 2 files = 4 operations of >= 600 ms each, every one within its own 1500 ms budget.
      const cause = await settle(withS3Deadline(deadline, () => stageAndReadBack(host.blobs, 2)));
      const ended = Date.now();
      expect(cause).toMatchObject({ code: "artifact_s3_timeout" });
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
      expect(ended).toBeGreaterThanOrEqual(deadline - 50);
      expect(ended).toBeLessThan(deadline + 250);
      const connections = s3.connections;
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(s3.connections).toBe(connections);
      expect(s3.requestTimes.every((at) => at <= deadline)).toBe(true);
    });
  }, 30_000);
});

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeArtifactHost } from "./composition.js";
import { createDeleteConfirmation } from "./delete-confirmation.js";
import { PUBLISH_BLOB_DEADLINE_MS, PUBLISH_FINALIZE_MARGIN_MS,
  PREPARATION_WINDOW_MS, resolvePublishDeadlines } from "./commit-domain.js";
import { resolvePublishBlobDeadlineMs } from "./config.js";
import { ArtifactS3TimeoutError, withS3Deadline } from "./s3-timeout.js";
import { blob, failureOf, startS3, stubConfig, stubPool, type S3Stub } from "./s3-stub.test-support.js";

vi.mock("./storage.js", () => ({
  initializeArtifactScope: vi.fn().mockResolvedValue(undefined),
}));

const RETRIABLE_503 = { category: "provider_unavailable", httpStatus: 503, publicCode: "capability_unavailable", retriable: true };

async function withHost<T>(s3: S3Stub, extra: Record<string, unknown>,
  run: (host: Awaited<ReturnType<typeof composeArtifactHost>>) => Promise<T>): Promise<T> {
  const pool = stubPool();
  const host = await composeArtifactHost(pool, stubConfig(s3.url, extra), undefined,
    { confirmation: createDeleteConfirmation(pool, "scope", "https://app.test") });
  try { return await run(host); } finally { host.close(); await s3.close(); }
}

/**
 * The exact blob sequence a publish runs in @sentropic/artifacts@0.2.9:
 * `publishFinalized` stages every file (`for putBlob`), then
 * `verifyStagedBlobs` reads every file back (`for getBlob`) — strictly
 * sequential, one S3 round trip per file per phase, before the finalization
 * transaction takes any lock.
 */
async function stageAndReadBack(blobs: { putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined> }, files: number, bytesOf: (index: number) => Uint8Array) {
  const staged = Array.from({ length: files }, (_, index) => {
    const bytes = bytesOf(index);
    const hex = createHash("sha256").update(bytes).digest("hex");
    return { key: `artifacts/scope/blobs/sha256/${hex}`, bytes };
  });
  for (const file of staged) await blobs.putBlob(file.key, file.bytes);
  for (const file of staged) expect(await blobs.getBlob(file.key)).toEqual(file.bytes);
  return staged.length;
}

const settle = (work: Promise<unknown>) => work.then(() => "stored", (error: unknown) => error);

/** ~8.5 KiB distinct pages: 30 of them stay under the 256 KiB total profile cap. */
function pageBytes(index: number, padding: number): Uint8Array {
  const head = `<!doctype html><html><body><h1>file ${index}</h1><p>`;
  const tail = "</p></body></html>";
  const fill = "x".repeat(Math.max(0, padding - head.length - tail.length));
  return new TextEncoder().encode(`${head}${fill}${tail}`);
}

describe("P1 publish deadline proof (preprod multi-file 503)", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("proves 8 files cannot fit the 20s production deadline at 1.3s per request", async () => {
    const s3 = await startS3({ latencyMs: 1300 });
    await withHost(s3, {}, async (host) => {
      const started = Date.now();
      const cause = await settle(withS3Deadline(started + PUBLISH_BLOB_DEADLINE_MS,
        () => stageAndReadBack(host.blobs, 8, () => blob("<p>probe</p>").bytes)));
      const elapsed = Date.now() - started;
      // 8 files x (PUT + GET) x 1.3s = 20.8s of sequential S3: the shared
      // deadline fires first and the publish ends as a retriable 503.
      expect(cause).toBeInstanceOf(ArtifactS3TimeoutError);
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
      expect(elapsed).toBeGreaterThanOrEqual(19_500);
      expect(elapsed).toBeLessThan(22_000);
      // Exactly one PUT per file, no HEAD anywhere: the minimum per file.
      expect(s3.timeline.filter((record) => record.method === "PUT")).toHaveLength(8);
      expect(s3.timeline.every((record) => record.method === "PUT" || record.method === "GET")).toBe(true);
      expect(s3.requests).toBeGreaterThanOrEqual(14);
    });
  }, 40_000);

  it("proves the same at 2.5s per request", async () => {
    const s3 = await startS3({ latencyMs: 2500 });
    await withHost(s3, {}, async (host) => {
      const started = Date.now();
      const cause = await settle(withS3Deadline(started + PUBLISH_BLOB_DEADLINE_MS,
        () => stageAndReadBack(host.blobs, 8, () => blob("<p>probe</p>").bytes)));
      const elapsed = Date.now() - started;
      expect(cause).toBeInstanceOf(ArtifactS3TimeoutError);
      expect(failureOf(cause)).toMatchObject(RETRIABLE_503);
      expect(elapsed).toBeGreaterThanOrEqual(19_500);
      expect(elapsed).toBeLessThan(22_500);
      expect(s3.timeline.filter((record) => record.method === "PUT").length).toBeGreaterThanOrEqual(7);
      expect(s3.timeline.every((record) => record.method === "PUT" || record.method === "GET")).toBe(true);
    });
  }, 40_000);

  it("reuses connections across the sequential publish sequence", async () => {
    const s3 = await startS3({});
    await withHost(s3, {}, async (host) => {
      await stageAndReadBack(host.blobs, 30, (index) => pageBytes(index, 1024));
      expect(s3.requests).toBe(60);
      expect(s3.connections).toBeLessThanOrEqual(4);
    });
  }, 60_000);

  it("fits 30 files of ~250KiB under 1.3s per request inside a configured deadline", async () => {
    const s3 = await startS3({ latencyMs: 1300 });
    const blobDeadlineMs = resolvePublishBlobDeadlineMs("100000");
    await withHost(s3, { publishBlobDeadlineMs: blobDeadlineMs }, async (host) => {
      const started = Date.now();
      // 30 files x (PUT + GET) x 1.3s = 78s sequential: over the 20s default,
      // inside the configured bound.
      await withS3Deadline(started + blobDeadlineMs,
        () => stageAndReadBack(host.blobs, 30, (index) => pageBytes(index, 8500)));
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(75_000);
      expect(elapsed).toBeLessThan(blobDeadlineMs);
      expect(s3.requests).toBe(60);
    });
  }, 150_000);
});

describe("publish deadline configuration", () => {
  it("keeps the default blob deadline strictly inside the preparation window", () => {
    expect(PUBLISH_FINALIZE_MARGIN_MS).toBeGreaterThan(0);
    expect(PUBLISH_BLOB_DEADLINE_MS + PUBLISH_FINALIZE_MARGIN_MS).toBe(PREPARATION_WINDOW_MS);
  });

  it("derives the preparation window from the configured blob deadline", () => {
    expect(resolvePublishDeadlines(20_000)).toEqual({ blobDeadlineMs: 20_000, preparationWindowMs: 30_000 });
    expect(resolvePublishDeadlines(100_000)).toEqual({ blobDeadlineMs: 100_000, preparationWindowMs: 110_000 });
    expect(resolvePublishDeadlines()).toEqual({ blobDeadlineMs: PUBLISH_BLOB_DEADLINE_MS,
      preparationWindowMs: PREPARATION_WINDOW_MS });
  });

  it("resolves the blob deadline from configuration with a safe upper bound", () => {
    expect(resolvePublishBlobDeadlineMs("120000")).toBe(120_000);
    for (const raw of ["nope", "0", "999", "290001", "12.5"]) {
      expect(() => resolvePublishBlobDeadlineMs(raw), raw).toThrow("invalid ARTIFACTS_PUBLISH_BLOB_DEADLINE_MS");
    }
  });
});

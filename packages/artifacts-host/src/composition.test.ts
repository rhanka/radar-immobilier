import { describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import type pg from "pg";
import { composeArtifactHost } from "./composition.js";
import { createDeleteConfirmation } from "./delete-confirmation.js";
const options = { confirmation: createDeleteConfirmation({} as pg.Pool, "scope", "https://app.test") };

vi.mock("./storage.js", () => ({
  initializeArtifactScope: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@aws-sdk/client-s3", async (original) => {
  const sdk = await original<typeof import("@aws-sdk/client-s3")>();
  return { ...sdk, S3Client: vi.fn(class extends sdk.S3Client {}) };
});

describe("artifact S3 composition", () => {
  it("uses the configured region and bounded per-attempt deadlines with retries", async () => {
    const host = await composeArtifactHost({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool, {
      enabled: true, storageScope: "scope", orgId: "org", s3Bucket: "test-bucket",
      s3Endpoint: "http://minio:9000", s3Region: "ca-central-1", s3AccessKey: "test", s3SecretKey: "test",
    }, undefined, options);
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
      region: "ca-central-1", requestHandler: { requestTimeout: 4000, connectionTimeout: 3000, throwOnRequestTimeout: true },
      maxAttempts: 3, retryMode: "standard",
    }));
    host.close();
  });

  it("applies a resolved S3 budget to the client", async () => {
    const host = await composeArtifactHost({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool, {
      enabled: true, storageScope: "scope", orgId: "org", s3Bucket: "test-bucket",
      s3Endpoint: "http://minio:9000", s3Region: "ca-central-1", s3AccessKey: "test", s3SecretKey: "test",
      s3Budget: { attemptTimeoutMs: 2500, maxAttempts: 4, operationTimeoutMs: 11_000 },
    }, undefined, options);
    expect(S3Client).toHaveBeenLastCalledWith(expect.objectContaining({
      requestHandler: { requestTimeout: 2500, connectionTimeout: 3000, throwOnRequestTimeout: true }, maxAttempts: 4,
    }));
    host.close();
  });

  it("only sends and validates checksums when the operation requires them", async () => {
    const host = await composeArtifactHost({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool, {
      enabled: true, storageScope: "scope", orgId: "org", s3Bucket: "test-bucket",
      s3Endpoint: "https://s3.bhs.io.cloud.ovh.net", s3Region: "bhs", s3AccessKey: "test", s3SecretKey: "test",
    }, undefined, options);
    expect(S3Client).toHaveBeenLastCalledWith(expect.objectContaining({
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    }));
    host.close();
  });
});

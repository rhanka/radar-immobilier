import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { classifyArtifactFailure, projectArtifactHttpOutcome } from "@sentropic/artifacts/server/outcome-contract";
import { mapHostError } from "./host-outcome.js";
import { isPoolAcquisitionTimeout } from "./idempotency.js";

function dispatchFailure(message: string) {
  return { ok: false as const, failure: classifyArtifactFailure(new Error(message),
    { invocationId: randomUUID(), operation: "ensure", phase: "dispatch", commitState: "not_committed" }, mapHostError) };
}

describe("pool acquisition timeout mapping", () => {
  it("maps saturation without code to retriable 503", () => {
    expect(isPoolAcquisitionTimeout(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(dispatchFailure("timeout exceeded when trying to connect"))
      .toMatchObject({ ok: false, failure: { category: "provider_unavailable", httpStatus: 503, retriable: true } });
  });

  it("maps connection-open timeout to retriable 503", () => {
    const message = "Connection terminated due to connection timeout";
    expect(isPoolAcquisitionTimeout(new Error(message))).toBe(true);
    expect(dispatchFailure(message))
      .toMatchObject({ ok: false, failure: { category: "provider_unavailable", httpStatus: 503, retriable: true } });
  });

  it("keeps an unrelated connection error unmapped", () => {
    expect(isPoolAcquisitionTimeout(new Error("connection reset by peer"))).toBe(false);
    expect(mapHostError(new Error("connection reset by peer"))).toBeUndefined();
  });
});

describe("provider blob prefix error projection", () => {
  it("should preserve the provider's typed refusal without a host mapping", async () => {
    const send = vi.fn();
    const blobs = createS3BlobStore({ client: { send } as unknown as S3Client, bucket: "prefix-test" });
    const cause: unknown = await blobs.listKeys("").catch((error: unknown) => error);
    expect(cause).toMatchObject({ code: "invalid_blob_prefix" });
    expect(mapHostError(cause)).toBeUndefined();
    const failure = classifyArtifactFailure(cause, { invocationId: randomUUID(),
      operation: "list", phase: "dispatch", commitState: "not_committed" }, mapHostError);
    expect(failure).toMatchObject({ category: "invalid_request", httpStatus: 400, retriable: false });
    expect(failure.cause).toBe(cause);
    expect(projectArtifactHttpOutcome({ ok: false, failure }))
      .toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(send).not.toHaveBeenCalled();
  });
});

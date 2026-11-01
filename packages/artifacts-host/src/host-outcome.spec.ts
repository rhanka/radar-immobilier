import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ArtifactOperationError, classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { describeFailureCause, mapHostError, reportWriteFailure } from "./host-outcome.js";
import { ArtifactS3TimeoutError } from "./s3-timeout.js";

describe("write failure diagnostics", () => {
  it("names the S3 timeout behind a provider_unavailable publish", () => {
    const mapped = mapHostError(new ArtifactS3TimeoutError("blobs.putBlob"));
    expect(mapped).toBeInstanceOf(ArtifactOperationError);
    const chain = describeFailureCause(mapped);
    expect(chain.at(-1)).toEqual({ name: "ArtifactS3TimeoutError", code: "artifact_s3_timeout",
      operation: "blobs.putBlob" });
  });

  it("keeps the provider HTTP status and error code of an SDK error", () => {
    const sdkError = Object.assign(new Error("Access Denied for key artifacts/x secret=abc"), {
      name: "AccessDenied", Code: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const chain = describeFailureCause(new Error("wrap", { cause: sdkError }));
    expect(chain[1]).toEqual({ name: "AccessDenied", code: "AccessDenied", httpStatus: 403 });
    expect(JSON.stringify(chain)).not.toContain("secret");
  });

  it("reports how many SDK attempts ran before a timeout surfaced", () => {
    const exhausted = Object.assign(new Error("request exceeded 4000 ms"), {
      name: "TimeoutError", code: "ETIMEDOUT", $metadata: { attempts: 3, totalRetryDelay: 312 } });
    expect(describeFailureCause(exhausted)).toEqual([{ name: "TimeoutError", code: "ETIMEDOUT", attempts: 3 }]);
  });

  it("drops messages and unsafe tokens, and stops on cycles", () => {
    const loop: Record<string, unknown> = { name: "Error", code: "has spaces and = values" };
    loop.cause = loop;
    expect(describeFailureCause(loop)).toEqual([{ name: "Error" }]);
    expect(describeFailureCause(undefined)).toEqual([]);
  });

  it("emits one structured line without the failure message", () => {
    const lines: string[] = [];
    reportWriteFailure({ invocationId: "inv-1", operation: "publish", reason: "provider_unavailable", status: 503 },
      { phase: "dispatch", cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"),
        { code: "ECONNREFUSED" }) }, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: "artifacts.write_failure", invocationId: "inv-1",
      operation: "publish", reason: "provider_unavailable", status: 503, phase: "dispatch",
      causes: [{ name: "Error", code: "ECONNREFUSED" }] });
    expect(lines[0]).not.toContain("10.0.0.1");
  });
});

/** Shape of an S3 SDK service error once its retries are spent. */
function sdkError(name: string, httpStatusCode: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${name} for artifacts/x`), {
    name, $fault: httpStatusCode >= 500 ? "server" : "client", $metadata: { httpStatusCode, attempts: 3 }, ...extra });
}
const projection = (cause: unknown) => classifyArtifactFailure(cause, { invocationId: randomUUID(),
  operation: "publish", phase: "dispatch", commitState: "not_committed" }, mapHostError);

describe("provider answers after exhausted SDK retries", () => {
  it.each([
    ["ServiceUnavailable", 503], ["SlowDown", 503], ["InternalError", 500], ["BadGateway", 502],
    ["TooManyRequests", 429], ["RequestTimeout", 400],
  ])("keeps %s (%i) a retriable 503", (name, status) => {
    const cause = sdkError(name, status);
    expect(mapHostError(cause)).toBeInstanceOf(ArtifactOperationError);
    expect(projection(cause)).toMatchObject({ category: "provider_unavailable", httpStatus: 503,
      publicCode: "capability_unavailable", retriable: true });
  });

  it("keeps an answer the SDK marked retryable a retriable 503", () => {
    expect(projection(sdkError("CustomThrottle", 400, { $retryable: { throttling: true } })))
      .toMatchObject({ httpStatus: 503, retriable: true });
  });

  it.each([["AccessDenied", 403], ["NoSuchKey", 404], ["InvalidArgument", 400]])(
    "leaves %s (%i) to the existing projection", (name, status) => {
      const cause = sdkError(name, status);
      expect(mapHostError(cause)).toBeUndefined();
      expect(projection(cause)).toMatchObject({ httpStatus: 500, retriable: false });
    });

  it("ignores a transient-looking name on an error that is not a provider answer", () => {
    expect(mapHostError(Object.assign(new Error("x"), { name: "InternalError" }))).toBeUndefined();
  });
});

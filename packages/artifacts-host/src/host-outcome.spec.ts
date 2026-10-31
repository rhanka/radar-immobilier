import { describe, expect, it } from "vitest";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
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

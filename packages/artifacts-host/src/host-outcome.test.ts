import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
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

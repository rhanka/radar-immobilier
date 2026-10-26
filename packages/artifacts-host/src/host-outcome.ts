import { ArtifactKeyLockConflict, ArtifactOperationError,
  type ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { HttpResponse } from "@sentropic/artifacts/http";
import { isPoolAcquisitionTimeout } from "./idempotency.js";

/** Classify host-owned failures through the provider's HTTP/coordinator mapper. */
export function mapHostError(cause: unknown): ArtifactOperationError | undefined {
  if ((cause as { code?: unknown } | null)?.code === "artifact_s3_timeout" || isPoolAcquisitionTimeout(cause)) {
    return new ArtifactOperationError("provider_unavailable", { cause });
  }
  return undefined;
}

/** Retain host phase diagnostics without reclassifying a provider outcome. */
export function normalizeHostOutcome(outcome: ArtifactOutcome<HttpResponse>): ArtifactOutcome<HttpResponse> {
  if (outcome.ok) return outcome;
  const original = outcome.failure;
  let cause = original.cause;
  let phase = original.phase;
  if (cause instanceof ArtifactKeyLockConflict) phase = "key-lock";
  while ((cause instanceof ArtifactOperationError || cause instanceof ArtifactKeyLockConflict) && cause.cause) {
    cause = cause.cause;
  }
  if ((cause as { code?: unknown } | null)?.code === "artifact_s3_timeout") {
    const reportedPhase = (cause as { phase?: string }).phase;
    if (reportedPhase === "s3-request" || reportedPhase === "body-stream") phase = reportedPhase;
  }
  if (phase === original.phase) return outcome;
  const failure = { ...original, phase };
  Object.defineProperty(failure, "cause", { value: original.cause, enumerable: false });
  return { ok: false, failure: Object.freeze(failure) };
}

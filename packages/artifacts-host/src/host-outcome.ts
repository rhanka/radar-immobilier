import { ArtifactKeyLockConflict, ArtifactOperationError, classifyArtifactFailure,
  type ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { HttpResponse } from "@sentropic/artifacts/http";

/** Host-owned timeout codes use the public mapper; private driver causes stay private. */
export function normalizeHostOutcome(outcome: ArtifactOutcome<HttpResponse>): ArtifactOutcome<HttpResponse> {
  if (outcome.ok) return outcome;
  const original = outcome.failure;
  let cause = original.cause;
  let phase = original.phase;
  if (cause instanceof ArtifactKeyLockConflict) phase = "key-lock";
  while ((cause instanceof ArtifactOperationError || cause instanceof ArtifactKeyLockConflict) && cause.cause) {
    cause = cause.cause;
  }
  const code = (cause as { code?: string } | null)?.code;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const realPoolTimeout = code !== "artifact_pool_timeout" &&
    /timeout exceeded when trying to connect/i.test(message);
  if (realPoolTimeout) {
    cause = Object.assign(new Error("artifact pool acquisition timed out", { cause }),
      { code: "artifact_pool_timeout" });
  }
  const mappedCode = (cause as { code?: string } | null)?.code;
  const mapped = mappedCode === "artifact_s3_timeout" || mappedCode === "artifact_pool_timeout";
  if (code === "artifact_s3_timeout") {
    const reportedPhase = (cause as { phase?: string }).phase;
    if (reportedPhase === "s3-request" || reportedPhase === "body-stream") phase = reportedPhase;
  }
  const failure = mapped ? { ...classifyArtifactFailure(cause, { ...original, phase }, () =>
    new ArtifactOperationError("provider_unavailable", { cause })) } : { ...original, phase };
  Object.defineProperty(failure, "cause", { value: cause, enumerable: false });
  return { ok: false, failure: Object.freeze(failure) };
}

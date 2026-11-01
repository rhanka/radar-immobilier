import { ArtifactKeyLockConflict, ArtifactOperationError,
  type ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { HttpResponse } from "@sentropic/artifacts/http";
import { isPoolAcquisitionTimeout } from "./idempotency.js";

/**
 * Provider answers that the SDK retries (standard mode) and that stay transient
 * once its attempts are spent: throttling, S3 RequestTimeout and server faults.
 */
const TRANSIENT_PROVIDER_NAMES = new Set([
  "RequestTimeout", "RequestTimeoutException", "SlowDown", "Throttling", "ThrottlingException",
  "ThrottledException", "RequestThrottled", "RequestThrottledException", "TooManyRequestsException",
  "RequestLimitExceeded", "BandwidthLimitExceeded", "ProvisionedThroughputExceededException",
  "ServiceUnavailable", "InternalError", "PriorRequestNotComplete",
]);

/** An S3 SDK service error whose retries ran out on a transient answer (5xx, 429, throttling). */
function isTransientProviderAnswer(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const error = cause as { $metadata?: { httpStatusCode?: unknown }; $fault?: unknown; $retryable?: unknown; name?: unknown };
  if (error.$metadata === undefined && error.$fault === undefined) return false;
  const status = error.$metadata?.httpStatusCode;
  if (typeof status === "number" && (status >= 500 || status === 429)) return true;
  if (error.$retryable) return true;
  return typeof error.name === "string" && TRANSIENT_PROVIDER_NAMES.has(error.name);
}

/**
 * Classify host-owned failures through the provider's HTTP/coordinator mapper.
 * Transient provider answers stay a retriable 503 after the SDK retries; other
 * 4xx (403, 404, ...) keep the provider's own projection.
 */
export function mapHostError(cause: unknown): ArtifactOperationError | undefined {
  if ((cause as { code?: unknown } | null)?.code === "artifact_s3_timeout" || isPoolAcquisitionTimeout(cause) ||
    isTransientProviderAnswer(cause)) {
    return new ArtifactOperationError("provider_unavailable", { cause });
  }
  return undefined;
}

/** One redacted link of a failure cause chain: identifiers only, never messages or values. */
export interface FailureCauseSummary {
  readonly name?: string;
  readonly code?: string;
  readonly httpStatus?: number;
  /** SDK attempts behind this error (retries included), when the SDK reports them. */
  readonly attempts?: number;
  readonly operation?: string;
  readonly phase?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_CAUSE_DEPTH = 6;

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

/**
 * Summarize a failure cause chain for operators. Messages are dropped on
 * purpose (they may carry keys, URLs or SQL); only bounded identifier tokens
 * and the provider HTTP status survive.
 */
export function describeFailureCause(cause: unknown): FailureCauseSummary[] {
  const chain: FailureCauseSummary[] = [];
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== null && typeof current === "object" && !seen.has(current) && chain.length < MAX_CAUSE_DEPTH) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const metadata = record.$metadata as { httpStatusCode?: unknown; attempts?: unknown } | undefined;
    const httpStatus = typeof metadata?.httpStatusCode === "number" && Number.isInteger(metadata.httpStatusCode)
      ? metadata.httpStatusCode : undefined;
    const attempts = typeof metadata?.attempts === "number" && Number.isInteger(metadata.attempts)
      ? metadata.attempts : undefined;
    const name = safeToken(record.name);
    const code = safeToken(record.code) ?? safeToken(record.Code);
    const operation = safeToken(record.operation);
    const phase = safeToken(record.phase);
    chain.push({
      ...(name !== undefined ? { name } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(attempts !== undefined ? { attempts } : {}),
      ...(operation !== undefined ? { operation } : {}),
      ...(phase !== undefined ? { phase } : {}),
    });
    current = record.cause;
  }
  return chain;
}

/** Write-failure diagnostic line; the durable host_failures row keeps only the reason. */
export function reportWriteFailure(
  entry: { readonly invocationId: string; readonly operation: string; readonly reason: string; readonly status: number },
  failure: { readonly phase?: unknown; readonly cause?: unknown },
  log: (line: string) => void = (line) => console.error(line),
): void {
  try {
    log(JSON.stringify({ kind: "artifacts.write_failure", invocationId: entry.invocationId,
      operation: entry.operation, reason: entry.reason, status: entry.status,
      phase: safeToken(failure.phase), causes: describeFailureCause(failure.cause) }));
  } catch { /* diagnostics never break dispatch */ }
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

/**
 * Explicit live capacity state for the host API and the pages (A-LIVE v2
 * Amendment 1): when every live slot is taken, or no qualified worker
 * exists, a live/git call answers a typed state instead of leaving the
 * client on an endless spinner.
 *
 * - `queued`: the builder accepted the request into its queue (all live slots
 *   taken); retry with the same idempotencyKey.
 * - `builder_unavailable`: no worker can serve the request now.
 *
 * Idle stop and liveness are owned by the Sentropic controller (liveness
 * lease, 15 minutes idle); immo defines no idle or lifetime constant.
 */
export type LiveCapacityState = "queued" | "builder_unavailable";

export interface LiveCapacityProjection {
  readonly state: LiveCapacityState;
  readonly retryable: true;
  readonly message: string;
  readonly position?: number;
}

interface FailureLike { readonly publicCode?: unknown; readonly details?: unknown }

const QUEUED_REASONS: ReadonlySet<string> = new Set(["queued", "capacity", "slots_full", "worker_capacity"]);

export function liveCapacityState(failure: FailureLike | undefined): LiveCapacityProjection | undefined {
  if (!failure || failure.publicCode !== "builder_unavailable") return undefined;
  const details = failure.details && typeof failure.details === "object" ? failure.details as Record<string, unknown> : {};
  const queued = details.queued === true || QUEUED_REASONS.has(String(details.reason ?? ""));
  const position = Number.isSafeInteger(details.position) && (details.position as number) >= 0 ? details.position as number : undefined;
  return queued
    ? { state: "queued", retryable: true, message: "All live slots are taken; the request is queued. Retry with the same idempotencyKey.",
      ...(position !== undefined ? { position } : {}) }
    : { state: "builder_unavailable", retryable: true, message: "No live worker is available now. Retry later with the same idempotencyKey." };
}

/**
 * Systemic-failure emission for `radar-refresh-pv` (immo side L4).
 *
 * The Sentropic L1 contract (`OpsJobFailureV1`, field `target`) is not
 * published yet, so the emission stays behind the `OpsFailureSink`
 * interface: today a stdout JSON line the k8s watcher can already read,
 * tomorrow the L1 publisher without touching the refresh script. The
 * event keeps the v1 port vocabulary: `systemic-city-failures` when the
 * sweep health verdict fails on the city-failure rate (all attempted
 * documents in transport/quota failure), `succeeded` on a healthy sweep
 * so the platform can clear a previous alert (recovery).
 */
import type { OpsTarget } from "../../config.js";

export type OpsJobFailureKind = "systemic-city-failures" | "succeeded";

export interface OpsJobFailureEvent {
  readonly v: 1;
  readonly event: "ops.job_failure";
  readonly job: "radar-refresh-pv";
  readonly kind: OpsJobFailureKind;
  /** Port-contract target; `unknown` until `OPS_TARGET` is configured. */
  readonly target: OpsTarget | "unknown";
  readonly cycleId: string;
  readonly at: string;
  readonly failed: number;
  readonly attempted: number;
  readonly reason?: string;
}

/** Delivery port; the L1 publisher will implement this interface. */
export interface OpsFailureSink {
  emit(event: OpsJobFailureEvent): Promise<void>;
}

/** Stdout JSON sink used until the L1 contract is published. */
export class StdoutOpsFailureSink implements OpsFailureSink {
  constructor(
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(line);
    },
  ) {}

  async emit(event: OpsJobFailureEvent): Promise<void> {
    this.write(`${JSON.stringify(event)}\n`);
  }
}

/** Instance target from the environment; never guessed from the host. */
export function readOpsTarget(
  env: NodeJS.ProcessEnv = process.env,
): OpsTarget | "unknown" {
  const value = env["OPS_TARGET"];
  return value === "immo-prod" || value === "immo-preprod" ? value : "unknown";
}

export function buildOpsJobFailureEvent(input: {
  readonly kind: OpsJobFailureKind;
  readonly target: OpsTarget | "unknown";
  readonly cycleId: string;
  readonly at: Date;
  readonly failed: number;
  readonly attempted: number;
  readonly reason?: string;
}): OpsJobFailureEvent {
  return {
    v: 1,
    event: "ops.job_failure",
    job: "radar-refresh-pv",
    kind: input.kind,
    target: input.target,
    cycleId: input.cycleId,
    at: input.at.toISOString(),
    failed: input.failed,
    attempted: input.attempted,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

/**
 * Decide the emission for one finished sweep. Only the frozen v1
 * vocabulary is emitted: a systemic city-failure verdict, or `succeeded`
 * for recovery. Other non-zero verdicts (for example an extraction halt)
 * stay unemitted until L1 names them.
 */
export function decideOpsEmission(input: {
  readonly health: { readonly exitCode: 0 | 1; readonly reason?: string };
  readonly counts: {
    readonly published: number;
    readonly failed: number;
  };
  readonly target: OpsTarget | "unknown";
  readonly cycleId: string;
  readonly at: Date;
}): OpsJobFailureEvent | null {
  const attempted = input.counts.published + input.counts.failed;
  if (input.health.exitCode === 1) {
    if (input.health.reason !== "systemic-city-failures") return null;
    return buildOpsJobFailureEvent({
      kind: "systemic-city-failures",
      target: input.target,
      cycleId: input.cycleId,
      at: input.at,
      failed: input.counts.failed,
      attempted,
      reason: input.health.reason,
    });
  }
  return buildOpsJobFailureEvent({
    kind: "succeeded",
    target: input.target,
    cycleId: input.cycleId,
    at: input.at,
    failed: input.counts.failed,
    attempted,
  });
}

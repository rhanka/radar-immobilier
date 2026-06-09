import {
  Job,
  type CiblagePlanT,
  type JobStepStatusT,
  type JobStepT,
  type JobStatusT,
  type JobT,
} from "@radar/domain";

import type { ObjectStore } from "../../storage/object-store.js";
import type { CiblageStore } from "../ciblage/ciblage-store.js";
import { runRecueil } from "../sources/recueil.js";
import { runExploitation } from "../sources/exploitation.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { JobsStore } from "./jobs-store.js";

/**
 * PIPELINE executor (CIBLAGE → RECUEIL → EXPLOITATION). Consumes an *enabled*
 * `CiblagePlan` and, for each (citySlug × sourceBinding) it declares, runs the
 * EXISTING recueil → exploitation path (`runRecueil` then `runExploitation`,
 * reused — not duplicated), stamping the plan id onto every collected
 * RawDocument provenance (`ciblagePlanId`). Produces ONE `Job` record summarising
 * the run, persisted via the injected `JobsStore`.
 *
 * Robustness contract: a single failing source becomes a `failed` JobStep and
 * marks the whole run `partial`; the executor NEVER throws the run away. Recueil
 * is already idempotent (sha256-keyed), so re-running a plan is safe. A binding
 * with no registered adapter yields an honest `skipped` step, never a fabricated
 * one.
 */

export interface RunCiblagePlanInput {
  readonly ciblageStore: CiblageStore;
  readonly jobsStore: JobsStore;
  readonly objectStore: ObjectStore;
  readonly registry: AdapterRegistry;
  readonly planId: string;
  /** Clock injection for deterministic ids / timestamps in tests. */
  readonly now?: () => Date;
  /** Per-source collection cap (defaults to unbounded). */
  readonly limit?: number;
  /** Tag the run as fixture/simulation data (default real). */
  readonly mode?: "real" | "simulation";
  /** Override the generated job id (tests). */
  readonly jobId?: string;
}

export type RunCiblagePlanResult =
  | { readonly ok: true; readonly job: JobT }
  | {
      readonly ok: false;
      readonly error: "plan-not-found" | "plan-disabled" | "no-targets";
      readonly detail: string;
    };

/** Cross product of (citySlug × sourceBinding) the plan declares. */
function planTargets(
  plan: CiblagePlanT,
): ReadonlyArray<{ city: string | undefined; bindingId: string }> {
  // A plan with no cities still runs city-agnostic bindings (city = undefined);
  // the registry resolves the concrete adapter's own city in that case.
  const cities: (string | undefined)[] =
    plan.citySlugs.length > 0 ? [...plan.citySlugs] : [undefined];
  const targets: { city: string | undefined; bindingId: string }[] = [];
  for (const city of cities) {
    for (const bindingId of plan.sourceBindingIds) {
      targets.push({ city, bindingId });
    }
  }
  return targets;
}

function rollupStatus(steps: readonly JobStepT[]): JobStatusT {
  const ran = steps.filter((s) => s.status !== "skipped");
  const failed = ran.filter((s) => s.status === "failed").length;
  const succeeded = ran.filter((s) => s.status === "succeeded").length;
  if (ran.length === 0) return "succeeded"; // nothing to run = vacuously done
  if (failed === 0) return "succeeded";
  if (succeeded === 0) return "failed";
  return "partial";
}

export async function runCiblagePlan(
  input: RunCiblagePlanInput,
): Promise<RunCiblagePlanResult> {
  const now = input.now ?? (() => new Date());
  const plan = await input.ciblageStore.get(input.planId);
  if (!plan) {
    return {
      ok: false,
      error: "plan-not-found",
      detail: `No CiblagePlan with id "${input.planId}"`,
    };
  }
  if (!plan.enabled) {
    return {
      ok: false,
      error: "plan-disabled",
      detail: `CiblagePlan "${plan.id}" is disabled; enable it before running.`,
    };
  }

  const targets = planTargets(plan);
  if (targets.length === 0) {
    return {
      ok: false,
      error: "no-targets",
      detail: `CiblagePlan "${plan.id}" declares no source bindings.`,
    };
  }

  const startedAt = now().toISOString();
  const jobId =
    input.jobId ?? `job-${plan.id}-${now().getTime().toString(36)}`;

  // De-dup concrete (sourceId × city) so the same adapter+city isn't run twice
  // when a plan selects both an abstract binding and its concrete child.
  const seen = new Set<string>();
  const steps: JobStepT[] = [];

  for (const target of targets) {
    const entry = input.registry.resolve(target.bindingId, target.city);
    if (!entry) {
      steps.push({
        sourceId: target.bindingId,
        city: target.city ?? "·",
        status: "skipped",
        rawDocIds: [],
        skippedReason: target.city
          ? `No adapter for binding "${target.bindingId}" in city "${target.city}"`
          : `No adapter registered for binding "${target.bindingId}"`,
      });
      continue;
    }

    const dedupKey = `${entry.sourceId}::${entry.city}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const step = await runOneSource({
      objectStore: input.objectStore,
      registryEntry: entry,
      bindingId: target.bindingId,
      planId: plan.id,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    steps.push(step);
  }

  const status = rollupStatus(steps);
  const totals = {
    sources: steps.length,
    succeeded: steps.filter((s) => s.status === "succeeded").length,
    failed: steps.filter((s) => s.status === "failed").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
    rawDocs: steps.reduce((n, s) => n + s.rawDocIds.length, 0),
    mentions: steps.reduce((n, s) => n + (s.mentionCount ?? 0), 0),
  };

  const job: JobT = Job.parse({
    id: jobId,
    planId: plan.id,
    planLabel: plan.label,
    status,
    mode: input.mode ?? "real",
    startedAt,
    finishedAt: now().toISOString(),
    steps,
    totals,
  });

  const saved = await input.jobsStore.save(job);
  return { ok: true, job: saved };
}

interface RunOneSourceInput {
  readonly objectStore: ObjectStore;
  readonly registryEntry: { sourceId: string; city: string; build: () => import("@radar/sources").SourceAdapter };
  readonly bindingId: string;
  readonly planId: string;
  readonly limit?: number;
}

/**
 * Run the recueil → exploitation path for ONE concrete source, returning a
 * `JobStep`. Reuses `runRecueil` (which already accepts `ciblagePlanId`) and
 * `runExploitation`; on a typed recueil failure the step is `failed` and carries
 * the error kind. Never throws.
 */
async function runOneSource(input: RunOneSourceInput): Promise<JobStepT> {
  const { sourceId, city } = input.registryEntry;
  const base = (status: JobStepStatusT): JobStepT => ({
    sourceId,
    city,
    status,
    rawDocIds: [],
  });

  try {
    const recueil = await runRecueil(
      sourceId,
      input.registryEntry.build(),
      input.objectStore,
      {
        ciblagePlanId: input.planId,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      },
    );

    if (!recueil.ok) {
      return {
        ...base("failed"),
        error: recueil.error,
      };
    }

    const exploit = await runExploitation({
      store: input.objectStore,
      citySlug: city,
      rawDocRecords: recueil.records,
    });

    return {
      sourceId,
      city,
      status: "succeeded",
      rawDocIds: [...recueil.rawDocIds],
      mentionCount: exploit.mentionCount,
      candidateCount: exploit.candidateCount,
      canonicalCount: exploit.canonicalCount,
    };
  } catch (e) {
    // Exploitation / storage failures are recorded, never thrown away.
    return {
      ...base("failed"),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

import {
  Job,
  type CiblagePlanT,
  type JobStepStatusT,
  type JobStepT,
  type JobStatusT,
  type JobT,
} from "@radar/domain";

import type { RawDocumentRecord } from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import type { CiblageStore } from "../ciblage/ciblage-store.js";
import { runRecueil } from "../sources/recueil.js";
import { runExploitation } from "../sources/exploitation.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { JobsStore } from "./jobs-store.js";

/**
 * PIPELINE executor (CIBLAGE → RECUEIL → EXPLOITATION). Consumes an *enabled*
 * `CiblagePlan` and, for each (citySlug × sourceBinding) it declares, runs the
 * EXISTING recueil path (`runRecueil`, reused — not duplicated), stamping the
 * plan id onto every collected RawDocument provenance (`ciblagePlanId`). Once a
 * city's sources are all collected, it runs a SINGLE `runExploitation` over the
 * city's COMBINED corpus so the per-city ontology project state ACCUMULATES every
 * source (mirroring `seed-ontology`), rather than being overwritten per source.
 * Produces ONE `Job` record summarising the run, persisted via the injected
 * `JobsStore`.
 *
 * Robustness contract: a single failing source becomes a `failed` JobStep and
 * marks the whole run `partial`; the executor NEVER throws the run away. Recueil
 * is already idempotent (sha256-keyed), so re-running a plan is safe. A binding
 * with no registered adapter yields an honest `skipped` step, never a fabricated
 * one. The per-city exploitation runs over whatever sources DID collect, so one
 * failing source never starves the others' accumulated state.
 */

export interface RunCiblagePlanInput {
  readonly ciblageStore: CiblageStore;
  readonly jobsStore: JobsStore;
  readonly objectStore: ObjectStore;
  /**
   * Optional dedicated store for raw scraped documents (RECUEIL output).
   * When provided, raw bytes are written to / read from this store (e.g. the
   * SCW `radar-immobilier-docs` bucket in production); the main `objectStore`
   * is still used for project-state, ciblage plans, and jobs. When absent,
   * `objectStore` handles everything (local-dev / MinIO default).
   */
  readonly scrapeStore?: ObjectStore;
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
  // Per-city accumulator: every successfully-collected source's RawDocs, kept
  // together so a SINGLE exploitation runs over the city's COMBINED corpus.
  const cityCorpus = new Map<
    string,
    { records: RawDocumentRecord[]; stepIdx: number[] }
  >();

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

    // RECUEIL only — exploitation is deferred to a per-city pass below so all of
    // a city's sources accumulate into ONE project state instead of overwriting.
    // When a dedicated scrapeStore is provided, raw bytes go there; otherwise the
    // main objectStore handles everything (MinIO local default).
    const { step, records } = await collectOneSource({
      objectStore: input.scrapeStore ?? input.objectStore,
      registryEntry: entry,
      planId: plan.id,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    });
    const stepIdx = steps.length;
    steps.push(step);

    if (step.status === "succeeded" && records.length > 0) {
      const bucket = cityCorpus.get(entry.city) ?? { records: [], stepIdx: [] };
      bucket.records.push(...records);
      bucket.stepIdx.push(stepIdx);
      cityCorpus.set(entry.city, bucket);
    }
  }

  // EXPLOITATION — ONE pass per city over its COMBINED corpus (mirrors
  // seed-ontology). The accumulated project state reflects EVERY source that
  // collected, which is also what unblocks cross-source `entity_match`: graphify
  // now sees ≥2 sources together, so a shared identifier can become a candidate.
  for (const [city, bucket] of cityCorpus) {
    try {
      const exploit = await runExploitation({
        store: input.objectStore,
        // When a dedicated scrape store is provided, raw bytes are read from
        // there; project-state is always written to the main objectStore.
        ...(input.scrapeStore ? { rawStore: input.scrapeStore } : {}),
        citySlug: city,
        rawDocRecords: bucket.records,
        ...(input.now ? { now: input.now } : {}),
      });
      // Stamp the per-city accumulated totals onto each succeeded step of the
      // city so the console surfaces real mention / candidate / canonical counts.
      for (const idx of bucket.stepIdx) {
        const s = steps[idx]!;
        steps[idx] = {
          ...s,
          mentionCount: exploit.mentionCount,
          candidateCount: exploit.candidateCount,
          canonicalCount: exploit.canonicalCount,
        };
      }
    } catch (e) {
      // An exploitation failure does not erase the recueil work: the city's
      // succeeded recueil steps become `failed` with the typed reason, never
      // throwing the whole run away.
      const message = e instanceof Error ? e.message : String(e);
      for (const idx of bucket.stepIdx) {
        const s = steps[idx]!;
        steps[idx] = { ...s, status: "failed", error: message };
      }
    }
  }

  const status = rollupStatus(steps);
  const totals = {
    sources: steps.length,
    succeeded: steps.filter((s) => s.status === "succeeded").length,
    failed: steps.filter((s) => s.status === "failed").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
    rawDocs: steps.reduce((n, s) => n + s.rawDocIds.length, 0),
    // City-level mention totals are identical across a city's sibling steps
    // (they share one exploitation), so sum DISTINCT cities, not steps.
    mentions: cityMentionTotal(steps),
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

/**
 * Sum each city's mention count ONCE. Sibling steps of a city share a single
 * per-city exploitation, so their `mentionCount` is the same accumulated value;
 * summing per step would double-count. We take the first succeeded step per city.
 */
function cityMentionTotal(steps: readonly JobStepT[]): number {
  const perCity = new Map<string, number>();
  for (const s of steps) {
    if (s.status !== "succeeded" || s.mentionCount === undefined) continue;
    if (!perCity.has(s.city)) perCity.set(s.city, s.mentionCount);
  }
  let total = 0;
  for (const v of perCity.values()) total += v;
  return total;
}

interface CollectOneSourceInput {
  readonly objectStore: ObjectStore;
  readonly registryEntry: { sourceId: string; city: string; build: () => import("@radar/sources").SourceAdapter };
  readonly planId: string;
  readonly limit?: number;
}

interface CollectOneSourceOutput {
  readonly step: JobStepT;
  readonly records: readonly RawDocumentRecord[];
}

/**
 * Run the RECUEIL stage for ONE concrete source, returning a `JobStep` plus the
 * collected `RawDocumentRecord`s (so the caller can accumulate them into the
 * city's combined corpus for a single exploitation). Reuses `runRecueil` (which
 * already accepts `ciblagePlanId`); on a typed recueil failure the step is
 * `failed` and carries the error kind. Never throws.
 */
async function collectOneSource(
  input: CollectOneSourceInput,
): Promise<CollectOneSourceOutput> {
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
      return { step: { ...base("failed"), error: recueil.error }, records: [] };
    }

    return {
      step: {
        sourceId,
        city,
        status: "succeeded",
        rawDocIds: [...recueil.rawDocIds],
      },
      records: recueil.records,
    };
  } catch (e) {
    // Storage / unexpected failures are recorded, never thrown away.
    return {
      step: {
        ...base("failed"),
        error: e instanceof Error ? e.message : String(e),
      },
      records: [],
    };
  }
}

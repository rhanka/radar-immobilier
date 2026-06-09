import { z } from "zod";

/**
 * JOB — the execution record of a pipeline run (CIBLAGE → RECUEIL → EXPLOITATION).
 *
 * A `Job` is produced when an enabled `CiblagePlan` is *run*: for each
 * (citySlug × sourceBinding) pair declared by the plan, the executor runs the
 * existing recueil → exploitation path and records one `JobStep`. The plan is a
 * pure declaration; the Job is the side-effecting counterpart that actually
 * collected raw documents (stamped with `ciblagePlanId`) and refreshed the
 * per-city ontology project state.
 *
 * This is the model the T4 jobs console renders (status chips, per-step source /
 * city / counts) and the read-model the `GET /api/jobs` route serves.
 */

/** Whole-run status. `partial` = at least one step failed but others succeeded. */
export const JobStatus = z.enum([
  "running",
  "succeeded",
  "failed",
  "partial",
]);
export type JobStatusT = z.infer<typeof JobStatus>;

/** Per-step status (one (source × city) collect+exploit attempt). */
export const JobStepStatus = z.enum(["succeeded", "failed", "skipped"]);
export type JobStepStatusT = z.infer<typeof JobStepStatus>;

/**
 * One executed (source × city) pair. `rawDocId`s and the exploitation counts are
 * REAL outputs of the recueil → exploitation path; a failed source carries a
 * typed `error` (`SourceErrorKind`) and never fabricates counts.
 */
export const JobStep = z.object({
  /** Real source-binding id from the prioritySources catalogue. */
  sourceId: z.string().min(1),
  /** City slug the step ran for (per-city graphify project). */
  city: z.string().min(1),
  status: JobStepStatus,
  /** Raw documents collected by RECUEIL (sha256-keyed, idempotent). */
  rawDocIds: z.array(z.string()).default([]),
  /** Modeled-entity mentions produced by EXPLOITATION (real, never invented). */
  mentionCount: z.number().int().nonnegative().optional(),
  /** Reconciliation candidate / canonical counts from EXPLOITATION. */
  candidateCount: z.number().int().nonnegative().optional(),
  canonicalCount: z.number().int().nonnegative().optional(),
  /** Typed failure reason (mirrors `SourceErrorKind`) when status = failed. */
  error: z.string().optional(),
  /** Why a step was skipped (e.g. no adapter registered for the binding). */
  skippedReason: z.string().optional(),
});
export type JobStepT = z.infer<typeof JobStep>;

/** Run-level rollup counts (sum across steps). */
export const JobTotals = z.object({
  sources: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  rawDocs: z.number().int().nonnegative(),
  mentions: z.number().int().nonnegative(),
});
export type JobTotalsT = z.infer<typeof JobTotals>;

/** The full persisted job record. */
export const Job = z.object({
  /** Stable job id (assigned by the executor). */
  id: z.string().min(1),
  /** The CiblagePlan this run consumed (`CiblagePlan.id`). */
  planId: z.string().min(1),
  /** Plan label snapshotted at run time (so the console reads without a join). */
  planLabel: z.string().default(""),
  status: JobStatus,
  /** Whether the run collected REAL public data or fixture/simulation data. */
  mode: z.enum(["real", "simulation"]).default("real"),
  startedAt: z.string().min(4),
  finishedAt: z.string().min(4).optional(),
  steps: z.array(JobStep).default([]),
  totals: JobTotals,
});
export type JobT = z.infer<typeof Job>;

/**
 * PIPELINE JOBS — real API client + view model for the T4 jobs console.
 *
 * Mirrors the `Job` records the API serves at `GET /api/jobs` (produced by the
 * pipeline executor when a CiblagePlan is run via `POST /api/ciblage/:id/run`).
 * Pure mapping helpers keep the Svelte tab declarative. No fabricated data: a
 * source that yielded nothing arrives as an honest zero-count / skipped step.
 */

export type PipelineJobStatus = "running" | "succeeded" | "failed" | "partial";
export type PipelineStepStatus = "succeeded" | "failed" | "skipped";
export type PipelineMode = "real" | "simulation";

/** One executed (source × city) step (mirror of the domain `JobStep`). */
export interface PipelineJobStep {
  sourceId: string;
  city: string;
  status: PipelineStepStatus;
  rawDocIds: string[];
  mentionCount?: number;
  candidateCount?: number;
  canonicalCount?: number;
  error?: string;
  skippedReason?: string;
}

/** Run-level rollup counts. */
export interface PipelineJobTotals {
  sources: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rawDocs: number;
  mentions: number;
}

/** A pipeline-run job (mirror of the domain `Job`). */
export interface PipelineJob {
  id: string;
  planId: string;
  planLabel: string;
  status: PipelineJobStatus;
  mode: PipelineMode;
  startedAt: string;
  finishedAt?: string;
  steps: PipelineJobStep[];
  totals: PipelineJobTotals;
}

function apiBase(baseUrl: string | undefined): string {
  return baseUrl ? baseUrl.replace(/\/$/, "") : "";
}

export type FetchJobsResult =
  | { kind: "ok"; jobs: PipelineJob[] }
  | { kind: "error"; detail: string };

/** Fetch all pipeline-run jobs (newest first). Never throws. */
export async function fetchPipelineJobs(
  fetchImpl: typeof fetch = fetch,
  baseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL,
): Promise<FetchJobsResult> {
  const base = apiBase(baseUrl);
  try {
    const res = await fetchImpl(`${base}/api/jobs`);
    if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { ok: boolean; jobs: PipelineJob[] };
    return { kind: "ok", jobs: body.jobs ?? [] };
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
  }
}

/** Filter jobs to the active app mode (real mode hides simulation runs). */
export function filterPipelineJobsByMode(
  jobs: readonly PipelineJob[],
  mode: PipelineMode,
): PipelineJob[] {
  if (mode === "real") return jobs.filter((j) => j.mode !== "simulation");
  return [...jobs];
}

/** Count jobs by run status (for the status chips). */
export function pipelineStatusCounts(
  jobs: readonly PipelineJob[],
): Record<PipelineJobStatus, number> {
  const counts: Record<PipelineJobStatus, number> = {
    running: 0,
    succeeded: 0,
    failed: 0,
    partial: 0,
  };
  for (const j of jobs) counts[j.status] += 1;
  return counts;
}

/** French label for a run status. */
export function jobStatusLabel(status: PipelineJobStatus): string {
  switch (status) {
    case "running":
      return "En cours";
    case "succeeded":
      return "Réussi";
    case "failed":
      return "Échoué";
    case "partial":
      return "Partiel";
    default:
      return status;
  }
}

/** French label for a step status. */
export function stepStatusLabel(status: PipelineStepStatus): string {
  switch (status) {
    case "succeeded":
      return "Réussi";
    case "failed":
      return "Échoué";
    case "skipped":
      return "Ignoré";
    default:
      return status;
  }
}

/** Format an optional duration between start/finish ISO timestamps. */
export function jobDuration(job: PipelineJob): string {
  if (!job.finishedAt) return "En cours";
  const ms = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "·";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

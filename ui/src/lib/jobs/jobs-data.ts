export type JobType = "ingestion" | "scan" | "scoring" | "backfill";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  sourceRef: string;
  startedAt: string;
  durationMs?: number;
  mode: "real" | "simulation";
}

export const demoJobs: Job[] = [
  {
    id: "job-001",
    type: "ingestion",
    status: "done",
    sourceRef: "avis-publics-valleyfield",
    startedAt: "2025-05-26T08:00:00.000Z",
    durationMs: 3210,
    mode: "real",
  },
  {
    id: "job-002",
    type: "scan",
    status: "done",
    sourceRef: "ppcmoi-valleyfield",
    startedAt: "2025-05-26T08:05:00.000Z",
    durationMs: 1840,
    mode: "real",
  },
  {
    id: "job-003",
    type: "scoring",
    status: "running",
    sourceRef: "roles-evaluation-fonciere-mamh",
    startedAt: "2025-05-26T08:10:00.000Z",
    mode: "real",
  },
  {
    id: "job-004",
    type: "backfill",
    status: "failed",
    sourceRef: "rôle-70052",
    startedAt: "2025-05-26T07:30:00.000Z",
    durationMs: 512,
    mode: "real",
  },
  {
    id: "job-005",
    type: "ingestion",
    status: "queued",
    sourceRef: "cptaq-decisions",
    startedAt: "2025-05-26T08:15:00.000Z",
    mode: "real",
  },
  {
    id: "job-008",
    type: "ingestion",
    status: "done",
    sourceRef: "reglements-urbanisme-valleyfield",
    startedAt: "2025-05-26T06:00:00.000Z",
    durationMs: 4120,
    mode: "real",
  },
  {
    id: "job-009",
    type: "backfill",
    status: "queued",
    sourceRef: "rôle-70052",
    startedAt: "2025-05-26T08:20:00.000Z",
    mode: "real",
  },
  {
    id: "job-010",
    type: "scan",
    status: "failed",
    sourceRef: "seances-conseil-valleyfield",
    startedAt: "2025-05-26T07:00:00.000Z",
    durationMs: 230,
    mode: "real",
  },
];

export function countsByStatus(jobs: Job[] = demoJobs): Record<JobStatus, number> {
  const counts: Record<JobStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
  };
  for (const job of jobs) {
    counts[job.status] += 1;
  }
  return counts;
}

export function filterJobsByMode(jobs: Job[], mode: "real" | "simulation"): Job[] {
  // Real mode hides simulation jobs (same boundary as @radar/scoring filterRealMode,
  // inlined here because Job is a concrete type, not the open MaybeSimulated shape).
  if (mode === "real") {
    return jobs.filter((j) => j.mode !== "simulation");
  }
  return [...jobs];
}

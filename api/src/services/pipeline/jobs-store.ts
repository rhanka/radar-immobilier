import { Job, type JobT } from "@radar/domain";

import type { ObjectStore } from "../../storage/object-store.js";

/**
 * JOBS persistence (pipeline execution records). Mirrors the CIBLAGE store: each
 * job is written both as its own document (`jobs/<id>.json`) AND appended to a
 * single index document (`jobs/index.json`) so the `GET /api/jobs` list is one
 * round-trip and `GET /api/jobs/:id` reads the per-job doc directly. The
 * `ObjectStore` boundary exposes no listing primitive, so the index is the
 * authoritative ordered set; the per-job docs are convenience point-reads.
 *
 * Persistence choice rationale: same S3/MinIO substrate the rest of the pipeline
 * already uses (ciblage index, ontology project-state), no Drizzle migration, and
 * jobs are append-mostly at demo scale. This is the seam to swap for a table if
 * the job history ever grows large.
 */

/** Canonical S3 key holding the full ordered array of jobs (newest last). */
export const JOBS_INDEX_KEY = "jobs/index.json";

/** Per-job document key. */
export function jobKey(id: string): string {
  return `jobs/${id}.json`;
}

function serialize(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
}

function parseIndex(bytes: Uint8Array): JobT[] {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: JobT[] = [];
  for (const entry of raw) {
    const parsed = Job.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export interface JobsStore {
  /** All jobs, newest first. */
  list(): Promise<JobT[]>;
  get(id: string): Promise<JobT | undefined>;
  /** Insert or replace a job (used to persist the final/updated record). */
  save(job: JobT): Promise<JobT>;
}

export function createJobsStore(store: ObjectStore): JobsStore {
  async function readIndex(): Promise<JobT[]> {
    const head = await store.head(JOBS_INDEX_KEY);
    if (!head) return [];
    return parseIndex(await store.get(JOBS_INDEX_KEY));
  }

  async function writeIndex(jobs: readonly JobT[]): Promise<void> {
    await store.put(JOBS_INDEX_KEY, serialize(jobs), "application/json");
  }

  return {
    async list() {
      const jobs = await readIndex();
      // Index is stored oldest-first; expose newest-first for the console.
      return [...jobs].reverse();
    },

    async get(id) {
      // Prefer the per-job doc; fall back to the index for robustness.
      const head = await store.head(jobKey(id));
      if (head) {
        const parsed = Job.safeParse(
          JSON.parse(new TextDecoder().decode(await store.get(jobKey(id)))),
        );
        if (parsed.success) return parsed.data;
      }
      const all = await readIndex();
      return all.find((j) => j.id === id);
    },

    async save(job) {
      const valid = Job.parse(job);
      await store.put(jobKey(valid.id), serialize(valid), "application/json");
      const all = await readIndex();
      const idx = all.findIndex((j) => j.id === valid.id);
      const next = [...all];
      if (idx === -1) next.push(valid);
      else next[idx] = valid;
      await writeIndex(next);
      return valid;
    },
  };
}

import { describe, expect, it } from "vitest";
import type { JobT } from "@radar/domain";

import { jobsRoute } from "./jobs.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import { createJobsStore } from "../services/pipeline/jobs-store.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

function makeJob(id: string, status: JobT["status"]): JobT {
  return {
    id,
    planId: "veille-valleyfield",
    planLabel: "Veille Valleyfield",
    status,
    mode: "real",
    startedAt: "2026-06-08T08:00:00.000Z",
    finishedAt: "2026-06-08T08:00:03.000Z",
    steps: [
      {
        sourceId: "role-evaluation-mamh-70052",
        city: "salaberry-de-valleyfield",
        status: "succeeded",
        rawDocIds: ["raw-1"],
        mentionCount: 3,
      },
    ],
    totals: {
      sources: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      rawDocs: 1,
      mentions: 3,
    },
  };
}

describe("GET /api/jobs", () => {
  it("lists persisted jobs newest first", async () => {
    const store = new MemoryStore();
    const jobs = createJobsStore(store);
    await jobs.save(makeJob("job-1", "succeeded"));
    await jobs.save(makeJob("job-2", "partial"));

    const res = await jobsRoute({ store }).request("/api/jobs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobs: JobT[] };
    expect(body.ok).toBe(true);
    expect(body.jobs.map((j) => j.id)).toEqual(["job-2", "job-1"]);
  });

  it("returns one job by id, 404 when absent", async () => {
    const store = new MemoryStore();
    const jobs = createJobsStore(store);
    await jobs.save(makeJob("job-x", "succeeded"));

    const ok = await jobsRoute({ store }).request("/api/jobs/job-x");
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { job: JobT };
    expect(okBody.job.id).toBe("job-x");

    const missing = await jobsRoute({ store }).request("/api/jobs/nope");
    expect(missing.status).toBe(404);
  });
});

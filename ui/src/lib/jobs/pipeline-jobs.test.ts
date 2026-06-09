import { describe, expect, it, vi } from "vitest";

import {
  fetchPipelineJobs,
  filterPipelineJobsByMode,
  pipelineStatusCounts,
  jobStatusLabel,
  stepStatusLabel,
  jobDuration,
  type PipelineJob,
} from "./pipeline-jobs.js";

function job(
  id: string,
  status: PipelineJob["status"],
  mode: PipelineJob["mode"] = "real",
): PipelineJob {
  return {
    id,
    planId: "p",
    planLabel: "P",
    status,
    mode,
    startedAt: "2026-06-09T00:00:00.000Z",
    finishedAt: "2026-06-09T00:00:02.500Z",
    steps: [
      {
        sourceId: "role-evaluation-mamh-70052",
        city: "salaberry-de-valleyfield",
        status: "succeeded",
        rawDocIds: ["r1"],
        mentionCount: 3,
      },
    ],
    totals: { sources: 1, succeeded: 1, failed: 0, skipped: 0, rawDocs: 1, mentions: 3 },
  };
}

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("fetchPipelineJobs", () => {
  it("returns the jobs array on a 200", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes({ ok: true, jobs: [job("a", "succeeded")] }),
    );
    const res = await fetchPipelineJobs(fetchImpl as unknown as typeof fetch, "");
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith("/api/jobs");
  });

  it("returns an error on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => jsonRes({}, 500));
    const res = await fetchPipelineJobs(fetchImpl as unknown as typeof fetch, "");
    expect(res.kind).toBe("error");
  });

  it("returns an error when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const res = await fetchPipelineJobs(fetchImpl as unknown as typeof fetch, "");
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.detail).toContain("offline");
  });
});

describe("view helpers", () => {
  it("real mode hides simulation jobs", () => {
    const jobs = [job("a", "succeeded", "real"), job("b", "partial", "simulation")];
    expect(filterPipelineJobsByMode(jobs, "real").map((j) => j.id)).toEqual(["a"]);
    expect(filterPipelineJobsByMode(jobs, "simulation")).toHaveLength(2);
  });

  it("counts jobs by status", () => {
    const counts = pipelineStatusCounts([
      job("a", "succeeded"),
      job("b", "partial"),
      job("c", "failed"),
      job("d", "succeeded"),
    ]);
    expect(counts.succeeded).toBe(2);
    expect(counts.partial).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.running).toBe(0);
  });

  it("labels statuses in French", () => {
    expect(jobStatusLabel("partial")).toBe("Partiel");
    expect(stepStatusLabel("skipped")).toBe("Ignoré");
  });

  it("formats run duration from start/finish", () => {
    expect(jobDuration(job("a", "succeeded"))).toBe("2.5 s");
    const running = { ...job("b", "running"), finishedAt: undefined };
    expect(jobDuration(running)).toBe("En cours");
  });
});

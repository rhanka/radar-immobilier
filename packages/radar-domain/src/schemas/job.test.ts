import { describe, expect, it } from "vitest";

import { Job, JobStep } from "./job.js";

describe("Job schema", () => {
  it("parses a succeeded run with real step counts", () => {
    const parsed = Job.parse({
      id: "job-abc",
      planId: "veille-valleyfield",
      planLabel: "Veille Valleyfield",
      status: "succeeded",
      startedAt: "2026-06-08T08:00:00.000Z",
      finishedAt: "2026-06-08T08:00:03.000Z",
      steps: [
        {
          sourceId: "avis-publics-valleyfield",
          city: "salaberry-de-valleyfield",
          status: "succeeded",
          rawDocIds: ["raw-1"],
          mentionCount: 4,
          candidateCount: 2,
          canonicalCount: 2,
        },
      ],
      totals: {
        sources: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        rawDocs: 1,
        mentions: 4,
      },
    });
    expect(parsed.status).toBe("succeeded");
    expect(parsed.mode).toBe("real"); // defaulted
    expect(parsed.steps[0]?.rawDocIds).toEqual(["raw-1"]);
  });

  it("defaults rawDocIds to an empty array on a failed step", () => {
    const step = JobStep.parse({
      sourceId: "role-evaluation-mamh-70052",
      city: "salaberry-de-valleyfield",
      status: "failed",
      error: "network",
    });
    expect(step.rawDocIds).toEqual([]);
    expect(step.mentionCount).toBeUndefined();
  });

  it("rejects an unknown status", () => {
    expect(() =>
      Job.parse({
        id: "x",
        planId: "p",
        status: "bogus",
        startedAt: "2026-06-08T08:00:00.000Z",
        totals: {
          sources: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          rawDocs: 0,
          mentions: 0,
        },
      }),
    ).toThrow();
  });
});

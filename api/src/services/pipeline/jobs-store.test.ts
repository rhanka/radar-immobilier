import { describe, expect, it } from "vitest";
import type { JobT } from "@radar/domain";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { createJobsStore, jobKey, JOBS_INDEX_KEY } from "./jobs-store.js";

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

function job(id: string, status: JobT["status"] = "succeeded"): JobT {
  return {
    id,
    planId: "p",
    planLabel: "P",
    status,
    mode: "real",
    startedAt: "2026-06-08T08:00:00.000Z",
    steps: [],
    totals: {
      sources: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      rawDocs: 0,
      mentions: 0,
    },
  };
}

describe("jobs-store", () => {
  it("persists a per-job doc + an index entry, listing newest first", async () => {
    const store = new MemoryStore();
    const jobs = createJobsStore(store);
    await jobs.save(job("a"));
    await jobs.save(job("b"));

    expect(store.objects.has(jobKey("a"))).toBe(true);
    expect(store.objects.has(JOBS_INDEX_KEY)).toBe(true);

    const listed = await jobs.list();
    expect(listed.map((j) => j.id)).toEqual(["b", "a"]);
  });

  it("get reads the per-job doc", async () => {
    const store = new MemoryStore();
    const jobs = createJobsStore(store);
    await jobs.save(job("only"));
    expect((await jobs.get("only"))?.id).toBe("only");
    expect(await jobs.get("missing")).toBeUndefined();
  });

  it("save replaces an existing job in the index (idempotent re-run)", async () => {
    const store = new MemoryStore();
    const jobs = createJobsStore(store);
    await jobs.save(job("x", "running"));
    await jobs.save(job("x", "succeeded"));
    const listed = await jobs.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("succeeded");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { RunPvRefreshOptions } from "./refresh-run.js";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";
import { refreshClassifyConfig } from "./refresh-classify-config.js";
import { classifyPublishedRefresh } from "./refresh-classify.js";
import { createRefreshModelPolicy } from "./refresh-model-policy.js";
import { openRefreshState } from "./refresh-state.js";

const repository = vi.hoisted(() => ({ list: vi.fn(), annotation: vi.fn(), write: vi.fn() }));
vi.mock("./reannotate-repository.js", () => ({ createReannotationRepository: () => repository }));

describe("post-publication classification isolation", () => {
  it.each(["selection", "evidence", "cancellation"])("should count %s failure without rejecting", async (failure) => {
    vi.clearAllMocks();
    const store = new FakeGraphStore();
    const objectStore = store as unknown as RunPvRefreshOptions["store"];
    const handle = await openRefreshState(objectStore, { citySlug: "city", inputHash: "input", baselineHash: "baseline",
      profileHash: "profile", registryHash: "registry", packageVersion: "0.18.0", modelPolicy: "B", exclusions: [] }, 100);
    const onNote = vi.fn();
    const controller = new AbortController();
    if (failure === "cancellation") controller.abort();
    repository.list.mockImplementation(async () => {
      if (failure === "selection") throw new Error("private SQL detail");
      return [{ citySlug: "city", id: "act", type: "Signal", label: "Act", props: {}, sourceRef: null }];
    });
    const config = refreshClassifyConfig({});
    const models = createRefreshModelPolicy({ ...config, timeoutMs: 1000, primaryQualityAttempts: 1,
      forceFallback: false, createClient: () => { throw new Error("Unexpected model call"); } });
    const classification = { ...config, models, prompt: { id: "v2", sha256: "a".repeat(64), text: "v2" } };
    const writes = [...store.puts];
    await expect(classifyPublishedRefresh({ classification,
      db: {} as RunPvRefreshOptions["db"], store: objectStore,
      handle: failure === "evidence" ? { ...handle, state: { ...handle.state,
        completedChunks: { missing: { key: "missing-chunk", hash: "sha256:absent" } } } } : handle,
      citySlug: "city", pipelineRunId: "run", now: new Date("2026-11-13T17:00:00Z"),
      signal: controller.signal, onNote })).resolves.toBeUndefined();
    expect(onNote).toHaveBeenCalledWith("classification-failed", { failed: 1, pipelineRunId: "run" });
    expect(store.puts).toEqual(writes);
    expect(repository.write).not.toHaveBeenCalled();
    expect(JSON.stringify(onNote.mock.calls)).not.toContain("private SQL detail");
  });
});

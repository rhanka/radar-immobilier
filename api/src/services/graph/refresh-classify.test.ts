import { describe, expect, it, vi } from "vitest";
import type { RunPvRefreshOptions } from "./refresh-run.js";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";
import { refreshClassifyConfig } from "./refresh-classify-config.js";
import { classifyPublishedRefresh, retryUnclassifiedRefreshSignals } from "./refresh-classify.js";
import { createRefreshModelPolicy } from "./refresh-model-policy.js";
import { openRefreshState } from "./refresh-state.js";
import { canonicalHash } from "./replay/canonical-json.js";

const repository = vi.hoisted(() => ({ list: vi.fn(), annotation: vi.fn(), write: vi.fn() }));
const retryRepository = vi.hoisted(() => ({ list: vi.fn(), annotation: vi.fn(), write: vi.fn() }));
const retryScope = vi.hoisted(() => vi.fn());
vi.mock("./reannotate-repository.js", () => ({
  createReannotationRepository: () => repository,
  createUnclassifiedCityRepository: (_db: unknown, scope: unknown) => {
    retryScope(scope);
    return retryRepository;
  },
}));

describe("post-publication classification isolation", () => {
  it.each(["selection", "evidence", "cancellation"])("should count %s failure without rejecting", async (failure) => {
    vi.clearAllMocks();
    const store = new FakeGraphStore();
    const objectStore = store as unknown as RunPvRefreshOptions["store"];
    const baseline = { nodes: [] };
    const handle = await openRefreshState(objectStore, { citySlug: "city", inputHash: "input", baselineHash: canonicalHash(baseline),
      profileHash: "profile", registryHash: "registry", packageVersion: "0.18.0", modelPolicy: "B", exclusions: [] }, 100);
    store.seed(`graphify-34-backups/refresh-018-${handle.state.identityHash.slice(7)}/graph/city/latest.json`, JSON.stringify(baseline));
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
      db: {} as RunPvRefreshOptions["db"], store: objectStore, snapshot: { nodes: [], edges: [] },
      handle: failure === "evidence" ? { ...handle, state: { ...handle.state,
        completedChunks: { missing: { key: "missing-chunk", hash: "sha256:absent" } } } } : handle,
      citySlug: "city", pipelineRunId: "run", now: new Date("2026-11-13T17:00:00Z"),
      signal: controller.signal, onNote })).resolves.toBeUndefined();
    expect(onNote).toHaveBeenCalledWith("classification-failed", { failed: 1, pipelineRunId: "run" });
    expect(store.puts).toEqual(writes);
    expect(repository.write).not.toHaveBeenCalled();
    expect(JSON.stringify(onNote.mock.calls)).not.toContain("private SQL detail");
  });

  it("should isolate retry failures, respect retryLimit=0, and use configured fallback on primary failure", async () => {
    vi.clearAllMocks();
    const onNote = vi.fn();
    const config = refreshClassifyConfig({ REFRESH_CLASSIFY_RETRY_LIMIT: "0" });
    const unusedModels = createRefreshModelPolicy({ ...config, timeoutMs: 1000, primaryQualityAttempts: 1,
      forceFallback: false, createClient: () => { throw new Error("Unexpected model call"); } });
    await retryUnclassifiedRefreshSignals({
      classification: { ...config, models: unusedModels, prompt: { id: "v2", sha256: "a".repeat(64), text: "v2" } },
      db: {} as RunPvRefreshOptions["db"], citySlug: "city", pipelineRunId: "run-0",
      now: new Date("2026-11-20T17:00:00Z"), onNote,
    });
    expect(retryScope).not.toHaveBeenCalled();
    expect(onNote).not.toHaveBeenCalled();

    retryRepository.list.mockRejectedValueOnce(new Error("private SQL retry detail"));
    const retryConfig = refreshClassifyConfig({ REFRESH_CLASSIFY_RETRY_LIMIT: "5", REFRESH_CLASSIFY_RETRY_WINDOW_DAYS: "31" });
    await expect(retryUnclassifiedRefreshSignals({
      classification: { ...retryConfig, models: unusedModels, prompt: { id: "v2", sha256: "a".repeat(64), text: "v2" } },
      db: {} as RunPvRefreshOptions["db"], citySlug: "city", pipelineRunId: "run-err",
      now: new Date("2026-11-20T17:00:00Z"), onNote,
    })).resolves.toBeUndefined();
    expect(onNote).toHaveBeenCalledWith("classification-retry-failed", { failed: 1, pipelineRunId: "run-err" });
    expect(JSON.stringify(onNote.mock.calls)).not.toContain("private SQL retry detail");

    const usedModels: string[] = [];
    const fallbackConfig = refreshClassifyConfig({
      REFRESH_CLASSIFY_MODEL: "gpt-6.2-astra",
      REFRESH_CLASSIFY_FALLBACK_PROVIDER: "muse",
      REFRESH_CLASSIFY_FALLBACK_MODEL: "muse-wonder-1.0",
      REFRESH_CLASSIFY_RETRY_LIMIT: "3",
    });
    const models = createRefreshModelPolicy({ ...fallbackConfig, timeoutMs: 1000, primaryQualityAttempts: 1,
      forceFallback: false, createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
        async generateJson(request) {
          usedModels.push(`${model.provider}:${model.model}`);
          if (model.provider === "openai") throw Object.assign(new Error("quota exceeded"), { status: 429 });
          await request.validateResponse?.(JSON.stringify({ classe: "a_surveiller",
            reason: "Residential rezoning mentioned", reasonCode: "S-PORTEE-FLOUE", ambiguous: false }));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        } }) });
    retryRepository.list.mockResolvedValueOnce([
      { citySlug: "city", id: "sig-1", type: "Signal", label: "Rezoning", props: {}, sourceRef: null },
    ]);
    retryRepository.annotation.mockResolvedValueOnce(undefined);
    retryRepository.write.mockResolvedValueOnce("written");
    await retryUnclassifiedRefreshSignals({
      classification: { ...fallbackConfig, models, prompt: { id: "v2", sha256: "a".repeat(64), text: "v2" } },
      db: {} as RunPvRefreshOptions["db"], citySlug: "city", pipelineRunId: "run-fallback",
      now: new Date("2026-11-20T17:00:00Z"), excludeNodeIds: new Set(["already-tried"]), onNote,
    });
    expect(retryScope).toHaveBeenLastCalledWith({
      citySlug: "city", windowFrom: "2026-10-20", limit: 3, excludeNodeIds: ["already-tried"],
    });
    expect(usedModels).toEqual(["openai:gpt-6.2-astra", "muse:muse-wonder-1.0"]);
    expect(retryRepository.write).toHaveBeenCalledWith(expect.objectContaining({
      citySlug: "city", nodeId: "sig-1", nodeType: "Signal", classe: "a_surveiller", model: "muse-wonder-1.0",
    }), expect.any(AbortSignal));
    expect(onNote).toHaveBeenCalledWith("classification-retry-completed", expect.objectContaining({
      candidates: 1, written: 1, failed: 0, retryLimit: 3, windowFrom: "2026-10-20",
    }));
  });
});

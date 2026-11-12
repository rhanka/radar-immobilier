import { createMemoryGitBindingStore, type LiveServiceDeps, type LiveStore, type LiveWorkerPort } from "@sentropic/artifacts";
import { describe, expect, it, vi } from "vitest";
import { composeGitMode, readGitModeConfig } from "./compose.js";
import { logLiveWorkerEvent } from "./live.js";

const captured: { deps?: LiveServiceDeps } = {};
vi.mock("@sentropic/artifacts", async (original) => {
  const actual = await original<typeof import("@sentropic/artifacts")>();
  return { ...actual, createLiveService: vi.fn((deps: LiveServiceDeps) => {
    captured.deps = deps;
    return actual.createLiveService(deps);
  }) };
});

const SCOPE = "radar-immobilier-test";
const IDENTITY = { storageScopeId: SCOPE, artifactId: "11111111-1111-4111-8111-111111111111", bindingGeneration: 2 };
const resolution = { stage: "live", tools: ["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish",
  "artifacts_git_commit", "artifacts_live_write", "artifacts_live_read", "artifacts_live_reset", "artifacts_live_status",
  "artifacts_live_control"], unrouted: [] } as const;

function compose(input: { worker?: LiveWorkerPort; onLiveWorkerEvent?: (event: unknown) => void; redrive?: boolean } = {}) {
  const store = { pending: vi.fn(async () => []), transaction: vi.fn(), sessionIdentity: vi.fn() } as unknown as LiveStore;
  const deps = composeGitMode({ resolution, pool: { query: async () => ({ rows: [] }) } as never, storageScopeId: SCOPE,
    config: { codeReaders: [], humans: [], installationRef: "inst", liveRedriveEnabled: input.redrive ?? true },
    ports: { bindings: createMemoryGitBindingStore(), hasWriteScope: () => true, liveStore: store,
      gitToolFactory: () => ({ execute: async () => ({}) }),
      ...(input.worker ? { liveWorker: input.worker } : {}),
      ...(input.onLiveWorkerEvent ? { onLiveWorkerEvent: input.onLiveWorkerEvent } : {}) } });
  return { deps, store };
}

describe("live worker events (0.2.27 onWorkerEvent)", () => {
  it("writes one structured JSON line per failed or pending settle, with the typed code and builder reason", () => {
    const lines: string[] = [];
    logLiveWorkerEvent({ identity: IDENTITY, action: "project", outcome: "failed", code: "build_failed", reason: "install_timeout" },
      (line) => lines.push(line));
    logLiveWorkerEvent({ identity: IDENTITY, action: "stop", outcome: "failed", code: "timeout" }, (line) => lines.push(line));
    logLiveWorkerEvent({ identity: IDENTITY, action: "project", outcome: "pending" }, (line) => lines.push(line));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { kind: "artifacts.live_worker_failed", operation: "project", ...IDENTITY, code: "build_failed", reason: "install_timeout" },
      { kind: "artifacts.live_worker_failed", operation: "stop", ...IDENTITY, code: "timeout" },
      { kind: "artifacts.live_worker_pending", operation: "project", ...IDENTITY },
    ]);
  });

  it("hands the package live service the structured logger by default, or the injected observer", () => {
    compose();
    expect(captured.deps?.onWorkerEvent).toBe(logLiveWorkerEvent);
    const observer = vi.fn();
    compose({ onLiveWorkerEvent: observer });
    expect(captured.deps?.onWorkerEvent).toBe(observer);
  });
});

describe("live re-drive port", () => {
  it("is composed only with a worker AND the explicit single-process flag", async () => {
    const worker: LiveWorkerPort = { reconcile: vi.fn(), stop: vi.fn() };
    expect(compose().deps.liveRedrive).toBeUndefined();
    expect(compose({ worker, redrive: false }).deps.liveRedrive).toBeUndefined();
    expect(readGitModeConfig({}).liveRedriveEnabled).toBe(false);
    for (const value of ["1", "yes", "TRUE"]) {
      expect(readGitModeConfig({ IMMO_ARTIFACTS_LIVE_REDRIVE_ENABLED: value }).liveRedriveEnabled).toBe(false);
    }
    expect(readGitModeConfig({ IMMO_ARTIFACTS_LIVE_REDRIVE_ENABLED: "true" }).liveRedriveEnabled).toBe(true);
  });

  it("runs the package re-drive over this storage scope", async () => {
    const worker: LiveWorkerPort = { reconcile: vi.fn(), stop: vi.fn() };
    const { deps, store } = compose({ worker });
    await expect(deps.liveRedrive!()).resolves.toEqual([]);
    expect(store.pending).toHaveBeenCalledWith(SCOPE, expect.any(Number));
    expect(worker.reconcile).not.toHaveBeenCalled();
  });
});

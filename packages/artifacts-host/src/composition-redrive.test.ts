import type pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeArtifactHost } from "./composition.js";
import { createDeleteConfirmation } from "./delete-confirmation.js";
import { startLiveRedriveLoop } from "./live-redrive.js";

const loop = vi.hoisted(() => ({ stop: vi.fn(), drain: vi.fn(async () => undefined) }));
const redrive = vi.hoisted(() => vi.fn(async () => []));
const cleanupFails = vi.hoisted(() => ({ value: false }));

vi.mock("./storage.js", () => ({ initializeArtifactScope: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./live-redrive.js", () => ({ startLiveRedriveLoop: vi.fn(() => loop) }));
vi.mock("./git-mode/compose.js", async (original) => ({
  ...await original<typeof import("./git-mode/compose.js")>(),
  composeGitModeFromEnv: vi.fn(() => ({ liveRedrive: redrive })),
}));
vi.mock("./preparation-cleanup.js", async (original) => {
  const actual = await original<typeof import("./preparation-cleanup.js")>();
  return { ...actual, startPreparationCleanup: vi.fn((...args: Parameters<typeof actual.startPreparationCleanup>) => {
    if (cleanupFails.value) throw new Error("cleanup unavailable");
    return actual.startPreparationCleanup(...args);
  }) };
});

const options = { confirmation: createDeleteConfirmation({} as pg.Pool, "scope", "https://app.test"),
  uploadPage: { cookieSecret: "test-upload-page-secret-32-bytes-padding",
    controlOrigin: "https://app.test", pageBaseUrl: "https://app.test/api/v1", s3Origins: [] } };
const config = { enabled: true as const, storageScope: "scope", orgId: "org", s3Bucket: "test-bucket",
  s3Endpoint: "http://minio:9000", s3Region: "ca-central-1", s3AccessKey: "test", s3SecretKey: "test" };
const pool = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as pg.Pool;

describe("live re-drive wiring in the artifact host composition", () => {
  afterEach(() => { vi.clearAllMocks(); cleanupFails.value = false; });

  it("starts the loop on the composed re-drive port and stops it on close", async () => {
    const signals = { once: vi.fn(), removeListener: vi.fn(), listenerCount: vi.fn(() => 0), exit: vi.fn() };
    const host = await composeArtifactHost(pool(), config, undefined, { ...options, signals });
    expect(startLiveRedriveLoop).toHaveBeenCalledTimes(1);
    expect(startLiveRedriveLoop).toHaveBeenCalledWith(expect.objectContaining({ redrive, signals }));
    expect(loop.stop).not.toHaveBeenCalled();
    host.close();
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });

  it("stops the loop when the composition fails after it started", async () => {
    cleanupFails.value = true;
    await expect(composeArtifactHost(pool(), config, undefined, options)).rejects.toThrow("cleanup unavailable");
    expect(startLiveRedriveLoop).toHaveBeenCalledTimes(1);
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });
});

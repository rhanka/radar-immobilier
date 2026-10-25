import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), end: vi.fn(), spawn: vi.fn(), write: vi.fn(), rights: vi.fn() }));
vi.mock("../../src/scripts/base-preprod-rights.js", () => ({ assertPrivileges: mocks.rights }));
vi.mock("../../src/config.js", () => ({ loadConfig: () => ({}) }));
vi.mock("../../src/db/client.js", () => ({ createDb: () => ({ db: { execute: mocks.execute }, pool: { end: mocks.end } }) }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", async (original) => ({ ...await original<object>(), writeFileSync: mocks.write }));
const binding = { workspaceId: null, workspaceSlug: "fixture", actorSub: "opaque",
  maintenanceAttemptId: "22222222-2222-4222-8222-222222222222", releaseId: `${"b".repeat(40)}:fixture` };
const invocation = { action: "init" as const, binding, args: ["--workspace-slug", "fixture"],
  database: { database: "radar", role: "radar", schema: "public" } };
afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); process.exitCode = undefined; });

describe("operator Job destination", () => {
  it("should refuse insufficient SQL rights before invoking a mutating child", async () => {
    const { runJob } = await import("../../src/scripts/base-preprod-job.js");
    mocks.execute.mockResolvedValue({ rows: [invocation.database] });
    mocks.rights.mockRejectedValue(new Error("operator_sql_privileges_missing"));
    await expect(runJob(invocation)).rejects.toThrow("operator_sql_privileges_missing");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("should refuse an unrelated UUID before opening the database or running initialization", async () => {
    const { runJob } = await import("../../src/scripts/base-preprod-job.js");
    await expect(runJob({ ...invocation, binding: { ...binding, workspaceId: "11111111-1111-4111-8111-111111111111" } }))
      .rejects.toThrow("workspace_destination_mismatch");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("should refuse a foreign or repeated slug before running initialization", async () => {
    const { runJob } = await import("../../src/scripts/base-preprod-job.js");
    for (const args of [["--workspace-slug", "other"], ["--workspace-slug", "fixture", "--workspace-slug", "other"]]) {
      await expect(runJob({ ...invocation, args })).rejects.toThrow("workspace_destination_mismatch");
    }
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("should refuse a returned UUID that resolves to another slug", async () => {
    const { runJob } = await import("../../src/scripts/base-preprod-job.js");
    mocks.execute.mockResolvedValueOnce({ rows: [invocation.database] }).mockResolvedValueOnce({ rows: [{ slug: "other" }] });
    mocks.spawn.mockReturnValue({ status: 0, stdout: '{"workspaceId":"11111111-1111-4111-8111-111111111111"}' });
    await expect(runJob(invocation)).rejects.toThrow("workspace_destination_mismatch");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});

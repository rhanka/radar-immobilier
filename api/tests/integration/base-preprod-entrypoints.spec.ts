import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(() => { throw new Error("entry_reached"); }),
}));
vi.mock("../../src/config.js", () => ({ loadConfig: mocks.config }));

const original = [...process.argv];
afterEach(() => {
  process.argv = [...original];
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("bundled operator entry guards", () => {
  for (const name of ["init-workspace-authority", "attach-personal-history"] as const) {
    const args = name === "init-workspace-authority"
      ? ["--workspace-slug", "fixture", "--workspace-label", "Fixture", "--actor", "opaque",
        "--moderator", "opaque", "--manager", "opaque"]
      : ["--actor", "opaque", "--entry", "opaque:11111111-1111-4111-8111-111111111111"];
    for (const extension of ["ts", "js"]) {
      it(`should execute ${name}.${extension} when invoked directly`, async () => {
        process.argv = ["node", `/workspace/api/dist/scripts/${name}.${extension}`, ...args];
        const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
        if (name === "init-workspace-authority") await import("../../src/scripts/init-workspace-authority.js");
        else await import("../../src/scripts/attach-personal-history.js");
        await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith("entry_reached\n"));
        expect(mocks.config).toHaveBeenCalledOnce();
        expect(process.exitCode).toBe(1);
      });
    }
    it(`should avoid ${name} execution when imported by another executable`, async () => {
      process.argv = ["node", `/workspace/prefix-${name}.js`, ...args];
      if (name === "init-workspace-authority") await import("../../src/scripts/init-workspace-authority.js");
      else await import("../../src/scripts/attach-personal-history.js");
      expect(mocks.config).not.toHaveBeenCalled();
    });
  }
});

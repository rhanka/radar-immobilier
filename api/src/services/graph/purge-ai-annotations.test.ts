import { describe, expect, it } from "vitest";
import { parsePurgeAiAnnotationsArgs } from "./purge-ai-annotations.js";

describe("purge command arguments", () => {
  it("should default to dry-run and parse explicit modes and filters", () => {
    expect(parsePurgeAiAnnotationsArgs([])).toEqual({ apply: false });
    expect(parsePurgeAiAnnotationsArgs(["--dry-run"])).toEqual({ apply: false });
    expect(parsePurgeAiAnnotationsArgs(["--apply", "--pipeline-run-id", "run-1", "--prompt-sha256", "a".repeat(64)]))
      .toEqual({ apply: true, pipelineRunId: "run-1", promptSha256: "a".repeat(64) });
  });
  it.each([["--apply", "--dry-run"], ["--pipeline-run-id"], ["--prompt-sha256", "invalid"],
    ["--pipeline-run-id", "--apply"], ["--apply=true"], ["--pipeline-run-id", "a", "--pipeline-run-id", "b"]])(
    "should reject invalid arguments %j", (...args) => {
      expect(() => parsePurgeAiAnnotationsArgs(args)).toThrow();
    },
  );
});

import { describe, expect, it } from "vitest";
import { parsePurgeAiAnnotationsArgs, purgeAiAnnotations } from "./purge-ai-annotations.js";
import type { Database } from "../../db/client.js";

describe("purge command arguments", () => {
  it("should default to dry-run and parse explicit modes and filters", () => {
    expect(parsePurgeAiAnnotationsArgs([])).toEqual({ apply: false });
    expect(parsePurgeAiAnnotationsArgs(["--dry-run"])).toEqual({ apply: false });
    expect(parsePurgeAiAnnotationsArgs(["--apply", "--pipeline-run-id", "run-1", "--prompt-sha256", "a".repeat(64)]))
      .toEqual({ apply: true, pipelineRunId: "run-1", promptSha256: "a".repeat(64) });
    expect(parsePurgeAiAnnotationsArgs(["--apply", "--all"])).toEqual({ apply: true, all: true });
  });
  it("should refuse an applied purge without a filter or an explicit --all", () => {
    expect(() => parsePurgeAiAnnotationsArgs(["--apply"])).toThrow(/explicit --all/);
    expect(() => parsePurgeAiAnnotationsArgs(["--apply", "--all", "--pipeline-run-id", "run-1"])).toThrow();
    expect(() => parsePurgeAiAnnotationsArgs(["--apply", "--pipeline-run-id", " "])).toThrow();
  });
  it.each([["--apply", "--dry-run"], ["--pipeline-run-id"], ["--prompt-sha256", "invalid"],
    ["--apply", "--pipeline-run-id", ""], ["--apply", "--prompt-sha256", ""], ["--all", "--all"],
    ["--pipeline-run-id", "--apply"], ["--apply=true"], ["--pipeline-run-id", "a", "--pipeline-run-id", "b"]])(
    "should reject invalid arguments %j", (...args) => {
      expect(() => parsePurgeAiAnnotationsArgs(args)).toThrow();
    },
  );
  it("should refuse unsafe direct calls before opening a database transaction", async () => {
    const db = {} as Database;
    await expect(purgeAiAnnotations(db, { apply: true })).rejects.toThrow(/explicit --all/);
    await expect(purgeAiAnnotations(db, { apply: true, pipelineRunId: "" })).rejects.toThrow(/pipeline run id/);
    await expect(purgeAiAnnotations(db, { apply: true, all: true, pipelineRunId: "run-1" })).rejects.toThrow(/combined/);
  });
});

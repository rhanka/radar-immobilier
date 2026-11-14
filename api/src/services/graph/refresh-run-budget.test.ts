import { describe, expect, it, vi } from "vitest";
import type { TextJsonGenerationClient } from "@sentropic/engram";
import { RefreshRunBudget } from "./refresh-run-budget.js";

const input = { prompt: "evidence", schema: "{}", maxOutputTokens: 10 };
function client() {
  const generateJson = vi.fn(async () => { throw new Error("provider failed"); });
  return { generateJson, mode: "mesh", provider: "openai", model: "test" } satisfies TextJsonGenerationClient;
}
describe("shared refresh run budget", () => {
  it("should reserve across detection and concurrent classification including failed calls", async () => {
    const budget = new RefreshRunBudget({ calls: 2, tokens: 1000, durationMs: 1000 });
    const transport = client();
    const signal = new AbortController().signal;
    const detection = budget.wrap(transport, signal);
    const classification = budget.wrap(transport, signal);
    await expect(detection.generateJson(input)).rejects.toThrow("provider failed");
    await Promise.allSettled(Array.from({ length: 8 }, () => classification.generateJson(input)));
    expect(transport.generateJson).toHaveBeenCalledTimes(2);
    expect(budget).toMatchObject({ calls: 2, reservedTokens: 40, haltedBy: "calls" });
  });
  it.each(["tokens", "time"] as const)("should refuse %s exhaustion before a send", async (dimension) => {
    let now = 0;
    const budget = new RefreshRunBudget({ calls: 10, tokens: dimension === "tokens" ? 19 : 100,
      durationMs: 10 }, () => now);
    if (dimension === "time") now = 10;
    const transport = client();
    await expect(budget.wrap(transport, new AbortController().signal).generateJson(input))
      .rejects.toMatchObject({ code: "REFRESH_RUN_BUDGET" });
    expect(transport.generateJson).not.toHaveBeenCalled();
    expect(budget).toMatchObject({ calls: 0, reservedTokens: 0, haltedBy: dimension });
  });
});

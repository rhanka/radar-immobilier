import { describe, expect, it } from "vitest";
import { createRefreshModelPolicy, type RefreshModelReceipt } from "./refresh-model-policy.js";
import { parseSinglePassClass } from "./refresh-single-pass.js";
import { createReannotationClassifier, runReannotation } from "./reannotate-signals.js";

const primary = { provider: "openai" as const, model: "gpt-6-astra", effort: "low" };
const fallback = { provider: "gemini" as const, model: "gemini-3.8-flash", effort: "low" };
const prompt = { id: "v2", sha256: "a".repeat(64), text: "Three classes only" };
const signal = { citySlug: "city", id: "signal", type: "Signal", label: "Bylaw", props: {}, sourceRef: null };
const invalid = { classe: "non_classe", reasonCode: "UNCLASSIFIED", reason: "Unknown", ambiguous: true };
const valid = { classe: "a_surveiller", reasonCode: "S-PORTEE-FLOUE", reason: "Scope unknown", ambiguous: true };

function fixture(fallbackFails: boolean) {
  const calls: string[] = [];
  const receipts: RefreshModelReceipt[] = [];
  const policy = createRefreshModelPolicy({ primary, fallback, primaryQualityAttempts: 1,
    forceFallback: false, timeoutMs: 1000,
    createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
      async generateJson(request) {
        calls.push(model.model);
        await request.validateResponse?.(JSON.stringify(model === primary || fallbackFails ? invalid : valid));
        return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
      } }),
  });
  return { policy, calls, receipts };
}

describe("single-pass v2 quality fallback", () => {
  it("should reject AI Non classé and accept an ambiguous S from Gemini 3.8", async () => {
    const f = fixture(false);
    let accepted: unknown;
    await f.policy.forDocument("doc", async (receipt) => { f.receipts.push(receipt); }).generateJson({
      prompt: prompt.text, schema: "{}",
      validateResponse(text) { accepted = parseSinglePassClass(JSON.parse(text)); },
    });
    expect(f.calls).toEqual([primary.model, fallback.model]);
    expect(accepted).toEqual(valid);
    expect(f.receipts).toMatchObject([
      { modelUsed: primary, status: "quality-refused" },
      { modelUsed: fallback, status: "completed", fallbackReason: "quality" },
    ]);
  });

  it("should count a failure and write no annotation if both models return Non classé", async () => {
    const f = fixture(true);
    let writes = 0;
    const report = await runReannotation({ primary, fallback, prompt, pipelineRunId: "test",
      now: new Date("2026-11-13T00:00:00Z"), apply: true,
      classify: createReannotationClassifier(f.policy, prompt),
      repository: { list: async () => [signal], annotation: async () => undefined,
        write: async () => { writes++; return "written"; } },
    });
    expect(f.calls).toEqual([primary.model, fallback.model]);
    expect(report.failures).toHaveLength(1);
    expect(report.classified).toBe(0);
    expect(writes).toBe(0);
  });
});

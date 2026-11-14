import { describe, expect, it, vi } from "vitest";
import { createRefreshModelPolicy } from "./refresh-model-policy.js";
import { createReannotationClassifier, parseReannotationArgs, reannotationInput, reannotationInputSha256, runReannotation,
  type ReannotationIdentity, type ReannotationRepository, type ReannotationSignal,
  type ReannotationWrite } from "./reannotate-signals.js";

const signal: ReannotationSignal = { citySlug: "test-city", id: "signal-1", type: "Signal",
  label: "Four residential units", props: { excerpt: "Four units approved" }, sourceRef: null };
const primary = { provider: "openai" as const, model: "gpt-6-astra", effort: "medium" };
const fallback = { provider: "gemini" as const, model: "gemini-3.8-flash", effort: "low" };
const prompt = { id: "p0-v1", sha256: "a".repeat(64), text: "instructions" };
const now = new Date("2026-11-13T12:00:00.000Z");
const decision = { classe: "pertinent" as const, reason: "Residential units", ...primary };
function fixture(initial?: ReannotationIdentity) {
  let annotation = initial;
  const write = vi.fn(async (input: ReannotationWrite) => { annotation = input; return "written" as const; });
  const repository: ReannotationRepository = { list: vi.fn(async () => [signal]),
    annotation: async () => annotation, write };
  const classify = vi.fn(async () => decision);
  const options = { repository, classify, primary, fallback, prompt, now, pipelineRunId: "run-1" };
  return { repository, classify, write, options };
}

describe("30-day signal reannotation", () => {
  it("defaults to dry-run and rejects ambiguous or unknown arguments", () => {
    expect(parseReannotationArgs([])).toEqual({ apply: false });
    expect(parseReannotationArgs(["--dry-run"])).toEqual({ apply: false });
    expect(parseReannotationArgs(["--apply"])).toEqual({ apply: true });
    expect(() => parseReannotationArgs(["--apply", "--dry-run"])).toThrow("Usage");
    expect(() => parseReannotationArgs(["--force"])).toThrow("Usage");
  });
  it("excludes prior AI answers from evidence and content identity", () => {
    const props = { ...signal.props as object, properties: { category: "rezonage" } };
    const clean = { ...signal, props };
    const annotated = { ...signal, props: { ...props, classAnnotation: { reason: "Old answer" },
      properties: { ...props.properties, classAnnotation: { model: "old-model" } } } };
    expect(reannotationInput(annotated)).toEqual(clean);
    expect(reannotationInputSha256(annotated)).toEqual(reannotationInputSha256(clean));
    expect(annotated.props.classAnnotation.reason).toBe("Old answer");
  });
  it("classifies in dry-run without writing and limits selection to 30 days", async () => {
    const f = fixture();
    const result = await runReannotation(f.options);
    expect(result).toMatchObject({ mode: "dry-run", classified: 1, written: 0,
      classes: { pertinent: 1 }, failures: [] });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.repository.list).toHaveBeenCalledWith(new Date("2026-10-14T12:00:00.000Z"));
  });
  it("never submits manual annotations to the model", async () => {
    const f = fixture({ source: "manual" });
    expect(await runReannotation({ ...f.options, apply: true })).toMatchObject({ skippedManual: 1 });
    expect(f.classify).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });
  it("persists provenance once then resumes without model calls or writes", async () => {
    const f = fixture();
    expect(await runReannotation({ ...f.options, apply: true })).toMatchObject({ written: 1 });
    expect(f.write).toHaveBeenCalledWith(expect.objectContaining({ source: "ai", promptId: prompt.id,
      promptSha256: prompt.sha256, model: primary.model, effort: primary.effort,
      inputSha256: reannotationInputSha256(signal), pipelineRunId: "run-1" }));
    expect(await runReannotation({ ...f.options, apply: true })).toMatchObject({ skippedUnchanged: 1 });
    expect(f.classify).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("reclassifies changed content and accepts unchanged fallback annotations", async () => {
    const f = fixture({ source: "ai", model: fallback.model, effort: fallback.effort,
      promptSha256: prompt.sha256, inputSha256: reannotationInputSha256(signal) });
    expect(await runReannotation(f.options)).toMatchObject({ skippedUnchanged: 1 });
    f.repository.list = async () => [{ ...signal, props: { excerpt: "Changed evidence" } }];
    expect(await runReannotation(f.options)).toMatchObject({ classified: 1 });
  });
  it("isolates failures and reports manual changes that race an AI classification", async () => {
    const f = fixture();
    f.repository.list = async () => [signal, { ...signal, id: "signal-2" }];
    f.classify.mockRejectedValueOnce(Object.assign(new Error("private transport detail"), { code: "no_route" }));
    f.repository.write = async () => "manual";
    const report = await runReannotation({ ...f.options, apply: true });
    expect(report).toMatchObject({ written: 0, classified: 1, skippedManual: 1,
      failures: [{ citySlug: signal.citySlug, nodeType: signal.type, nodeId: signal.id, code: "no_route" }] });
    expect(JSON.stringify(report)).not.toContain("private transport detail");
  });
  it("validates class consistency and records the actual fallback model", async () => {
    const calls: string[] = [];
    const policy = createRefreshModelPolicy({ primary, fallback, primaryQualityAttempts: 1,
      forceFallback: false, timeoutMs: 1000,
      createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
        async generateJson(request) {
          calls.push(model.model);
          expect(request.prompt).toContain(prompt.text);
          expect(request.prompt).not.toContain("Previous model answer");
          const output = model.provider === "openai"
            ? { classe: "ecarte", reason: "Invalid class for this reason", reasonCode: "P-RESIDENTIAL" }
            : { classe: "pertinent", reason: "Residential project", reasonCode: "P-RESIDENTIAL" };
          await request.validateResponse?.(JSON.stringify(output));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        } }),
    });
    expect(await createReannotationClassifier(policy, prompt)({ ...signal, props: {
      ...signal.props as object, properties: { classAnnotation: { reason: "Previous model answer" } },
    } })).toEqual({ classe: "pertinent",
      reason: "Residential project", model: fallback.model, effort: fallback.effort });
    expect(calls).toEqual([primary.model, fallback.model]);
  });
});

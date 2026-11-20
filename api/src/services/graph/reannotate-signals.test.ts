import { describe, expect, it, vi } from "vitest";
import { createRefreshModelPolicy } from "./refresh-model-policy.js";
import { refreshClassifyConfig } from "./refresh-classify-config.js";
import { loadSinglePassPrompt } from "./refresh-single-pass.js";
import {
  createReannotationClassifier,
  DEFAULT_REANNOTATION_SINCE_DAYS,
  parseReannotationArgs,
  parseReannotationPipelineRunId,
  parseReannotationSinceDays,
  reannotationInput,
  reannotationInputSha256,
  runReannotation,
  type ReannotationIdentity,
  type ReannotationRepository,
  type ReannotationSignal,
  type ReannotationWrite,
} from "./reannotate-signals.js";

const signal: ReannotationSignal = { citySlug: "test-city", id: "signal-1", type: "Signal",
  label: "Four residential units", props: { excerpt: "Four units approved" }, sourceRef: null };
const primary = { provider: "openai" as const, model: "gpt-6-astra", effort: "medium" };
const fallback = { provider: "gemini" as const, model: "gemini-3.8-flash", effort: "low" };
const prompt = { id: "p0-v1", sha256: "a".repeat(64), text: "instructions" };
const now = new Date("2026-11-13T12:00:00.000Z");
const decision = { classe: "pertinent" as const, reason: "Residential units", ambiguous: false, ...primary };
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
  it("should classify new and changed inputs while skipping identical v1 and v2 input", async () => {
    const f = fixture();
    f.repository.list = async () => ["new", "changed", "v1", "unchanged"].map((id) => ({ ...signal, id }));
    f.repository.annotation = async (act) => act.id === "new" ? undefined : { source: "ai", promptId: act.id === "v1" ? "p0-v1" : "v2",
      inputSha256: act.id === "changed" ? "old" : reannotationInputSha256(act) };
    expect(await runReannotation({ ...f.options, changedInputOnly: true }))
      .toMatchObject({ classified: 2, skippedUnchanged: 2 });
    expect(f.classify).toHaveBeenCalledTimes(2);
    expect(f.classify).not.toHaveBeenCalledWith({ ...signal, id: "unchanged" }, expect.any(AbortSignal));
  });

  it.each(["act", "run"])("should cancel a stuck model at the %s deadline without writing", async (scope) => {
    const f = fixture();
    const policy = createRefreshModelPolicy({ primary, fallback, primaryQualityAttempts: 1,
      forceFallback: false, timeoutMs: 10_000, createClient: (model) => ({ mode: "mesh",
        provider: model.provider, model: model.model, generateJson: () => new Promise(() => {}) }) });
    const run = runReannotation({ ...f.options, apply: true,
      actTimeoutMs: scope === "act" ? 20 : 1000, runTimeoutMs: scope === "run" ? 20 : 1000,
      classify: createReannotationClassifier(policy, prompt) });
    if (scope === "run") await expect(run).rejects.toThrow();
    else expect(await run).toMatchObject({ classified: 0, written: 0, failures: [{ code: "reannotation_failed",
      citySlug: signal.citySlug, nodeId: signal.id, nodeType: signal.type }] });
    expect(f.write).not.toHaveBeenCalled();
  });

  it("should skip identical input in two-step even after changing the model or prompt", async () => {
    const f = fixture({ source: "ai", promptId: "v2", model: "old", effort: "high", promptSha256: "old",
      inputSha256: reannotationInputSha256(signal) });
    expect(await runReannotation({ ...f.options, changedInputOnly: true })).toMatchObject({ skippedUnchanged: 1 });
    expect(f.classify).not.toHaveBeenCalled();
    expect(await runReannotation(f.options)).toMatchObject({ classified: 1 });
  });

  it("should bound concurrent calls while continuing after an individual failure", async () => {
    const f = fixture();
    f.repository.list = async () => Array.from({ length: 7 }, (_, id) => ({ ...signal, id: String(id) }));
    let active = 0;
    let peak = 0;
    f.options.classify = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return decision;
    });
    f.options.classify.mockRejectedValueOnce(new Error("classification unavailable"));
    const report = await runReannotation({ ...f.options, concurrency: 2, apply: true });
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(report).toMatchObject({ candidates: 7, classified: 6, written: 6 });
    expect(report.failures).toHaveLength(1);
    await expect(runReannotation({ ...f.options, concurrency: 0 })).rejects.toThrow("concurrency");
  });

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
    expect(f.repository.list).toHaveBeenCalledWith(new Date("2026-10-14T12:00:00.000Z"), expect.any(AbortSignal));
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
      inputSha256: reannotationInputSha256(signal), pipelineRunId: "run-1" }), expect.any(AbortSignal));
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
            ? { classe: "ecarte", reason: "Invalid class for this reason", reasonCode: "P-DENSITE", ambiguous: false }
            : { classe: "pertinent", reason: "Residential project", reasonCode: "P-DENSITE", ambiguous: false };
          await request.validateResponse?.(JSON.stringify(output));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        } }),
    });
    expect(await createReannotationClassifier(policy, prompt)({ ...signal, props: {
      ...signal.props as object, properties: { classAnnotation: { reason: "Previous model answer" } },
    } })).toEqual({ classe: "pertinent",
      reason: "Residential project", ambiguous: false, model: fallback.model, effort: fallback.effort });
    expect(calls).toEqual([primary.model, fallback.model]);
  });

  it("parses REANNOTATION_SINCE_DAYS (default 30) and PIPELINE_RUN_ID explicitly", () => {
    expect(DEFAULT_REANNOTATION_SINCE_DAYS).toBe(30);
    expect(parseReannotationSinceDays({})).toBe(30);
    expect(parseReannotationSinceDays({ REANNOTATION_SINCE_DAYS: "" })).toBe(30);
    expect(parseReannotationSinceDays({ REANNOTATION_SINCE_DAYS: "30" })).toBe(30);
    expect(parseReannotationSinceDays({ REANNOTATION_SINCE_DAYS: "14" })).toBe(14);
    for (const bad of ["0", "-5", "366", "3.5", "abc"]) {
      expect(() => parseReannotationSinceDays({ REANNOTATION_SINCE_DAYS: bad })).toThrow("REANNOTATION_SINCE_DAYS");
    }
    expect(parseReannotationPipelineRunId({})).toBeUndefined();
    expect(parseReannotationPipelineRunId({ PIPELINE_RUN_ID: "prod-reannotate-30d-123" })).toBe("prod-reannotate-30d-123");
    expect(() => parseReannotationPipelineRunId({ PIPELINE_RUN_ID: "bad id with space" })).toThrow("PIPELINE_RUN_ID");
  });

  it("applies custom sinceDays, reports per-city counts and traceability fields in dry-run", async () => {
    const f = fixture();
    const signals: ReannotationSignal[] = [
      { ...signal, citySlug: "valleyfield", id: "s1" },
      { ...signal, citySlug: "brossard", id: "s2" },
      { ...signal, citySlug: "valleyfield", id: "s3" },
      { ...signal, citySlug: "brossard", id: "s4" },
    ];
    f.repository.list = vi.fn(async () => signals);
    f.repository.annotation = async (act) => act.id === "s3" ? { source: "manual" } : undefined;
    const classify = vi.fn(async (act: ReannotationSignal) => {
      if (act.id === "s4") throw Object.assign(new Error("timeout"), { code: "timeout" });
      return decision;
    });
    const report = await runReannotation({ ...f.options, classify, sinceDays: 14, pipelineRunId: "prod-reannotate-14d-42" });
    expect(f.repository.list).toHaveBeenCalledWith(new Date("2026-10-30T12:00:00.000Z"), expect.any(AbortSignal));
    expect(report).toMatchObject({
      mode: "dry-run",
      pipelineRunId: "prod-reannotate-14d-42",
      promptId: prompt.id,
      promptSha256: prompt.sha256,
      sinceDays: 14,
      candidates: 4,
      candidatesByCity: { brossard: 2, valleyfield: 2 },
      processed: 4,
      classified: 2,
      written: 0,
      skippedManual: 1,
      refused: 1,
      failed: 1,
    });
    expect(f.write).not.toHaveBeenCalled();
  });

  it("uses two-step v2 prompt with Astra low primary, Muse Wonder 1.0 low fallback, and preserves manual priority", async () => {
    const v2Prompt = await loadSinglePassPrompt();
    expect(v2Prompt.id).toBe("v2");
    expect(v2Prompt.sha256).toMatch(/^34df2dd7/);
    const cfg = refreshClassifyConfig({
      REFRESH_CLASSIFY_PROVIDER: "openai",
      REFRESH_CLASSIFY_MODEL: "gpt-6-astra",
      REFRESH_CLASSIFY_REASONING_EFFORT: "low",
      REFRESH_CLASSIFY_FALLBACK_PROVIDER: "muse",
      REFRESH_CLASSIFY_FALLBACK_MODEL: "muse-wonder-1.0",
      REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT: "low",
      REFRESH_CLASSIFY_CONCURRENCY: "2",
    });
    const attempted: Array<{ provider: string; model: string; effort: string }> = [];
    const policy = createRefreshModelPolicy({
      primary: cfg.primary,
      fallback: cfg.fallback,
      primaryQualityAttempts: 1,
      forceFallback: false,
      timeoutMs: 1000,
      createClient: (model) => ({
        mode: "mesh",
        provider: model.provider,
        model: model.model,
        async generateJson(request) {
          attempted.push({ provider: model.provider, model: model.model, effort: model.effort });
          if (model.provider === "openai") throw Object.assign(new Error("rate limited"), { status: 429 });
          const output = { classe: "a_surveiller", reason: "PPCMOI residentiel a suivre", reasonCode: "S-INFO-MANQUANTE", ambiguous: false };
          await request.validateResponse?.(JSON.stringify(output));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        },
      }),
    });
    const writes: ReannotationWrite[] = [];
    const stored = new Map<string, ReannotationIdentity>([["human-1", { source: "manual" }]]);
    const repo: ReannotationRepository = {
      list: async () => [
        { ...signal, citySlug: "drummondville", id: "auto-1" },
        { ...signal, citySlug: "drummondville", id: "human-1" },
      ],
      annotation: async (act) => stored.get(act.id),
      write: async (input) => {
        writes.push(input);
        stored.set(input.nodeId, input);
        return "written";
      },
    };
    const report = await runReannotation({
      repository: repo,
      prompt: v2Prompt,
      primary: cfg.primary,
      fallback: cfg.fallback,
      concurrency: cfg.concurrency,
      apply: true,
      sinceDays: 30,
      now,
      pipelineRunId: "prod-reannotate-30d-muse-1",
      classify: createReannotationClassifier(policy, v2Prompt),
    });
    expect(attempted).toEqual([
      { provider: "openai", model: "gpt-6-astra", effort: "low" },
      { provider: "muse", model: "muse-wonder-1.0", effort: "low" },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      citySlug: "drummondville",
      nodeId: "auto-1",
      classe: "a_surveiller",
      source: "ai",
      model: "muse-wonder-1.0",
      effort: "provider-default",
      promptId: "v2",
      promptSha256: v2Prompt.sha256,
      pipelineRunId: "prod-reannotate-30d-muse-1",
    });
    expect(report).toMatchObject({
      mode: "apply",
      pipelineRunId: "prod-reannotate-30d-muse-1",
      promptId: "v2",
      promptSha256: v2Prompt.sha256,
      sinceDays: 30,
      candidates: 2,
      candidatesByCity: { drummondville: 2 },
      processed: 2,
      classified: 1,
      written: 1,
      skippedManual: 1,
      refused: 1,
      failed: 0,
    });
    // Resume run must treat the Muse provider-default annotation as unchanged.
    const resumed = await runReannotation({
      repository: repo,
      prompt: v2Prompt,
      primary: cfg.primary,
      fallback: cfg.fallback,
      concurrency: cfg.concurrency,
      apply: true,
      sinceDays: 30,
      now,
      pipelineRunId: "prod-reannotate-30d-muse-2",
      classify: createReannotationClassifier(policy, v2Prompt),
    });
    expect(resumed).toMatchObject({
      candidates: 2,
      processed: 2,
      classified: 0,
      written: 0,
      skippedUnchanged: 1,
      skippedManual: 1,
      refused: 1,
      failed: 0,
    });
    expect(attempted).toHaveLength(2);
  });
});

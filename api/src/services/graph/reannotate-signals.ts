import { createHash } from "node:crypto";
import type { RefreshDocumentModels, RefreshModel } from "./refresh-model-policy.js";
import { canonicalJson } from "./replay/canonical-json.js";
import { parseSinglePassClass, singlePassClasses, singlePassReasonCodes } from "./refresh-single-pass.js";
import { parseRefreshVerificationJson } from "./refresh-verification.js";

export interface ReannotationSignal {
  citySlug: string; id: string; type: string; label: string; props: unknown;
  sourceRef: string | null;
}
export interface ReannotationIdentity {
  source: "ai" | "manual"; model?: string | null; effort?: string | null;
  promptSha256?: string | null; inputSha256?: string | null;
}
export interface ReannotationDecision {
  classe: "pertinent" | "a_surveiller" | "ecarte";
  reason: string; model: string; effort: string; ambiguous: boolean;
}
export interface ReannotationWrite extends ReannotationDecision {
  citySlug: string; nodeId: string; nodeType: string; source: "ai";
  promptId: string; promptSha256: string; inputSha256: string; pipelineRunId: string;
}
export interface ReannotationRepository {
  list(since: Date): Promise<ReannotationSignal[]>;
  annotation(signal: ReannotationSignal): Promise<ReannotationIdentity | undefined>;
  write(input: ReannotationWrite): Promise<"written" | "manual" | "noop">;
}
export interface ReannotationPrompt { id: string; sha256: string; text: string }
export interface ReannotationReport {
  mode: "dry-run" | "apply"; pipelineRunId: string; since: string; candidates: number;
  classified: number; written: number; skippedManual: number; skippedUnchanged: number;
  classes: Record<ReannotationDecision["classe"], number>;
  failures: Array<{ citySlug: string; nodeType: string; nodeId: string; code: string }>;
}

/** Prior answers are output metadata, never evidence for the next decision. */
function withoutClassAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClassAnnotations);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "classAnnotation")
    .map(([key, child]) => [key, withoutClassAnnotations(child)]));
}
export function reannotationInput(signal: ReannotationSignal): ReannotationSignal {
  return { ...signal, props: withoutClassAnnotations(signal.props) };
}
export function reannotationInputSha256(signal: ReannotationSignal): string {
  return createHash("sha256").update(canonicalJson(reannotationInput(signal))).digest("hex");
}

/** A failure is isolated to one signal. Durable successes are the resume cursor. */
export async function runReannotation(options: {
  repository: ReannotationRepository; prompt: ReannotationPrompt; primary: RefreshModel;
  fallback: RefreshModel; pipelineRunId: string; now: Date; apply?: boolean;
  classify(signal: ReannotationSignal): Promise<ReannotationDecision>;
  signal?: AbortSignal;
}): Promise<ReannotationReport> {
  const since = new Date(options.now.getTime() - 30 * 86_400_000);
  const report: ReannotationReport = { mode: options.apply ? "apply" : "dry-run",
    pipelineRunId: options.pipelineRunId, since: since.toISOString(), candidates: 0,
    classified: 0, written: 0, skippedManual: 0, skippedUnchanged: 0,
    classes: { pertinent: 0, a_surveiller: 0, ecarte: 0 }, failures: [] };
  const signals = await options.repository.list(since);
  report.candidates = signals.length;
  for (const signal of signals) {
    options.signal?.throwIfAborted();
    try {
      const annotation = await options.repository.annotation(signal);
      if (annotation?.source === "manual") { report.skippedManual++; continue; }
      const inputSha256 = reannotationInputSha256(signal);
      // A prior fallback result is valid for the same configured model pair.
      const currentModel = [options.primary, options.fallback].some((model) =>
        model.model === annotation?.model && model.effort === annotation?.effort);
      if (currentModel && annotation?.promptSha256 === options.prompt.sha256
        && annotation.inputSha256 === inputSha256) { report.skippedUnchanged++; continue; }
      const decision = await options.classify(signal);
      report.classified++;
      report.classes[decision.classe]++;
      if (!options.apply) continue;
      const result = await options.repository.write({ ...decision, citySlug: signal.citySlug,
        nodeId: signal.id, nodeType: signal.type, source: "ai", promptId: options.prompt.id,
        promptSha256: options.prompt.sha256, inputSha256, pipelineRunId: options.pipelineRunId });
      if (result === "written") report.written++;
      else if (result === "manual") report.skippedManual++;
      else report.skippedUnchanged++;
    } catch (error) {
      options.signal?.throwIfAborted();
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        && /^[A-Za-z0-9_-]{1,100}$/u.test(error.code) ? error.code : "reannotation_failed";
      report.failures.push({ citySlug: signal.citySlug, nodeType: signal.type, nodeId: signal.id, code });
    }
  }
  return report;
}

/** Classification reads the same versioned instructions as extraction, over stored evidence. */
export function createReannotationClassifier(models: RefreshDocumentModels, prompt: ReannotationPrompt) {
  return async (signal: ReannotationSignal): Promise<ReannotationDecision> => {
    const identity = reannotationInputSha256(signal);
    const accepted: { model?: RefreshModel; decision?: ReturnType<typeof parseSinglePassClass> } = {};
    try {
      const client = models.forDocument(identity, async (receipt) => {
        if (receipt.status === "completed" && receipt.modelUsed) accepted.model = receipt.modelUsed;
      });
      const result = await client.generateJson({
        prompt: `${prompt.text}\n\nReclassify only this existing signal using its stored evidence. `
          + "Do not extract or invent additional acts. Return only {classe,reason,reasonCode,ambiguous}.\n"
          + canonicalJson(reannotationInput(signal)),
        schema: JSON.stringify({ type: "object", required: ["classe", "reason", "reasonCode", "ambiguous"],
          properties: { classe: { enum: singlePassClasses }, ambiguous: { type: "boolean" },
            reason: { type: "string" }, reasonCode: { enum: singlePassReasonCodes } } }),
        maxOutputTokens: 2048,
        validateResponse(text) { accepted.decision = parseSinglePassClass(parseRefreshVerificationJson(text)); },
      });
      if (!accepted.decision || !accepted.model || result.status !== "completed") throw new Error("Incomplete reannotation response");
      return { classe: accepted.decision.classe, reason: accepted.decision.reason,
        ambiguous: accepted.decision.ambiguous, model: accepted.model.model, effort: accepted.model.effort };
    } finally { models.completeDocument(identity); }
  };
}

export function parseReannotationArgs(args: readonly string[]): { apply: boolean } {
  if (args.length > 1 || args.some((arg) => arg !== "--dry-run" && arg !== "--apply")) {
    throw new Error("Usage: reannotate-signals [--dry-run | --apply]");
  }
  return { apply: args[0] === "--apply" };
}

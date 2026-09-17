import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TextJsonGenerationClient } from "@sentropic/graphify";

import type { RefreshProvider } from "./refresh-mesh.js";

export interface RefreshModel {
  readonly provider: RefreshProvider;
  readonly model: string;
  readonly effort: string;
}
export type RefreshFallbackReason = "quota" | "timeout" | "empty-output" | "transport" | "quality" | "forced" | "circuit-open";
export type RefreshModelTransition = "primary" | "same-model-retry" | "fallback";
export interface RefreshModelReceipt {
  readonly modelUsed: RefreshModel | null;
  readonly status: "completed" | "failed" | "quality-refused";
  /** One-based model invocation number for this document. */
  readonly attempt: number;
  /** Distinguishes a Gemini retry from a switch to Astra. */
  readonly transition: RefreshModelTransition;
  readonly fallbackReason?: RefreshFallbackReason;
  readonly failureReason?: RefreshFallbackReason;
  readonly terminalFailure?: true;
  readonly latencyMs: number;
}
export interface RefreshModelPolicyOptions {
  readonly primary: RefreshModel;
  readonly fallback: RefreshModel;
  readonly forceFallback: boolean;
  readonly primaryQualityAttempts: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly createClient: (model: RefreshModel, signal: AbortSignal) => TextJsonGenerationClient;
}
export interface RefreshDocumentModels {
  readonly policy: string;
  readonly maximumAttempts: number;
  forDocument(docSha: string, record: (receipt: RefreshModelReceipt) => Promise<void>): TextJsonGenerationClient;
  completeDocument(docSha: string): void;
  restoreDocument(docSha: string, receipts: readonly RefreshModelReceipt[]): void;
}

/** Inspect only for classification; never emit upstream messages or response bodies. */
export function refreshFallbackReason(error: unknown): RefreshFallbackReason {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const tokens = [record["code"], record["reason"], record["message"]].filter((v) => typeof v === "string").join(" ");
  if (record["statusCode"] === 429 || record["status"] === 429
    || /quota|rate.limit|no_active_account|no-active-account|usage_limit/i.test(tokens)) return "quota";
  if (record["name"] === "TimeoutError" || record["name"] === "AbortError") return "timeout";
  if (record["code"] === "REFRESH_EMPTY_OUTPUT") return "empty-output";
  if (record["cause"]) return refreshFallbackReason(record["cause"]);
  return "transport";
}

/** One instance per cycle. A fallback sticks to its document after any model switch. */
export function createRefreshModelPolicy(options: RefreshModelPolicyOptions): RefreshDocumentModels {
  let consecutiveQuotaDocuments = 0;
  if (!Number.isInteger(options.primaryQualityAttempts) || options.primaryQualityAttempts < 1) {
    throw new Error("Refresh primary quality attempts must be positive");
  }
  let circuitOpen = false;
  const documents = new Map<string, {
    reason?: RefreshFallbackReason; counted: boolean; terminal?: boolean; attempts: number; primaryQualityCalls: number;
  }>();
  return {
    policy: JSON.stringify({ version: 2, primary: options.primary, fallback: options.fallback,
      primaryQualityAttempts: options.primaryQualityAttempts, forceFallback: options.forceFallback, quotaThreshold: 3 }),
    maximumAttempts: options.primaryQualityAttempts + 1,
    completeDocument(docSha) {
      const document = documents.get(docSha);
      if (document && !document.reason) consecutiveQuotaDocuments = 0;
    },
    restoreDocument(docSha, receipts) {
      const primaryQualityCalls = receipts.filter((receipt) => receipt.modelUsed?.provider === options.primary.provider
        && receipt.modelUsed.model === options.primary.model && receipt.status === "quality-refused").length;
      const reason = receipts.find((receipt) => receipt.fallbackReason)?.fallbackReason
        ?? receipts.find((receipt) => receipt.status === "failed")?.failureReason
        ?? (primaryQualityCalls >= options.primaryQualityAttempts ? "quality" : undefined);
      documents.set(docSha, { ...(reason ? { reason } : {}), counted: reason !== undefined,
        terminal: receipts.some((receipt) => receipt.terminalFailure), attempts: receipts.length, primaryQualityCalls });
    },
    forDocument(docSha, record) {
      let document = documents.get(docSha);
      if (!document) {
        document = { counted: false, attempts: 0, primaryQualityCalls: 0,
          ...(options.forceFallback ? { reason: "forced" as const }
            : circuitOpen ? { reason: "circuit-open" as const } : {}) };
        documents.set(docSha, document);
      }
      const selected = document;
      return {
        mode: "mesh",
        provider: options.primary.provider,
        model: options.primary.model,
        async generateJson(input) {
          options.signal?.throwIfAborted();
          if (selected.terminal) throw Object.assign(new Error("Refresh document has a terminal receipt"),
            { code: "REFRESH_TERMINAL_STATE" });
          const { outputPath, ...generationInput } = input;
          const attempt = async (model: RefreshModel, transition: RefreshModelTransition,
            fallbackReason?: RefreshFallbackReason) => {
            const attemptNumber = ++selected.attempts;
            const controller = new AbortController();
            const abort = () => controller.abort(options.signal?.reason);
            options.signal?.addEventListener("abort", abort, { once: true });
            const timeout = setTimeout(() => controller.abort(new DOMException("Refresh model timeout", "TimeoutError")),
              options.timeoutMs);
            let qualityRefused = false;
            let responseValidated = false;
            let terminalFailure = false;
            let text: string | undefined;
            let failed = false;
            let failure: unknown;
            let result: Awaited<ReturnType<TextJsonGenerationClient["generateJson"]>> | undefined;
            const startedAt = Date.now();
            let rejectDeadline: () => void = () => {};
            const deadline = new Promise<never>((_resolve, reject) => {
              rejectDeadline = () => reject(controller.signal.reason);
              controller.signal.addEventListener("abort", rejectDeadline, { once: true });
            });
            try {
              // Clients never write the shared output file: a late primary cannot overwrite fallback.
              result = await Promise.race([deadline, options.createClient(model, controller.signal).generateJson({ ...generationInput,
                async validateResponse(value) {
                  controller.signal.throwIfAborted();
                  if (!value.trim()) throw Object.assign(new Error("Empty refresh output"), { code: "REFRESH_EMPTY_OUTPUT" });
                  text = value;
                  try { await input.validateResponse?.(value); responseValidated = true; }
                  catch (error) { qualityRefused = true; throw error; }
                } })]);
              controller.signal.throwIfAborted();
              if (result.provider !== model.provider || result.model !== model.model) {
                terminalFailure = true;
                throw Object.assign(new Error("Refresh result identity mismatch"), { code: "REFRESH_MODEL_MISMATCH" });
              }
              if (result.status !== "completed") {
                terminalFailure = true;
                throw Object.assign(new Error("Refresh result is not completed"), { code: "REFRESH_INCOMPLETE_RESULT" });
              }
              if (text === undefined) {
                throw Object.assign(new Error("Refresh output incomplete"), { code: "REFRESH_EMPTY_OUTPUT" });
              }
            } catch (error) {
              if (responseValidated && !controller.signal.aborted) terminalFailure = true;
              failed = true; failure = error;
            }
            finally {
              clearTimeout(timeout);
              options.signal?.removeEventListener("abort", abort);
              controller.signal.removeEventListener("abort", rejectDeadline);
            }
            const reason = controller.signal.aborted ? "timeout" : refreshFallbackReason(failure);
            // Persistence errors are deliberately outside the transport catch.
            const modelUsed = result ? result.provider === model.provider && result.model === model.model
              ? { ...model, model: result.model } : null : model;
            await record({ modelUsed, status: qualityRefused ? "quality-refused" : failed ? "failed" : "completed",
              attempt: attemptNumber, transition,
              ...(terminalFailure ? { terminalFailure: true as const } : {}),
              ...(fallbackReason ? { fallbackReason } : {}),
              ...(failed && !qualityRefused ? { failureReason: reason } : {}), latencyMs: Date.now() - startedAt });
            options.signal?.throwIfAborted();
            return { failed, failure, qualityRefused, terminalFailure, reason, result, text };
          };
          const finish = async (attempted: Awaited<ReturnType<typeof attempt>>) => {
            if (outputPath) {
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, attempted.text!, "utf8");
            }
            return { ...attempted.result!, ...(outputPath ? { outputPath } : {}) };
          };
          if (!selected.reason) {
            let primary;
            do {
              primary = await attempt(options.primary,
                selected.primaryQualityCalls === 0 ? "primary" : "same-model-retry");
              if (!primary.failed) return finish(primary);
              if (!primary.qualityRefused || primary.terminalFailure) break;
              selected.primaryQualityCalls += 1;
            } while (selected.primaryQualityCalls < options.primaryQualityAttempts);
            if (primary.terminalFailure) throw primary.failure;
            selected.reason = primary.qualityRefused ? "quality" : primary.reason;
            if (!selected.counted) {
              selected.counted = true;
              consecutiveQuotaDocuments = primary.reason === "quota" ? consecutiveQuotaDocuments + 1 : 0;
              if (consecutiveQuotaDocuments >= 3) circuitOpen = true;
            }
          }
          const fallback = await attempt(options.fallback, "fallback", selected.reason);
          if (fallback.failed) throw fallback.failure;
          return finish(fallback);
        },
      };
    },
  };
}

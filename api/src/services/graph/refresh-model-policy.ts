import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TextJsonGenerationClient } from "@sentropic/graphify";

import type { RefreshProvider } from "./refresh-mesh.js";

export interface RefreshModel {
  readonly provider: RefreshProvider;
  readonly model: string;
  readonly effort: string;
}
export type RefreshFallbackReason = "quota" | "timeout" | "empty-output" | "transport" | "forced" | "circuit-open";
export interface RefreshModelReceipt {
  readonly modelUsed: RefreshModel | null;
  readonly status: "completed" | "failed" | "quality-refused";
  readonly fallbackReason?: RefreshFallbackReason;
  readonly failureReason?: RefreshFallbackReason;
  readonly latencyMs: number;
}
export interface RefreshModelPolicyOptions {
  readonly primary: RefreshModel;
  readonly fallback: RefreshModel;
  readonly forceFallback: boolean;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly createClient: (model: RefreshModel, signal: AbortSignal) => TextJsonGenerationClient;
}
export interface RefreshDocumentModels {
  readonly policy: string;
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

/** One instance per cycle. A fallback sticks to its document, never to a quality refusal. */
export function createRefreshModelPolicy(options: RefreshModelPolicyOptions): RefreshDocumentModels {
  let consecutiveQuotaDocuments = 0;
  let circuitOpen = false;
  const documents = new Map<string, { reason?: RefreshFallbackReason; counted: boolean }>();
  return {
    policy: JSON.stringify({ version: 1, primary: options.primary, fallback: options.fallback,
      forceFallback: options.forceFallback, quotaThreshold: 3 }),
    completeDocument(docSha) {
      const document = documents.get(docSha);
      if (document && !document.reason) consecutiveQuotaDocuments = 0;
    },
    restoreDocument(docSha, receipts) {
      const reason = receipts.find((receipt) => receipt.fallbackReason)?.fallbackReason
        ?? receipts.find((receipt) => receipt.status === "failed")?.failureReason;
      documents.set(docSha, { ...(reason ? { reason } : {}), counted: true });
    },
    forDocument(docSha, record) {
      let document = documents.get(docSha);
      if (!document) {
        document = { counted: false,
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
          const { outputPath, ...generationInput } = input;
          const attempt = async (model: RefreshModel, fallbackReason?: RefreshFallbackReason) => {
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
              if (result.status !== "completed" || text === undefined) {
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
            const primary = await attempt(options.primary);
            if (!primary.failed || primary.qualityRefused || primary.terminalFailure) {
              if (primary.failed) throw primary.failure;
              return finish(primary);
            }
            selected.reason = primary.reason;
            if (!selected.counted) {
              selected.counted = true;
              consecutiveQuotaDocuments = primary.reason === "quota" ? consecutiveQuotaDocuments + 1 : 0;
              if (consecutiveQuotaDocuments >= 3) circuitOpen = true;
            }
          }
          const fallback = await attempt(options.fallback, selected.reason);
          if (fallback.failed) throw fallback.failure;
          return finish(fallback);
        },
      };
    },
  };
}

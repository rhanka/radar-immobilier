import type { TextJsonGenerationClient } from "@sentropic/graphify";

import type { RefreshProvider } from "./refresh-mesh.js";

export interface RefreshModel {
  readonly provider: RefreshProvider;
  readonly model: string;
  readonly effort: string;
}
export type RefreshFallbackReason = "quota" | "timeout" | "empty-output" | "transport" | "forced" | "circuit-open";
export interface RefreshModelReceipt {
  readonly modelUsed: RefreshModel;
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
          const attempt = async (model: RefreshModel, fallbackReason?: RefreshFallbackReason) => {
            const controller = new AbortController();
            const abort = () => controller.abort(options.signal?.reason);
            options.signal?.addEventListener("abort", abort, { once: true });
            const timeout = setTimeout(() => controller.abort(new DOMException("Refresh model timeout", "TimeoutError")),
              options.timeoutMs);
            let qualityRefused = false;
            let responseValidated = false;
            let failed = false;
            let failure: unknown;
            let result: Awaited<ReturnType<TextJsonGenerationClient["generateJson"]>> | undefined;
            const startedAt = Date.now();
            try {
              result = await options.createClient(model, controller.signal).generateJson({ ...input,
                async validateResponse(text) {
                  if (!text.trim()) throw Object.assign(new Error("Empty refresh output"), { code: "REFRESH_EMPTY_OUTPUT" });
                  try { await input.validateResponse?.(text); responseValidated = true; }
                  catch (error) { qualityRefused = true; throw error; }
                } });
            } catch (error) {
              // The text client writes its output after validation. A local I/O failure is not a transport failure.
              if (responseValidated) throw error;
              failed = true; failure = error;
            }
            finally {
              clearTimeout(timeout);
              options.signal?.removeEventListener("abort", abort);
            }
            const reason = controller.signal.aborted ? "timeout" : refreshFallbackReason(failure);
            // Persistence errors are deliberately outside the transport catch.
            await record({ modelUsed: model, status: qualityRefused ? "quality-refused" : failed ? "failed" : "completed",
              ...(fallbackReason ? { fallbackReason } : {}),
              ...(failed && !qualityRefused ? { failureReason: reason } : {}), latencyMs: Date.now() - startedAt });
            options.signal?.throwIfAborted();
            return { failed, failure, qualityRefused, reason, result };
          };
          if (!selected.reason) {
            const primary = await attempt(options.primary);
            if (!primary.failed || primary.qualityRefused) {
              consecutiveQuotaDocuments = 0;
              if (primary.failed) throw primary.failure;
              return primary.result!;
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
          return fallback.result!;
        },
      };
    },
  };
}

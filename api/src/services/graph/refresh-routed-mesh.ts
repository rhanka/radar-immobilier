/**
 * Routed mesh for the refresh pipeline, built on the refresh llm-mesh alias.
 *
 * Port of `createGraphifyMesh` / `meshTextJsonClient` from
 * `@sentropic/engram/llm-mesh` (engram 0.21.2). engram declares
 * `@sentropic/llm-mesh` ^0.19 as a peer dependency, so its helpers cannot run
 * the refresh alias (llm-mesh 0.38.x, which adds the seat-backed `muse`
 * provider). The behaviour is kept identical: same route planning, same
 * failure classification, same validation-before-completion contract.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TextJsonGenerationClient } from "@sentropic/engram";
import {
  createDefaultProviderAdapters,
  createLlmMesh,
  normalizeProviderError,
  StaticProviderRegistry,
  type AuthResolver,
  type GenerateRequest,
  type GenerateResponse,
  type LlmMesh,
  type LlmMeshHooks,
  type NormalizedProviderError,
  type ProviderAdapter,
  type RouteAttemptUsage,
  type RouteFailureClassification,
  type RoutePlan,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh-refresh";

export type RefreshMeshResponseValidator = (response: GenerateResponse) => void | Promise<void>;

export interface RefreshRoutedMesh extends LlmMesh {
  generateValidated(request: GenerateRequest, validateResponse: RefreshMeshResponseValidator): Promise<GenerateResponse>;
}

export interface CreateRefreshRoutedMeshOptions {
  readonly routingSubject: VerifiedRoutingSubject;
  readonly adapters?: Partial<Record<string, ProviderAdapter>>;
  readonly authResolver?: AuthResolver;
  readonly hooks?: LlmMeshHooks;
  readonly createRoutePlanner: (runtime: Pick<LlmMesh, "generate" | "stream">) => RoutePlanner;
}

const requireAuthResolver: AuthResolver = (request) => {
  throw new Error(
    `Refresh mesh: no authResolver configured for provider '${request.providerId}'.`,
  );
};

const routeIntents = new Set(["coding", "general", "reasoning", "fast"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function hasAbortShape(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record["name"] === "AbortError") return true;
  return hasAbortShape(record["cause"], seen) || hasAbortShape(record["reason"], seen);
}

/** Same taxonomy as engram 0.21.2 `classifyRouteFailure`. */
export function classifyRouteFailure(error: NormalizedProviderError, signal?: AbortSignal): RouteFailureClassification {
  const code = error.code?.toLowerCase();
  const statusCode = error.statusCode;
  const carriesProviderEvidence = statusCode !== undefined || code !== undefined;
  if (hasAbortShape(error.cause) || (signal?.aborted && !carriesProviderEvidence)) {
    return { reason: "cancelled", retryable: false, healthScope: "route" };
  }
  if (error.retryReason === "network" || code === "enotfound" || code === "econnreset"
    || code === "econnrefused" || code === "fetch_error" || code?.includes("network")) {
    return { reason: "network-unavailable", retryable: true, healthScope: "transport" };
  }
  if (error.retryReason === "server_error" || error.retryReason === "overloaded"
    || (typeof statusCode === "number" && statusCode >= 500 && statusCode <= 599)) {
    return { reason: "provider-5xx", retryable: true, healthScope: "provider-model" };
  }
  if (error.retryReason === "timeout" || statusCode === 408 || code?.includes("timeout") || code === "etimedout") {
    return { reason: "provider-5xx", retryable: true, healthScope: "provider-model" };
  }
  if (error.retryReason === "rate_limit" || statusCode === 429 || code?.includes("rate_limit")) {
    return {
      reason: "rate-limited",
      retryable: true,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      healthScope: "account",
    };
  }
  if (code?.includes("reauth") || code?.includes("reenroll") || code?.includes("re-enroll")) {
    return { reason: "reauth-required", retryable: false, healthScope: "account" };
  }
  if (statusCode === 401 || statusCode === 403 || code === "unauthorized" || code === "forbidden" || code === "invalid_api_key") {
    return { reason: "auth-failed", retryable: false, healthScope: "account" };
  }
  return { reason: "invalid-request", retryable: false, healthScope: "route" };
}

function requestedModel(request: GenerateRequest): string {
  const record = request as unknown as Record<string, unknown>;
  if (typeof record["modelId"] === "string" && record["modelId"]) return record["modelId"];
  const model = record["model"];
  if (model && typeof model === "object") return String((model as Record<string, unknown>)["modelId"]);
  if (typeof model === "string") {
    const separator = model.indexOf(":");
    return separator >= 0 ? model.slice(separator + 1) : model;
  }
  throw new Error("Refresh mesh: a requested model is required. Pass request.modelId or request.model.");
}

function routePlanInput(request: GenerateRequest) {
  const metadata = (request as unknown as Record<string, unknown>)["metadata"] as
    | { attributes?: Record<string, unknown>; workspaceId?: string }
    | undefined;
  const rawIntent = metadata?.attributes?.["intent"];
  const rawAffinityKey = metadata?.attributes?.["affinityKey"];
  const intent = typeof rawIntent === "string" && routeIntents.has(rawIntent) ? rawIntent : undefined;
  const workspaceId = metadata?.workspaceId?.trim() || undefined;
  const affinityKey = typeof rawAffinityKey === "string" && rawAffinityKey.trim() ? rawAffinityKey.trim() : undefined;
  return {
    requestedModel: requestedModel(request),
    ...(intent ? { intent } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(affinityKey ? { affinityKey } : {}),
  } as Parameters<RoutePlanner["plan"]>[1];
}

function requestProviderId(request: GenerateRequest, plan: RoutePlan, candidateRef: string): string {
  const planned = plan.diagnostics.find((diagnostic) => diagnostic.candidateRef === candidateRef)?.actualProviderId;
  if (planned) return planned;
  const record = request as unknown as Record<string, unknown>;
  if (typeof record["providerId"] === "string" && record["providerId"]) return record["providerId"];
  const model = record["model"];
  if (model && typeof model === "object") return String((model as Record<string, unknown>)["providerId"]);
  if (typeof model === "string") {
    const [providerId] = model.split(":", 1);
    if (providerId) return providerId;
  }
  return "local";
}

function isNormalizedProviderError(error: unknown): error is NormalizedProviderError {
  const record = asRecord(error);
  return Boolean(record && typeof record["providerId"] === "string"
    && typeof record["message"] === "string" && typeof record["retryable"] === "boolean");
}

function routeAttemptUsage(response: GenerateResponse): RouteAttemptUsage | undefined {
  const { inputTokens, outputTokens } = response.usage ?? {};
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens, estimated: false } as RouteAttemptUsage;
}

class MeshResponseValidationFailure extends Error {
  constructor(readonly validationError: unknown, readonly usage: RouteAttemptUsage | undefined) {
    super("Refresh mesh response validation failed", { cause: validationError });
    this.name = "MeshResponseValidationFailure";
  }
}

class MeshRequestCancellation extends Error {
  constructor(readonly reason: unknown) {
    super("Refresh mesh request was cancelled", { cause: reason });
    this.name = "MeshRequestCancellation";
  }
}

/** Invalid response: terminal for this candidate, scoped to the route, remaining candidates allowed. */
const invalidResponseClassification: RouteFailureClassification = {
  reason: "invalid-request",
  retryable: true,
  healthScope: "route",
};

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

export function createRefreshRoutedMesh(options: CreateRefreshRoutedMeshOptions): RefreshRoutedMesh {
  const overrides = options.adapters ?? {};
  const merged: ProviderAdapter[] = createDefaultProviderAdapters().map(
    (adapter) => overrides[adapter.provider.providerId] ?? adapter,
  );
  for (const [providerId, adapter] of Object.entries(overrides)) {
    if (!adapter) continue;
    if (!merged.some((existing) => existing.provider.providerId === providerId)) merged.push(adapter);
  }
  const runtime = createLlmMesh({
    registry: new StaticProviderRegistry(merged),
    authResolver: options.authResolver ?? requireAuthResolver,
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });
  const planner = options.createRoutePlanner(runtime);

  const generateRouted = async (
    request: GenerateRequest,
    validateResponse?: RefreshMeshResponseValidator,
  ): Promise<GenerateResponse> => {
    if (request.signal?.aborted) throw abortReason(request.signal);
    const plan = await planner.plan(options.routingSubject, routePlanInput(request));
    const metadata = (request as unknown as Record<string, unknown>)["metadata"] as { correlationId?: string } | undefined;
    const requestId = metadata?.correlationId?.trim() || randomUUID();
    for (const [attemptIndex, candidateRef] of plan.candidateRefs.entries()) {
      const attempt = await planner.prepareAttempt(options.routingSubject, plan.planRef, candidateRef, requestId, attemptIndex);
      if (request.signal?.aborted) {
        await attempt.releaseCancelled();
        throw abortReason(request.signal);
      }
      let completionStarted = false;
      try {
        const response = await attempt.generate(request);
        if (request.signal?.aborted) throw new MeshRequestCancellation(abortReason(request.signal));
        const usage = routeAttemptUsage(response);
        if (validateResponse) {
          try {
            await validateResponse(response);
          } catch (error) {
            if (request.signal?.aborted) throw new MeshRequestCancellation(abortReason(request.signal));
            throw new MeshResponseValidationFailure(error, usage);
          }
        }
        if (request.signal?.aborted) throw new MeshRequestCancellation(abortReason(request.signal));
        completionStarted = true;
        await attempt.complete(usage);
        return response;
      } catch (error) {
        if (completionStarted) throw error;
        if (error instanceof MeshRequestCancellation) {
          await attempt.releaseCancelled();
          throw error.reason;
        }
        const validationFailure = error instanceof MeshResponseValidationFailure ? error : undefined;
        const classification = validationFailure ? invalidResponseClassification : classifyRouteFailure(
          isNormalizedProviderError(error) ? error : normalizeProviderError(requestProviderId(request, plan, candidateRef) as Parameters<typeof normalizeProviderError>[0], error),
          request.signal,
        );
        if (classification.reason === "cancelled") {
          await attempt.releaseCancelled();
          throw request.signal?.aborted ? abortReason(request.signal) : error;
        } else if (validationFailure) {
          await attempt.recordOutcome(classification, validationFailure.usage);
        } else {
          await attempt.recordOutcome(classification);
        }
        const hasMoreCandidates = attemptIndex + 1 < plan.candidateRefs.length;
        if (!classification.retryable || !hasMoreCandidates) throw validationFailure?.validationError ?? error;
      }
    }
    throw new Error("Refresh mesh: route planner returned no candidates");
  };

  return {
    listProviders: runtime.listProviders,
    listModels: runtime.listModels,
    generate: (request) => generateRouted(request),
    generateValidated: (request, validateResponse) => generateRouted(request, validateResponse),
    async stream() {
      throw new Error("Refresh mesh: routed streaming is not supported yet");
    },
  } as RefreshRoutedMesh;
}

export interface RefreshTextJsonClientOptions {
  readonly provider: string;
  readonly model: string;
}

/** Same contract as engram 0.21.2 `meshTextJsonClient`, typed on the refresh mesh. */
export function refreshTextJsonClient(mesh: RefreshRoutedMesh, options: RefreshTextJsonClientOptions): TextJsonGenerationClient {
  if (!options?.provider) throw new Error("refreshTextJsonClient: an explicit provider is required.");
  if (!options.model) throw new Error("refreshTextJsonClient: an explicit model is required.");
  const { provider, model } = options;
  const client = {
    mode: "mesh" as const,
    provider,
    model,
    async generateJson(input: {
      schema: string;
      prompt: string;
      maxOutputTokens?: number;
      outputPath?: string;
      validateResponse?: (text: string) => void | Promise<void>;
    }) {
      const request = {
        providerId: provider,
        modelId: model,
        messages: [
          {
            role: "system",
            content: "You are Engram's JSON extraction backend. Return only valid JSON matching the requested schema. Do not include Markdown prose outside the JSON object.",
          },
          { role: "user", content: [`Schema: ${input.schema}`, "", input.prompt].join("\n") },
        ],
        responseFormat: { type: "json-object" },
        ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      } as unknown as GenerateRequest;
      const response = input.validateResponse
        ? await mesh.generateValidated(request, (generated) => input.validateResponse!(generated.text ?? ""))
        : await mesh.generate(request);
      const text = response.text ?? "";
      if (input.outputPath) {
        mkdirSync(dirname(input.outputPath), { recursive: true });
        writeFileSync(input.outputPath, text, "utf-8");
      }
      return {
        status: "completed",
        provider,
        mode: "mesh",
        model,
        ...(input.outputPath ? { outputPath: input.outputPath } : {}),
        audit: { mesh: true, providerId: provider, modelId: model },
      };
    },
  };
  return client as unknown as TextJsonGenerationClient;
}

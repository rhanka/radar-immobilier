/**
 * SEAT-AVAILABILITY PROBE for the recurring abandoned-stock requeue.
 *
 * llm-mesh 0.19.2 (the installed `@sentropic/llm-mesh-refresh` alias) exposes
 * NO quota / account-availability API: only `generate`, `listProviders` and
 * `listModels` on the mesh. The probe is therefore a MINIMAL generation —
 * one tiny `generateJson` call (prompt "ping", 16 output tokens, one route
 * attempt) through the same `createRefreshMesh` cascade wiring as
 * `refresh-pv` — never a document. Routes are tried in cascade order
 * (primary, then fallback) and the seat is available when ANY route answers.
 * Errors are classified with the existing refresh classifiers
 * (`refreshFallbackReason`, `isRefreshNoRoute`); no upstream message, token
 * or response body is ever logged.
 */

import type { TextJsonGenerationClient } from "@sentropic/engram";

import { isRefreshNoRoute, refreshFallbackReason } from "./refresh-model-policy.js";
import type { RefreshModel } from "./refresh-model-policy.js";

export type RefreshSeatReason = "ok" | "quota" | "no-route" | "timeout" | "transport" | "empty-output";

export interface RefreshSeatRouteResult {
  readonly provider: string;
  readonly model: string;
  readonly available: boolean;
  readonly reason: RefreshSeatReason;
  readonly latencyMs: number;
}

export interface RefreshSeatProbeResult {
  readonly available: boolean;
  /** Structured skip reason when no route answered. */
  readonly reason: RefreshSeatReason;
  readonly routes: readonly RefreshSeatRouteResult[];
  readonly latencyMs: number;
}

export function classifySeatError(error: unknown): RefreshSeatReason {
  if (isRefreshNoRoute(error)) return "no-route";
  const reason = refreshFallbackReason(error);
  return reason === "quality" || reason === "forced" || reason === "circuit-open" ? "transport" : reason;
}

/** One minimal probe call. Never carries a document. */
export async function probeOneRoute(
  client: TextJsonGenerationClient,
  model: RefreshModel,
  now: () => number = Date.now,
): Promise<RefreshSeatRouteResult> {
  const started = now();
  try {
    await client.generateJson({
      prompt: "ping",
      schema: JSON.stringify({ type: "object" }),
      maxOutputTokens: 16,
      validateResponse: () => undefined,
    });
    return { provider: model.provider, model: model.model, available: true, reason: "ok", latencyMs: now() - started };
  } catch (error) {
    return { provider: model.provider, model: model.model, available: false,
      reason: classifySeatError(error), latencyMs: now() - started };
  }
}

/**
 * Probe the cascade in order; stop at the first answering route.
 * `createClient` is the same factory `refresh-pv` uses (`createRefreshMesh`).
 */
export async function probeRefreshSeat(options: {
  readonly routes: readonly RefreshModel[];
  readonly createClient: (model: RefreshModel) => TextJsonGenerationClient;
  readonly now?: () => number;
}): Promise<RefreshSeatProbeResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const routes: RefreshSeatRouteResult[] = [];
  for (const model of options.routes) {
    const result = await probeOneRoute(options.createClient(model), model, now);
    routes.push(result);
    if (result.available) return { available: true, reason: "ok", routes, latencyMs: now() - started };
  }
  return { available: false, reason: routes.at(-1)?.reason ?? "transport", routes, latencyMs: now() - started };
}

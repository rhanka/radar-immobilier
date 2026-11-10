/**
 * refresh-requeue-recurrent — DAILY catch-up of the `abandoned` stock,
 * part of the regular refresh ecosystem (CronJob
 * `radar-refresh-requeue-abandoned`, see
 * `deploy/k8s/refresh-cronjobs/requeue-recurrent/`).
 *
 * One run does exactly three things:
 *   1. seat check — a minimal llm-mesh probe of the refresh cascade
 *      (primary, then fallback; see `refresh-seat-probe.ts`: llm-mesh
 *      0.19.2 has no quota/availability API, so the probe is one tiny
 *      generation, never a document);
 *   2. if a seat answers, requeue `abandoned` -> `pending` under the
 *      ceilings below, through `refresh-coverage.ts` only;
 *   3. nothing else — the regular `radar-refresh-pv` passes process the
 *      requeued `pending` entries (one document per city per pass).
 *
 * If no seat answers, the run SKIPS: it logs one structured JSON line
 * (`decision: "skip"`, classified reason) and exits 0 — a dry seat is an
 * expected state, not a failed Job. Requeue ceilings (env, with defaults):
 * `REQUEUE_MAX_AGE_DAYS=90`, `REQUEUE_MAX_PER_RUN=50`,
 * `REQUEUE_MAX_PER_CITY=5`, `REQUEUE_MAX_REQUEUES=2` (a document requeued
 * that many times without success stays `abandoned`, stamped
 * `requeue-ceiling-exceeded`).
 *
 * Concurrency: run under the SAME flock as a refresh pass
 * (`flock -n /keyring/runtime/.refresh.lock`, wired in the CronJob
 * manifest) and `concurrencyPolicy: Forbid` on the CronJob — never two
 * requeues at once, never a requeue racing a pass. Idempotent: a second
 * run over the same stock requeues nothing new.
 */

import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

import { loadConfig } from "../config.js";
import { createRefreshMesh } from "../services/graph/refresh-mesh.js";
import type { RefreshModel } from "../services/graph/refresh-model-policy.js";
import { runRefreshRequeueAbandoned } from "../services/graph/refresh-requeue.js";
import { probeRefreshSeat, type RefreshSeatProbeResult } from "../services/graph/refresh-seat-probe.js";
import { getScrapeObjectStore } from "../storage/s3-object-store.js";

export interface RefreshRequeueRecurrentConfig {
  readonly maxAgeDays: number;
  readonly maxPerRun: number;
  readonly maxPerCity: number;
  readonly maxRequeues: number;
  readonly dryRun: boolean;
}

function positiveEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, maximum: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

export function recurrentConfigFromEnv(env: NodeJS.ProcessEnv): RefreshRequeueRecurrentConfig {
  return {
    maxAgeDays: positiveEnv(env, "REQUEUE_MAX_AGE_DAYS", 90, 3650),
    maxPerRun: positiveEnv(env, "REQUEUE_MAX_PER_RUN", 50, 100_000),
    maxPerCity: positiveEnv(env, "REQUEUE_MAX_PER_CITY", 5, 10_000),
    maxRequeues: positiveEnv(env, "REQUEUE_MAX_REQUEUES", 2, 100),
    dryRun: env.REQUEUE_DRY_RUN === "1",
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function selectedModel(env: NodeJS.ProcessEnv, prefix: string): RefreshModel {
  const provider = required(env, `${prefix}_PROVIDER`);
  if (provider !== "openai" && provider !== "gemini") throw new Error(`${prefix}_PROVIDER must be openai or gemini`);
  const effort = required(env, `${prefix}_REASONING_EFFORT`);
  if (!["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error(`${prefix}_REASONING_EFFORT is invalid`);
  }
  return { provider, model: required(env, `${prefix}_MODEL`), effort };
}

/** Structured skip line: a dry seat is logged, never thrown. */
export function seatSkipLine(seat: RefreshSeatProbeResult): string {
  return JSON.stringify({ kind: "refresh-requeue-recurrent", decision: "skip",
    reason: seat.reason, seat });
}

async function main(): Promise<void> {
  const env = process.env;
  const config = recurrentConfigFromEnv(env);
  const routes = [selectedModel(env, "REFRESH"), selectedModel(env, "REFRESH_FALLBACK")];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("seat probe timeout")), 120_000);
  timeout.unref();
  let seat: RefreshSeatProbeResult;
  try {
    seat = await probeRefreshSeat({
      routes,
      createClient: (model) => createRefreshMesh({
        routingSubject: { principalRef: required(env, "REFRESH_PRINCIPAL_REF"),
          ownerScopeRef: required(env, "REFRESH_OWNER_SCOPE_REF") },
        configResolver: { async resolveConfig() { return {}; } },
        keyring: new EncryptedFileKeyring(required(env, "SENTROPIC_LLM_MESH_KEYRING_DIR")),
        provider: model.provider, model: model.model,
        reasoning: { effort: model.effort as "low" },
        maximumAttempts: 1, signal: controller.signal,
      }).textClient,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!seat.available) {
    console.log(seatSkipLine(seat));
    return;
  }
  const store = getScrapeObjectStore(loadConfig());
  const trace = await runRefreshRequeueAbandoned(store, {
    who: "cronjob:radar-refresh-requeue-abandoned", dryRun: config.dryRun,
    maxAgeDays: config.maxAgeDays, maxPerRun: config.maxPerRun,
    maxPerCity: config.maxPerCity, maxRequeues: config.maxRequeues,
  });
  console.log(JSON.stringify({ kind: "refresh-requeue-recurrent", decision: "requeue", seat, trace }));
}

const isMain = process.argv[1]?.endsWith("refresh-requeue-recurrent.js")
  || process.argv[1]?.endsWith("refresh-requeue-recurrent.ts")
  || process.argv[1]?.endsWith("requeue-recurrent.bundle.mjs");
if (isMain) {
  main().catch((error: unknown) => {
    console.error("refresh-requeue-recurrent: failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

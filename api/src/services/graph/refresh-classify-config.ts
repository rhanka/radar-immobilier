import type { RefreshModel } from "./refresh-model-policy.js";
import { singlePassEnabled } from "./refresh-single-pass.js";

export type RefreshClassifyMode = "off" | "two-step" | "single-pass";

/** An explicit mode wins over the deprecated binary switch. */
export function refreshClassifyMode(env: NodeJS.ProcessEnv = process.env): RefreshClassifyMode {
  const mode = env.REFRESH_CLASSIFY_MODE;
  if (mode === undefined) return singlePassEnabled(env.REFRESH_SINGLE_PASS) ? "single-pass" : "off";
  if (mode === "off" || mode === "two-step" || mode === "single-pass") return mode;
  throw new Error("REFRESH_CLASSIFY_MODE must be off, two-step or single-pass");
}

function model(env: NodeJS.ProcessEnv, prefix: string, defaults: RefreshModel): RefreshModel {
  const provider = env[`${prefix}_PROVIDER`] ?? defaults.provider;
  const name = env[`${prefix}_MODEL`] ?? defaults.model;
  const effort = env[`${prefix}_REASONING_EFFORT`] ?? defaults.effort;
  if ((provider !== "openai" && provider !== "gemini" && provider !== "muse") || !name.trim()
    || !["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error(`Invalid ${prefix} model configuration`);
  }
  return { provider, model: name, effort };
}

export const DEFAULT_REFRESH_CLASSIFY_RETRY_LIMIT = 20;
export const DEFAULT_REFRESH_CLASSIFY_RETRY_WINDOW_DAYS = 31;

function boundedInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** Classification settings never affect detection B or its verification policy. */
export function refreshClassifyConfig(env: NodeJS.ProcessEnv = process.env) {
  const concurrency = Number(env.REFRESH_CLASSIFY_CONCURRENCY ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("REFRESH_CLASSIFY_CONCURRENCY must be an integer from 1 to 16");
  }
  const retryLimit = boundedInt(env, "REFRESH_CLASSIFY_RETRY_LIMIT", DEFAULT_REFRESH_CLASSIFY_RETRY_LIMIT, 0, 500);
  const retryWindowDays = boundedInt(env, "REFRESH_CLASSIFY_RETRY_WINDOW_DAYS",
    DEFAULT_REFRESH_CLASSIFY_RETRY_WINDOW_DAYS, 1, 365);
  return {
    primary: model(env, "REFRESH_CLASSIFY", { provider: "openai", model: "gpt-6-astra", effort: "low" }),
    fallback: model(env, "REFRESH_CLASSIFY_FALLBACK", { provider: "gemini", model: "gemini-3.8-flash", effort: "low" }),
    concurrency,
    retryLimit,
    retryWindowDays,
  };
}

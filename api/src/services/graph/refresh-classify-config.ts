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
  if ((provider !== "openai" && provider !== "gemini") || !name.trim()
    || !["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error(`Invalid ${prefix} model configuration`);
  }
  return { provider, model: name, effort };
}

/** Classification settings never affect detection B or its verification policy. */
export function refreshClassifyConfig(env: NodeJS.ProcessEnv = process.env) {
  const concurrency = Number(env.REFRESH_CLASSIFY_CONCURRENCY ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("REFRESH_CLASSIFY_CONCURRENCY must be an integer from 1 to 16");
  }
  return {
    primary: model(env, "REFRESH_CLASSIFY", { provider: "openai", model: "gpt-6-astra", effort: "low" }),
    fallback: model(env, "REFRESH_CLASSIFY_FALLBACK", { provider: "gemini", model: "gemini-3.8-flash", effort: "low" }),
    concurrency,
  };
}

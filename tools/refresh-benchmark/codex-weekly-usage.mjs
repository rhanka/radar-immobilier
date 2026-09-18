// Weekly Codex seat counter, read from chatgpt.com/backend-api/wham/usage with the owner-scoped
// llm-mesh enrollment - the same source and auth as codex-preflight.mjs (benchmark Codex burn).
// Read-only quota request, never a generation. Only quota fields leave this module: no token, no
// account identifier. Runs inside the benchmark container (llm-mesh at /workspace/node_modules).

import { pathToFileURL } from "node:url";

export const WEEK_SECONDS = 604_800;

// The weekly window is the one whose limit_window_seconds is 7 days; primary/secondary naming is
// not relied upon. Returns null when no such window exposes a numeric used_percent.
export function weeklyWindow(payload) {
  const limits = payload?.rate_limit;
  if (!limits || typeof limits !== "object") return null;
  for (const [name, window] of Object.entries(limits)) {
    if (!window || typeof window !== "object") continue;
    if (window.limit_window_seconds === WEEK_SECONDS && typeof window.used_percent === "number") {
      return { window: name, usedPercent: window.used_percent, limitWindowSeconds: WEEK_SECONDS,
        resetAt: window.reset_at ?? null, limitReached: limits.limit_reached === true };
    }
  }
  return null;
}

export function quotaShape(payload) {
  const limits = payload?.rate_limit ?? {};
  return { planType: payload?.plan_type ?? null, limitReached: limits.limit_reached ?? null,
    windows: Object.fromEntries(Object.entries(limits).filter(([, value]) => value && typeof value === "object")
      .map(([name, value]) => [name, { used_percent: value.used_percent ?? null,
        limit_window_seconds: value.limit_window_seconds ?? null, reset_at: value.reset_at ?? null }])) };
}

export async function readCodexWeekly({ ownerScope = process.env.BENCHMARK_OWNER_SCOPE } = {}) {
  if (!ownerScope) throw new Error("BENCHMARK_OWNER_SCOPE is required");
  const { createLlmMeshFacade } = await import("/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js");
  const { EncryptedFileKeyring } = await import("/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js");
  const facade = createLlmMeshFacade({ mode: "cli", configResolver: { async resolveConfig() { return {}; } },
    keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
  const accounts = (await facade.listAccounts({ ownerScope })).filter(({ providerId }) => providerId === "codex");
  if (accounts.length !== 1) throw new Error(`expected one Codex enrollment, found ${accounts.length}`);
  const acquisition = await facade.acquire({ accountId: accounts[0].accountId, ownerScopeRef: ownerScope,
    targetProviderId: "openai", transportProviderId: "codex", modelId: "gpt-6-astra",
    affinityKey: "oracle-v3-quota", requestId: `oracle-v3-quota-${Date.now()}` });
  try {
    const auth = acquisition.material;
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers: {
      authorization: `Bearer ${auth.accessToken}`, accept: "application/json",
      originator: "radar-refresh-benchmark", "user-agent": "@sentropic/llm-mesh-refresh-benchmark",
      ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}) } });
    const payload = await response.json().catch(() => null);
    return { at: new Date().toISOString(), httpStatus: response.status, weekly: weeklyWindow(payload),
      shape: quotaShape(payload) };
  } finally { await facade.release(acquisition); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await readCodexWeekly()));
}

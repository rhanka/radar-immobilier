import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createLlmMeshFacade } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/service/facade.js";
import { EncryptedFileKeyring } from "/workspace/node_modules/@sentropic/llm-mesh-refresh/dist/node/index.js";

const ownerScope = process.env.BENCHMARK_OWNER_SCOPE;
if (!ownerScope) throw new Error("BENCHMARK_OWNER_SCOPE is required");

const facade = createLlmMeshFacade({
  mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring"),
});
const accounts = await facade.listAccounts({ ownerScope });
const eligible = accounts.filter((account) => account.providerId === "codex");
if (eligible.length !== 1) throw new Error(`Expected one owner-scoped Codex enrollment, found ${eligible.length}`);
const codex = eligible[0];

const acquisition = await facade.acquire({
  accountId: codex.accountId,
  ownerScopeRef: ownerScope,
  targetProviderId: "openai",
  transportProviderId: "codex",
  modelId: process.env.BENCHMARK_MODEL ?? "gpt-5.6-sol",
  affinityKey: "refresh-benchmark-preflight",
  requestId: `preflight-${Date.now()}`,
});

const auth = acquisition.material;
const headers = {
  authorization: `Bearer ${auth.accessToken}`,
  accept: "application/json",
  originator: "radar-refresh-benchmark",
  "user-agent": "@sentropic/llm-mesh-refresh-benchmark",
  ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
};
const collectModels = (value, output = new Set()) => {
  if (typeof value === "string" && /^(?:gpt|codex)-/i.test(value)) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectModels(item, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectModels(item, output));
  }
  return [...output].sort();
};
const quotaKeys = /limit|used|reset|window|percent|plan|credit|remaining|status/i;
const selectQuota = (value) => {
  if (Array.isArray(value)) return value.map(selectQuota);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => quotaKeys.test(key))
    .map(([key, item]) => [key, selectQuota(item)]));
};
const request = async (url) => {
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
};

try {
  const [usage, models] = await Promise.all([
    request("https://chatgpt.com/backend-api/wham/usage"),
    request("https://chatgpt.com/backend-api/codex/models?client_version=0.154.0"),
  ]);
  const usedPercent = usage.payload?.rate_limit?.primary_window?.used_percent;
  if (usage.payload?.plan_type !== "pro") throw new Error("Codex account is not the qualified subscription plan");
  if (usage.payload?.rate_limit?.limit_reached || typeof usedPercent !== "number" || usedPercent > 70) {
    throw new Error("Insufficient or ambiguous Codex subscription quota");
  }
  const result = {
    capturedAt: new Date().toISOString(),
    accountPseudonym: `acct-${createHash("sha256").update(codex.accountId).digest("hex").slice(0, 10)}`,
    eligibleAccountCount: eligible.length,
    quota: { status: usage.status, ok: usage.ok, values: selectQuota(usage.payload) },
    catalog: { status: models.status, ok: models.ok, modelIds: collectModels(models.payload) },
  };
  if (!result.catalog.modelIds.includes(process.env.BENCHMARK_MODEL ?? "gpt-5.6-sol")) {
    throw new Error("Requested model is absent from the live subscription catalog");
  }
  if (process.env.BENCHMARK_PREFLIGHT_OUTPUT) {
    await writeFile(process.env.BENCHMARK_PREFLIGHT_OUTPUT, JSON.stringify(result), { flag: "wx" });
  }
  console.log(JSON.stringify(result));
} finally {
  await facade.release(acquisition);
}

import { createHash } from "node:crypto";
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
const codex = accounts.find((account) => account.providerId === "codex");
if (!codex) throw new Error("No owner-scoped Codex enrollment is available");

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
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    accountPseudonym: `acct-${createHash("sha256").update(codex.accountId).digest("hex").slice(0, 10)}`,
    quota: { status: usage.status, ok: usage.ok, values: selectQuota(usage.payload) },
    catalog: { status: models.status, ok: models.ok, modelIds: collectModels(models.payload) },
  }, null, 2));
} finally {
  await facade.release(acquisition);
}

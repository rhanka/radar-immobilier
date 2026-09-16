#!/usr/bin/env node

import { writeFile } from "node:fs/promises";

import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";

const ownerScope = process.env.BENCHMARK_OWNER_SCOPE;
const output = process.env.BENCHMARK_QUOTA_OUTPUT;
if (!ownerScope || !output) throw new Error("BENCHMARK_OWNER_SCOPE and BENCHMARK_QUOTA_OUTPUT are required");

const facade = createLlmMeshFacade({
  mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring"),
});
const accounts = (await facade.listAccounts({ ownerScope }))
  .filter(({ providerId }) => providerId === "cloud-code");
if (accounts.length !== 1) throw new Error(`Expected one Cloud Code enrollment, found ${accounts.length}`);

const acquisition = await facade.acquire({
  accountId: accounts[0].accountId,
  ownerScopeRef: ownerScope,
  targetProviderId: "gemini",
  transportProviderId: "cloud-code",
  modelId: "gemini-3.8-flash-tiered",
  affinityKey: "refresh-benchmark-seat-quota",
  requestId: `seat-quota-${Date.now()}`,
});

const auth = acquisition.material;
const project = auth.metadata?.cloudaicompanionProject;
if (!auth.accessToken || typeof project !== "string" || !project.trim()) {
  throw new Error("Cloud Code acquisition lacks access token or project metadata");
}
const headers = {
  authorization: `Bearer ${auth.accessToken}`,
  "content-type": "application/json",
  "user-agent": "antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)",
  "x-goog-api-client": "gl-node/22.0.0 antigravity/0.1.0",
  "client-metadata": JSON.stringify({
    ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "ANTIGRAVITY",
  }),
};

const finite = (value) => Number.isFinite(value) ? Number(value) : null;
const safeTier = (tier) => tier && typeof tier === "object"
  ? { id: typeof tier.id === "string" ? tier.id : null,
    availableCreditsCount: Array.isArray(tier.availableCredits) ? tier.availableCredits.length : null }
  : null;
const safeBucket = (bucket) => ({
  modelId: typeof bucket?.modelId === "string" ? bucket.modelId : null,
  remainingFraction: finite(bucket?.remainingFraction),
  remainingAmount: finite(bucket?.remainingAmount),
  resetAt: typeof bucket?.resetTime === "string" ? bucket.resetTime : null,
});
const post = async (endpoint, body) => {
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { response, payload };
};

try {
  const [assist, quota] = await Promise.all([
    post("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
      cloudaicompanionProject: project,
      metadata: { ideType: "ANTIGRAVITY" },
      mode: "HEALTH_CHECK",
    }),
    post("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", { project }),
  ]);
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    networkRequests: 2,
    loadCodeAssist: {
      status: assist.response.status,
      currentTier: safeTier(assist.payload?.currentTier),
      paidTier: safeTier(assist.payload?.paidTier),
    },
    retrieveUserQuota: {
      status: quota.response.status,
      buckets: Array.isArray(quota.payload?.buckets)
        ? quota.payload.buckets.map(safeBucket).filter(({ modelId }) => modelId).sort((a, b) =>
          a.modelId.localeCompare(b.modelId)) : [],
    },
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await facade.release(acquisition);
}

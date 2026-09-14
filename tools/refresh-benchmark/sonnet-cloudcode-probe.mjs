import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { CloudCodeRuntimeClient } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/index.js";
import { createLlmMeshFacade } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/service/facade.js";
import { EncryptedFileKeyring } from
  "/workspace/node_modules/@sentropic/llm-mesh/dist/node/index.js";

// The v12 Cloud Code campaign answered HTTP 400 on all five documents while the 64-token
// ping answered 200. This probe isolates one request dimension at a time and keeps the
// provider error body, which CloudCodeRuntimeClient collapses into "HTTP error (400)".
const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sanitize = (value) => String(value ?? "N-A").slice(0, 2000)
  .replace(/sk-ant-[A-Za-z0-9_-]+/gu, "[REDACTED]")
  .replace(/(Bearer\s+)\S+/giu, "$1[REDACTED]")
  .replace(/ya29\.[A-Za-z0-9._-]+/gu, "[REDACTED]");
const outputPath = required("BENCHMARK_PROBE_OUTPUT");
const ownerScope = required("BENCHMARK_OWNER_SCOPE");
const maxOutputTokens = Number(required("BENCHMARK_PROBE_MAX_OUTPUT_TOKENS"));
const withSystem = process.env.BENCHMARK_PROBE_SYSTEM === "1";
const withEffort = process.env.BENCHMARK_PROBE_EFFORT !== "0";
const model = "claude-sonnet-4-6";

const facade = createLlmMeshFacade({ mode: "cli",
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring("/run/benchmark-keyring") });
const accounts = await facade.listAccounts({ ownerScope });
const eligible = accounts.filter(({ providerId }) => providerId === "cloud-code");
if (eligible.length !== 1) throw new Error(`Expected one Cloud Code enrollment, found ${eligible.length}`);
const account = eligible[0];
const acquisition = await facade.acquire({ accountId: account.accountId,
  ownerScopeRef: ownerScope, targetProviderId: "gemini", transportProviderId: "cloud-code",
  modelId: model, affinityKey: "refresh-benchmark-sonnet-probe",
  requestId: `sonnet-probe-${Date.now()}` });

let wire = null;
let errorBody = null;
let actual = null;
let error = null;
const observedFetch = async (url, init) => {
  const bodyText = String(init?.body ?? "");
  const body = JSON.parse(bodyText);
  const response = await fetch(url, init);
  wire = { endpoint: String(url), httpStatus: response.status,
    requestBodySha256: sha256(bodyText), model: body.model ?? null,
    providerEffort: body.request?.generationConfig?.thinkingConfig?.thinkingLevel ?? null,
    maxOutputTokens: body.request?.generationConfig?.maxOutputTokens ?? null,
    hasSystemInstruction: (body.request?.systemInstruction?.parts ?? []).length > 0 };
  if (!response.ok) errorBody = sanitize(await response.clone().text());
  return response;
};
const started = Date.now();
try {
  const response = await new CloudCodeRuntimeClient(observedFetch).generate({ modelId: model,
    ...(withSystem ? { messages: [{ role: "system", content: "Return JSON only." },
      { role: "user", content: "Reply with PING_OK only." }] }
      : { messages: [{ role: "user", content: "Reply with PING_OK only." }] }),
    ...(withEffort ? { reasoning: { effort: "low" } } : {}),
    maxOutputTokens }, { auth: acquisition.material });
  actual = { modelId: response.modelId, finishReason: response.finishReason ?? null,
    messageExact: response.text?.trim() ?? "", usage: response.usage ?? null };
} catch (caught) {
  error = { message: sanitize(caught instanceof Error ? caught.message : caught) };
} finally {
  await facade.release(acquisition);
}
const receipt = { schemaVersion: 1, probe: { maxOutputTokens, withSystem, withEffort },
  latencyMs: Date.now() - started, wire, errorBody, actual, error,
  accountPseudonym: `acct-${sha256(account.accountId).slice(0, 10)}`,
  redaction: { secretsIncluded: false } };
await writeFile(outputPath, JSON.stringify(receipt), { flag: "wx" });
console.log(JSON.stringify({ maxOutputTokens, withSystem, withEffort,
  httpStatus: wire?.httpStatus ?? null, errorBody: errorBody?.slice(0, 400) ?? null,
  messageExact: actual?.messageExact ?? null }));

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { arms } from "./v101-arms.mjs";

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const sourceRoot = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const gate = async (name) => json(resolve(resultRoot, "gates", name));

const [sourceBytes, sourceStatus, install, cap, ...providerGates] = await Promise.all([
  readFile(resolve(sourceRoot, "manifest.json")), json(resolve(sourceRoot, "status.json")),
  gate("llm-mesh-install.json"), gate("codex-cap-assessment.json"),
  ...["cloud", "codex", "anthropic"].map((name) => gate(`provider-${name}.json`)),
]);
if (install.version !== "0.19.3" || !install.integrityCrossChecked) {
  throw new Error("llm-mesh 0.19.3 integrity gate failed");
}
if (cap.cap?.enforced !== true || cap.observedWireMaxOutputTokens !== 32) {
  throw new Error("Codex wire cap gate failed");
}
for (const provider of providerGates) {
  if (provider.outcomes?.length !== 3 || provider.outcomes.some((outcome) =>
    outcome.requestCount !== 1 || outcome.noActiveAccount)) {
    throw new Error(`${provider.provider} no_active_account gate failed`);
  }
}

const manifest = JSON.parse(sourceBytes);
manifest.campaign = "v101b";
manifest.frozenAt = new Date().toISOString();
manifest.contract.llmMeshVersion = "0.19.3";
manifest.outputCap.state = "wire-enforced";
manifest.outputCap.codexWireMaterialization = "observed-at-32";
manifest.outputCap.cap = { enforced: true, truncationObserved: false,
  source: "gates/codex-cap-assessment.json" };
await writeFile(resolve(resultRoot, "manifest.json"), `${JSON.stringify(manifest)}\n`, { flag: "wx" });

const protocol = `# v101b replay freeze\n\n` +
  `v101b reuses the v101 corpus, prompts, schemas, validators, profiles, arms, and 32,768-token cap. ` +
  `Only llm-mesh changes to 0.19.3 and Codex cap enforcement changes to true.\n\n` +
  `GPT-4.1 and Mistral Small 4 artifacts are copied byte-for-byte from v101; the other 24 arms rerun.\n\n` +
  `Source v101 manifest SHA-256: \`${sha256(sourceBytes)}\`. The 32-token Codex probe materialized ` +
  `the cap but received HTTP 400, so output truncation was not observed.\n`;
await writeFile(resolve(resultRoot, "protocol.md"), protocol, { flag: "wx" });

await Promise.all([mkdir(resolve(resultRoot, "campaign"), { recursive: true }),
  mkdir(resolve(resultRoot, "scores"), { recursive: true })]);
await Promise.all(["gpt41", "mistral-small4"].flatMap((name) => [
  cp(resolve(sourceRoot, "campaign", name), resolve(resultRoot, "campaign", name),
    { recursive: true, errorOnExist: true }),
  cp(resolve(sourceRoot, "scores", `${name}.json`), resolve(resultRoot, "scores", `${name}.json`),
    { errorOnExist: true }),
]));
const reused = new Set(["gpt41", "mistral-small4"]);
const queued = { state: "queued", total: 100, processed: 0, accepted: 0, errors: 0,
  lastReceipt: null, requests: 0, etaSeconds: null };
const status = { schemaVersion: 1, campaign: "v101b", launchedAt: null,
  llmMeshVersion: "0.19.3", commonMaxOutputTokens: 32_768,
  cap: { codex: { enforced: true } }, sourceCampaign: "v101",
  arms: Object.fromEntries(Object.keys(arms).map((name) => [name, reused.has(name)
    ? { ...sourceStatus.arms[name], sourceCampaign: "v101", reused: true } : { ...queued }])) };
await writeFile(resolve(resultRoot, "status.json"), `${JSON.stringify(status, null, 2)}\n`,
  { flag: "wx" });
console.log(JSON.stringify({ campaign: "v101b", arms: 26, replayed: 24,
  reused: [...reused], sourceManifestSha256: sha256(sourceBytes) }));

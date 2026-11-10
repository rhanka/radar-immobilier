// Precision cascade astra-low -> gemini-low (owner request 2026-09-18): Gemini low re-reads the
// ARCHIVED, accepted astra-low outputs of the 100 v101b documents and rules on every act -
// supported by the frozen document or not. It adds nothing: the filtered output is the Astra output
// minus the acts ruled "non_soutenu" with a reason; any other content of the answer is ignored.
// No Astra call. Scored as one more arm by score-oracle-v3.mjs.
//
//   node tools/refresh-benchmark/precision-cascade.mjs [--source astra-low|astra-medium] [--docs id,id] [--concurrency n] [--transport fake:<dir>]
//   (real calls: ORACLE_V3_GO=1, inside the benchmark container - tools/refresh-benchmark/run-precision-cascade.sh)
//
// An "act" is exactly the group the scorer grades: eligible nodes (Signal, DesignationEvent, Bylaw)
// joined by raises_signal edges. Non-eligible nodes and edges are never touched.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { documentPages, identity, locate, pagesBlock, parseJsonObject, sha256 } from "./oracle-v3-lib.mjs";
import { ORACLE_V2_ELIGIBLE_NODE_TYPES } from "./score-oracle-v2.mjs";

// One cascade per source arm; the filter prompt is the same file for all (prompt-filtre.md of CP).
export const CASCADES = Object.freeze({
  // Owner decision 2026-09-19: the reference cascade is astra-medium -> gemini 3.8 low, named "CP".
  // The first cascade on astra-low established the method; its data stay on disk, out of the report.
  "astra-low": { dir: "docs/reviews/refresh-benchmark/v101b/precision-cascade", variant: "precision-astra-low-gemini-low",
    arm: "CP-low (astra-low → vérification gemini-3.8 low ; première cascade, hors rapport)", inReport: false },
  "astra-medium": { dir: "docs/reviews/refresh-benchmark/v101b/precision-cascade-medium", variant: "precision-astra-medium-gemini-low",
    arm: "CP (astra-medium → vérification gemini-3.8 low, cascade de précision)", inReport: true },
});
export const cascadeOf = (source = "astra-low") => {
  const cascade = CASCADES[source];
  if (!cascade) throw new Error(`unknown cascade source ${source}`);
  return { source, ...cascade, sourceDir: `docs/reviews/refresh-benchmark/v101b/codex-replay/campaign/${source}` };
};
export const CASCADE_DIR = CASCADES["astra-low"].dir;
export const CASCADE_VARIANT = CASCADES["astra-low"].variant;
export const SOURCE_DIR = cascadeOf("astra-low").sourceDir;
export const PROMPT_DIR = CASCADE_DIR;
const GEMINI_LOW = Object.freeze({ name: "precision-gemini-low", transport: "cloud-code", model: "gemini-3.8-flash",
  effort: "low", capEnforced: true });
const TIMEOUT_MS = 900_000;

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

// Same grouping as scoreValidV2 (union-find over raises_signal between eligible nodes).
export function actsOf(output) {
  const eligibleTypes = new Set(ORACLE_V2_ELIGIBLE_NODE_TYPES);
  const eligible = output.nodes.filter(({ node_type: type }) => eligibleTypes.has(type));
  const byId = new Map(eligible.map((node, index) => [node.id, index]));
  const parent = eligible.map((_, index) => index);
  const root = (index) => parent[index] === index ? index : (parent[index] = root(parent[index]));
  for (const edge of output.edges ?? []) {
    if (edge.relation !== "raises_signal" || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    parent[root(byId.get(edge.target))] = root(byId.get(edge.source));
  }
  const groups = new Map();
  eligible.forEach((node, index) => { const key = root(index); groups.set(key, [...(groups.get(key) ?? []), node]); });
  const evidence = new Map((output.evidence ?? []).map((item) => [item.id, item]));
  return [...groups.values()].map((nodes, index) => ({ act: `A${String(index + 1).padStart(2, "0")}`,
    nodeIds: nodes.map(({ id }) => id),
    view: nodes.map((node) => {
      const properties = node.properties ?? node;
      const citations = [...(node.citations ?? []), ...(node.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean)]
        .map(({ page, excerpt }) => ({ page, excerpt }));
      return { type: node.node_type, label: node.label ?? null,
        stage: properties.etape ?? properties.stage ?? properties.stade ?? null,
        objet: properties.numero ?? properties.objet ?? properties.adresse ?? properties.lot ?? null, citations };
    }) }));
}

export function filterUserMessage(document, pages, acts) {
  return `${identity(document, pages)}\n\nACTES À VÉRIFIER (${acts.length}) :\n`
    + `${JSON.stringify({ acts: acts.map(({ act, view }) => ({ act, nodes: view })) }, null, 1)}`
    + `\n\nTEXTE DU DOCUMENT :\n${pagesBlock(pages)}`;
}

export async function loadFilterPrompt(repositoryRoot) {
  const markdown = await readFile(resolve(repositoryRoot, PROMPT_DIR, "prompt-filtre.md"), "utf8");
  const match = markdown.match(/<!-- PROMPT-FILTER-BEGIN -->\n([\s\S]*?)\n<!-- PROMPT-FILTER-END -->/u);
  if (!match) throw new Error("prompt-filtre.md has no PROMPT-FILTER block");
  return { text: match[1], sha256: sha256(match[1]) };
}

const grounded = (pages, excerpt) => typeof excerpt === "string" && [...excerpt].length >= 20
  && pages.some((page) => locate(page, excerpt));

// Removal only on an explicit, valid "non_soutenu" with a reason. Returns the filtered output (the
// Astra output minus the removed acts' nodes, and the edges/evidence refs touching them) and a log.
export function applyDecisions(output, acts, decisions, pages) {
  const known = new Map(acts.map((act) => [act.act, act]));
  const log = { acts: acts.length, removed: [], kept: [], unknownIds: [], keptNoValidDecision: 0,
    supportedUngrounded: 0, contradictingExcerptUngrounded: 0 };
  const seen = new Set();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (!decision || typeof decision !== "object") continue;
    if (!known.has(decision.act)) { log.unknownIds.push(String(decision.act).slice(0, 20)); continue; }
    if (seen.has(decision.act)) continue;
    const reason = typeof decision.reason === "string" ? decision.reason.trim() : "";
    if (!reason || !["soutenu", "non_soutenu"].includes(decision.verdict)) continue;
    seen.add(decision.act);
    if (decision.verdict === "non_soutenu") {
      if (decision.excerpt && !grounded(pages, decision.excerpt)) log.contradictingExcerptUngrounded += 1;
      log.removed.push({ act: decision.act, reason: reason.slice(0, 300) });
    } else {
      if (!grounded(pages, decision.excerpt)) log.supportedUngrounded += 1;
      log.kept.push({ act: decision.act, reason: reason.slice(0, 300) });
    }
  }
  log.keptNoValidDecision = acts.filter(({ act }) => !seen.has(act)).length;
  const removedNodes = new Set(log.removed.flatMap(({ act }) => known.get(act).nodeIds));
  const filtered = { ...output, nodes: output.nodes.filter(({ id }) => !removedNodes.has(id)),
    edges: (output.edges ?? []).filter(({ source, target }) => !removedNodes.has(source) && !removedNodes.has(target)) };
  return { filtered, log };
}

function fakeTransport(directory) {
  return { name: "fake", async generate(_system, _user, documentId) {
    const text = await readFile(join(directory, `${documentId}.txt`), "utf8");
    return { text, receipt: { transport: "fake", latencyMs: 0, usage: null } };
  } };
}

async function geminiTransport() {
  if (process.env.ORACLE_V3_GO !== "1") throw new Error("ORACLE_V3_GO=1 is required for a real model call (GO i-cond)");
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
    if (process.env[name]) throw new Error(`${name} must be unset: seats only`);
  }
  const { createProvider } = await import("./v101-provider.mjs");
  const { HEADERS_TIMEOUT_MS, IDLE_TIMEOUT_MS, WATCHDOG_GRACE_MS, withWatchdog } = await import("./oracle-v3-step.mjs");
  const provider = await createProvider(GEMINI_LOW, { timeoutMs: TIMEOUT_MS, headersTimeoutMs: HEADERS_TIMEOUT_MS,
    idleTimeoutMs: IDLE_TIMEOUT_MS, beforeRequest() {} });
  return { name: "cloud-code", async generate(system, user, affinityKey) {
    const started = Date.now();
    try {
      const result = await withWatchdog(provider.generate([{ role: "system", content: system }, { role: "user", content: user }],
        affinityKey), TIMEOUT_MS + WATCHDOG_GRACE_MS);
      return { text: result.text, receipt: { transport: "cloud-code", accountPseudonym: provider.accountPseudonym,
        latencyMs: Date.now() - started, modelId: result.modelId, finishReason: result.finishReason, usage: result.usage,
        wire: result.wire ? { endpoint: result.wire.endpoint, model: result.wire.model, effort: result.wire.effort,
          maxOutputTokens: result.wire.maxOutputTokens, httpStatus: result.wire.httpStatus, durationMs: result.wire.durationMs } : null } };
    } catch (error) {
      throw Object.assign(new Error(`MESH_FAILED ${error?.code ?? error?.message}`), { receipt: { transport: "cloud-code",
        latencyMs: Date.now() - started, code: error?.code ?? null, httpStatus: error?.httpStatus ?? null } });
    }
  } };
}

export async function runCascade({ repositoryRoot = process.cwd(), docs = null, concurrency = 4, transport: transportOption = null,
  source: sourceArm = "astra-low", out = null, log = console.log } = {}) {
  const cascade = cascadeOf(sourceArm);
  out ??= cascade.dir;
  const outRoot = resolve(repositoryRoot, out);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
  const documents = manifest.documents.filter(({ id }) => !docs || docs.includes(id));
  const prompt = await loadFilterPrompt(repositoryRoot);
  const transport = transportOption?.startsWith("fake:") ? fakeTransport(transportOption.slice(5)) : await geminiTransport();
  const decisionsDir = join(outRoot, "decisions"); const campaignDir = join(outRoot, "campaign");
  await mkdir(decisionsDir, { recursive: true }); await mkdir(campaignDir, { recursive: true });
  const summary = { done: 0, skipped: 0, failed: 0, noAstraOutput: 0, noActs: 0 };
  const queue = [...documents];
  const worker = async () => {
    for (let document = queue.shift(); document; document = queue.shift()) {
      const stem = join(campaignDir, `${document.id}--${cascade.variant}.attempt-1`);
      if (await readJsonIfPresent(`${stem}.receipt.json`)) { summary.skipped += 1; continue; }
      const sourceStem = join(resolve(repositoryRoot, cascade.sourceDir), `${document.id}--${sourceArm}.attempt-1`);
      const sourceReceipt = await readJsonIfPresent(`${sourceStem}.receipt.json`);
      const source = sourceReceipt?.validation?.accepted ? await readJsonIfPresent(`${sourceStem}.output.json`) : null;
      if (!source) { summary.noAstraOutput += 1; continue; }
      const pages = documentPages(await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8"));
      const acts = actsOf(source);
      const base = { documentId: document.id, sourceArm, promptSha256: prompt.sha256, sourceOutputSha256: sha256(JSON.stringify(source)),
        model: GEMINI_LOW.model, effort: GEMINI_LOW.effort, transport: transport.name };
      let decisions = []; let rawText = null; let receipt = null; let parseError = null;
      if (acts.length === 0) summary.noActs += 1;
      else {
        const user = filterUserMessage(document, pages, acts);
        try {
          const answer = await transport.generate(prompt.text, user, document.id);
          rawText = answer.text; receipt = { ...answer.receipt, inputSha256: sha256(user) };
          try { decisions = parseJsonObject(answer.text).decisions ?? []; } catch (error) { parseError = String(error.message); }
        } catch (error) {
          summary.failed += 1;
          await writeFile(join(decisionsDir, `${document.id}.error.json`), `${JSON.stringify({ ...base,
            error: String(error.message).slice(0, 300), receipt: error.receipt ?? null, at: new Date().toISOString() }, null, 1)}\n`);
          log(JSON.stringify({ documentId: document.id, error: String(error.message).slice(0, 200) }));
          continue;
        }
        if (parseError) {
          summary.failed += 1;
          await writeFile(join(decisionsDir, `${document.id}.parse-error.json`), `${JSON.stringify({ ...base, rawText, parseError, receipt }, null, 1)}\n`);
          log(JSON.stringify({ documentId: document.id, parseError }));
          continue;
        }
      }
      const { filtered, log: filterLog } = applyDecisions(source, acts, decisions, pages);
      await writeFile(join(decisionsDir, `${document.id}.json`), `${JSON.stringify({ ...base, acts, rawText, decisions,
        filter: filterLog, receipt }, null, 1)}\n`);
      await writeFile(`${stem}.output.json`, `${JSON.stringify(filtered, null, 1)}\n`);
      await writeFile(`${stem}.receipt.json`, `${JSON.stringify({ ...base, validation: { accepted: true, note: `filtered ${sourceArm} output` },
        receipt, at: new Date().toISOString() }, null, 1)}\n`);
      summary.done += 1;
      log(JSON.stringify({ documentId: document.id, acts: acts.length, removed: filterLog.removed.length,
        keptNoValidDecision: filterLog.keptNoValidDecision, unknownIds: filterLog.unknownIds.length }));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, worker));
  await writeFile(join(outRoot, "_summary.json"), `${JSON.stringify({ ...summary, at: new Date().toISOString() }, null, 1)}\n`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === "--docs") options.docs = args[index + 1].split(",");
    else if (args[index] === "--concurrency") options.concurrency = Number(args[index + 1]);
    else if (args[index] === "--transport") options.transport = args[index + 1];
    else if (args[index] === "--source") options.source = args[index + 1];
    else throw new Error(`unknown flag ${args[index]}`);
  }
  const summary = await runCascade(options);
  console.log(JSON.stringify(summary));
  if (summary.failed) process.exitCode = 3;
}

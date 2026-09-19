// Runs one oracle-v3 step (see STEPS in oracle-v3-lib.mjs) over the 100 frozen documents.
//
//   node tools/refresh-benchmark/oracle-v3-step.mjs <step> [--docs id,id] [--concurrency n]
//        [--transport fake:<dir>] [--chain astra,fable,gemini] [--out <dir>]
//
// A pass step reads the current gold of each document (the head of its lineage, empty before the
// first pass), sends the frozen text + that gold to its model, grounds and applies the returned
// operations and writes the new gold. A document is ready for a step once the step before it in the
// execution order has processed it. A converge step (verification) sends every unit ever proposed
// in the gold after the last pass step and stores the model's votes; an arbitrate step, once the
// three verifications of the document exist, sends every non-unanimous unit and every difference
// with the human gold v2, with the reasoned positions, and stores the votes. Unanimity and final
// reference: oracle-v3-verdict.mjs, oracle-v3-build.mjs. Steps are resumable: a
// document whose output exists is skipped; a failed call writes <doc>.error.json and is retried on
// the next run.
//
// Guards: every real model call needs ORACLE_V3_GO=1 (the conductor's GO); Astra additionally needs
// ORACLE_V3_ASTRA_GO=1 (Codex seat blocked until 2026-09-22 09:12). The Claude seat transport runs
// on the host with the constrained CLI form only, reads the weekly counter every 25 calls and stops
// above 60 % (owner GO 2026-09-18, was 40 %). The llm-mesh transports (codex, cloud-code) only work inside the benchmark container
// (run-oracle-v3-mesh.sh), with API keys unset.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { activeUnits, applyOperations, CONVERGE_STEPS, documentPages,
  emptyState, loadPrompts, ORACLE_V3_DIR, parseJsonObject, passUserMessage, LINEAGE_STEPS, PASS_STEPS, sha256,
  stepById } from "./oracle-v3-lib.mjs";
import { arbitrateUserMessage, arbitrationItemsOf, reviewItemsOf, verifyUserMessage } from "./oracle-v3-verdict.mjs";

// Documents of the human gold v2 (arbitration only); Waterloo's human gold is partial.
export const PARTIAL_HUMAN = "waterloo-2026-08-18";
export async function humanUnitsByDocument(repositoryRoot, documents) {
  const human = JSON.parse(await readFile(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/manual-oracle-v2.json"), "utf8"));
  return new Map(documents.filter(({ manualOracle }) => manualOracle && manualOracle !== "N-A").map((document) =>
    [document.id, human.units.filter(({ doc_sha: digest }) => digest === document.sha256)]));
}

const USAGE_EVERY = 25;
const WEEKLY_STOP_PERCENT = 60; // owner GO 2026-09-18 (was 40)
// Owner guard (2026-09-18): the production refresh shares the Codex seat. Astra stops above 70 % of
// the weekly Codex window (wham/usage, as codex-preflight.mjs), read before the step and every 10
// Astra annotations; an unreadable counter stops Astra too - never Astra blind.
const CODEX_EVERY = 10;
const CODEX_STOP_PERCENT = 70;
const TIMEOUT_MS = { xhigh: 1_800_000, high: 900_000 };
// Network timeouts of the llm-mesh steps (2026-09-18, after arbitrate-astra calls hung ~58 min on
// dead sockets): response headers within 2 min, never more than 10 min without a body chunk (the
// longest oracle-v3 call so far took 439 s in total), total deadline TIMEOUT_MS; plus a watchdog
// 60 s past the deadline that fails the call whatever the transport does.
export const HEADERS_TIMEOUT_MS = 120_000;
export const IDLE_TIMEOUT_MS = 600_000;
export const WATCHDOG_GRACE_MS = 60_000;
export function withWatchdog(promise, ms, code = "WATCHDOG_TIMEOUT") {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}
// Gemini output cap (owner decision via i-cond, 2026-09-18): gemini-pass1 hit the common 32 768 cap
// on bedford--brome-missisquoi-2026-06-02 (finishReason length, 31 454 thinking tokens). Same model
// and effort, cap raised to 65 536 for every Gemini step. Sources: llm-mesh 0.19.3 catalogue
// (gemini-3.8-flash maxOutputTokens 65 536) and a real Cloud Code call that sent 65 536 on the wire
// (docs/reviews/refresh-benchmark/v8/campaign-real/waterloo-2026-08-18--gemini-high.receipt.json,
// HTTP 200, finishReason STOP). Read at process start, like the quota guards.
export const GEMINI_MAX_OUTPUT_TOKENS = 65_536;

export function parseArgs(argv) {
  const [stepId, ...rest] = argv;
  const options = { stepId, docs: null, concurrency: null, transport: null,
    chain: ["astra", "fable", "gemini"], out: null };
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (flag === "--docs") options.docs = value.split(",").filter(Boolean);
    else if (flag === "--concurrency") options.concurrency = Number(value);
    else if (flag === "--transport") options.transport = value;
    else if (flag === "--chain") options.chain = value.split(",").filter(Boolean);
    else if (flag === "--out") options.out = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return options;
}

// Pass steps of the chain, in execution order. Owner decisions 2026-09-18: pass 1 of every family,
// then pass 2 of every family, then astra-pass3 (seven passes); each pass verifies and completes the current gold, nothing is
// re-annotated from scratch. A shorter chain is only for dry runs and is written in every output so
// it can never pass for the full method.
export function chainSteps(chain) {
  return [1, 2, 3].flatMap((pass) => chain.flatMap((family) =>
    PASS_STEPS.filter((step) => step.family === family && step.pass === pass)));
}

export function previousPassStep(stepId, chain) {
  const steps = chainSteps(chain);
  const step = stepById(stepId);
  if (step.kind === "converge" || step.kind === "arbitrate") return steps.at(-1) ?? null;
  const index = steps.findIndex(({ id }) => id === stepId);
  if (index < 0) throw new Error(`${stepId} is not in chain ${chain.join(",")}`);
  return index === 0 ? null : steps[index - 1];
}

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

// Gold lineage of one document: the pass steps that processed it, in the order they did. Every pass
// annotation records the step whose gold it read (inputStateStep, null for an empty gold), so the
// lineage is one chain from the empty gold and its last step holds the current gold. The order can
// differ between documents (astra-pass2 ran on 52 documents right after astra-pass1, before the
// 2026-09-18 order change), hence a per-document head rather than a fixed previous step.
export async function documentLineage(outRoot, documentId) {
  const inputs = new Map();
  for (const step of LINEAGE_STEPS) {
    const record = await readJsonIfPresent(join(outRoot, "annotations", step.id, `${documentId}.json`));
    if (!record) continue;
    if (!await readJsonIfPresent(join(outRoot, "corrige", step.id, `${documentId}.json`))) {
      throw new Error(`${step.id}/${documentId}: annotation without its gold`);
    }
    inputs.set(step.id, record.inputStateStep ?? null);
  }
  const lineage = [];
  for (let head = null; ;) {
    const next = [...inputs].filter(([, input]) => input === head).map(([id]) => id);
    if (next.length > 1) throw new Error(`${documentId}: gold lineage forks after ${head}: ${next.join(", ")}`);
    if (next.length === 0) break;
    [head] = next; lineage.push(head);
  }
  if (lineage.length !== inputs.size) throw new Error(`${documentId}: gold lineage broken (${[...inputs.keys()].join(", ")})`);
  return lineage;
}

let quotaLogPath = null;
function quotaLog(entry) {
  if (!quotaLogPath) return;
  appendFileSync(quotaLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// ---- transports -------------------------------------------------------------------------------

function claudeCliTransport(step) {
  const usageScript = process.env.ORACLE_V3_USAGE_SCRIPT;
  if (!usageScript) throw new Error("ORACLE_V3_USAGE_SCRIPT is required for the Claude seat");
  let calls = 0; let stopped = null;
  const weeklyPercent = () => {
    const probe = spawnSync("sh", [usageScript], { encoding: "utf8", timeout: 120_000 });
    const lines = (probe.stdout ?? "").split("\n");
    const at = lines.findIndex((line) => /current week \(all models\)/iu.test(line));
    const match = at >= 0 ? lines.slice(at, at + 3).join(" ").match(/(\d+)% used/u) : null;
    return match ? Number(match[1]) : null;
  };
  const gate = () => {
    const percent = weeklyPercent();
    quotaLog({ seat: "claude", step: step.id, weeklyAllModelsPercent: percent });
    if (percent === null) stopped = "weekly usage unreadable";
    else if (percent > WEEKLY_STOP_PERCENT) stopped = `weekly usage ${percent}% > ${WEEKLY_STOP_PERCENT}%`;
    return percent;
  };
  let emptyFailures = 0;
  return {
    name: "claude-cli", gate,
    get stopped() { return stopped; },
    async generate(system, user) {
      if (stopped) throw Object.assign(new Error(`CLAUDE_SEAT_STOPPED: ${stopped}`), { fatal: true });
      calls += 1;
      if (calls % USAGE_EVERY === 0) gate();
      const cwd = await mkdtemp(join(tmpdir(), "oracle-v3-empty-"));
      const started = Date.now();
      try {
        const result = await new Promise((done, fail) => {
          const child = spawn("env", ["-i", `HOME=${process.env.HOME}`, `PATH=${process.env.PATH}`,
            "TERM=xterm-256color", "claude", "-p", "--model", step.model, "--effort", step.effort,
            "--output-format", "json", "--system-prompt", system, "--disallowed-tools", "*",
            "--strict-mcp-config"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
          let stdout = ""; let stderr = "";
          const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS[step.effort] ?? 900_000);
          child.stdout.on("data", (chunk) => { stdout += chunk; });
          child.stderr.on("data", (chunk) => { stderr += chunk; });
          child.on("error", (error) => { clearTimeout(timer); fail(error); });
          child.on("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
          child.stdin.end(user);
        });
        let payload = null; try { payload = JSON.parse(result.stdout); } catch { /* reported below */ }
        const receipt = { transport: "claude-cli", rc: result.code, latencyMs: Date.now() - started,
          isError: payload?.is_error ?? null, numTurns: payload?.num_turns ?? null,
          sessionId: payload?.session_id ?? null, modelUsage: payload?.modelUsage ?? null,
          usage: payload?.usage ?? null, totalCostUsd: payload?.total_cost_usd ?? null,
          durationApiMs: payload?.duration_api_ms ?? null,
          stderrTail: result.code === 0 ? "" : String(result.stderr).slice(-300),
          errorText: payload?.is_error ? String(payload?.result ?? "").slice(0, 300) : null,
          apiErrorStatus: payload?.api_error_status ?? null };
        if (result.code !== 0 || !payload || payload.is_error) {
          const text = String(payload?.result ?? result.stderr ?? "");
          const decision = claudeSeatFailure(text, payload, emptyFailures);
          emptyFailures = decision.emptyFailures;
          const fatal = Boolean(decision.stop);
          if (fatal) stopped = decision.stop;
          throw Object.assign(new Error(`CLAUDE_CLI_FAILED rc=${result.code}`), { receipt, fatal });
        }
        emptyFailures = 0;
        return { text: payload.result ?? "", receipt };
      } finally { await rm(cwd, { recursive: true, force: true }); }
    },
  };
}

// Claude seat failure policy. A limit message stops the step. So do 3 consecutive failures that
// consumed nothing (is_error, 0 output tokens): on 2026-09-18 fable-pass2 burnt 45 documents in 2 s
// failures of that shape while the seat was limited, and the limit text was not recorded.
export const CLAUDE_EMPTY_FAILURE_STOP = 3;
export function claudeSeatFailure(text, payload, emptyFailures) {
  if (/usage limit|limit reached|rate limit|hit your limit|limit will reset|resets? at/iu.test(text)) {
    return { stop: `seat limit: ${text.slice(0, 120)}`, emptyFailures: emptyFailures + 1 };
  }
  const empty = Boolean(payload?.is_error) && !(payload?.usage?.output_tokens > 0);
  const count = empty ? emptyFailures + 1 : 0;
  return { stop: count >= CLAUDE_EMPTY_FAILURE_STOP
    ? `${count} consecutive empty Claude seat failures (limit suspected): ${text.slice(0, 120)}` : null, emptyFailures: count };
}

export const meshArm = (step) => ({ name: `oracle-v3-${step.family}`, transport: step.transport,
  model: step.model, effort: step.effort, capEnforced: step.transport !== "codex",
  ...(step.family === "gemini" ? { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS } : {}) });

async function meshTransport(step) {
  if (!["codex", "cloud-code"].includes(step.transport)) throw new Error(`no mesh transport for ${step.id}`);
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY"]) {
    if (process.env[name]) throw new Error(`${name} must be unset: oracle-v3 uses seats only`);
  }
  const { createProvider } = await import("./v101-provider.mjs");
  const arm = meshArm(step);
  const timeoutMs = TIMEOUT_MS[step.effort] ?? 900_000;
  const provider = await createProvider(arm, { timeoutMs, headersTimeoutMs: HEADERS_TIMEOUT_MS,
    idleTimeoutMs: IDLE_TIMEOUT_MS, beforeRequest() {} });
  let calls = 0; let stopped = null;
  const gate = async () => {
    if (step.transport !== "codex") return null;
    let reading = null;
    try { reading = await (await import("./codex-weekly-usage.mjs")).readCodexWeekly(); }
    catch (error) { reading = { error: String(error.message).slice(0, 200) }; }
    const percent = reading?.weekly?.usedPercent ?? null;
    quotaLog({ seat: "codex", step: step.id, weeklyPercent: percent, httpStatus: reading?.httpStatus ?? null,
      resetAt: reading?.weekly?.resetAt ?? null, limitReached: reading?.weekly?.limitReached ?? null,
      error: reading?.error ?? null });
    if (percent === null) stopped = "codex weekly usage unreadable";
    else if (reading.weekly.limitReached) stopped = "codex limit reached";
    else if (percent > CODEX_STOP_PERCENT) stopped = `codex weekly usage ${percent}% > ${CODEX_STOP_PERCENT}%`;
    return percent;
  };
  return { name: step.transport, gate, get stopped() { return stopped; },
    async generate(system, user, affinityKey) {
      if (stopped) throw Object.assign(new Error(`CODEX_SEAT_STOPPED: ${stopped}`), { fatal: true });
      calls += 1;
      if (step.transport === "codex" && calls > 1 && (calls - 1) % CODEX_EVERY === 0) {
        await gate();
        if (stopped) throw Object.assign(new Error(`CODEX_SEAT_STOPPED: ${stopped}`), { fatal: true });
      }
      const started = Date.now();
      const messages = [{ role: "system", content: system }, { role: "user", content: user }];
      try {
        const result = await withWatchdog(provider.generate(messages, affinityKey), timeoutMs + WATCHDOG_GRACE_MS);
        return { text: result.text, receipt: { transport: step.transport,
          accountPseudonym: provider.accountPseudonym, latencyMs: Date.now() - started,
          modelId: result.modelId, finishReason: result.finishReason, usage: result.usage,
          wire: result.wire ? { endpoint: result.wire.endpoint, model: result.wire.model,
            effort: result.wire.effort, maxOutputTokens: result.wire.maxOutputTokens,
            httpStatus: result.wire.httpStatus, durationMs: result.wire.durationMs,
            requestId: result.wire.requestId } : null } };
      } catch (error) {
        const fatal = [401, 403, 429].includes(error?.httpStatus) || /usage.?limit/iu.test(String(error?.wire?.responseError));
        throw Object.assign(new Error(`MESH_FAILED ${error?.code ?? error?.message}`), { fatal,
          receipt: { transport: step.transport, latencyMs: Date.now() - started,
            code: error?.code ?? null, httpStatus: error?.httpStatus ?? null,
            responseError: error?.wire?.responseError ?? null } });
      }
    } };
}

// Replays canned model texts from <dir>/<step>/<doc>.txt. No network: used by the tests and the
// end-to-end dry run.
function fakeTransport(directory, step) {
  return { name: "fake", stopped: null, gate: () => null,
    async generate(_system, _user, documentId) {
      const text = await readFile(join(directory, step.id, `${documentId}.txt`), "utf8");
      return { text, receipt: { transport: "fake", latencyMs: 0, usage: null } };
    } };
}

export async function createTransport(step, transportOption) {
  if (transportOption?.startsWith("fake:")) return fakeTransport(transportOption.slice(5), step);
  if (process.env.ORACLE_V3_GO !== "1") throw new Error("ORACLE_V3_GO=1 is required for a real model call (GO i-cond)");
  if (step.family === "astra" && process.env.ORACLE_V3_ASTRA_GO !== "1") {
    throw new Error("ORACLE_V3_ASTRA_GO=1 is required: Codex seat blocked until 2026-09-22 09:12");
  }
  if (step.transport === "claude-cli") return claudeCliTransport(step);
  return meshTransport(step);
}

// ---- step -------------------------------------------------------------------------------------

export async function runStep(options, { repositoryRoot = process.cwd(), log = console.log } = {}) {
  const step = stepById(options.stepId);
  const outRoot = resolve(repositoryRoot, options.out ?? ORACLE_V3_DIR);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
    "docs/reviews/refresh-benchmark/v101b/manifest.json"), "utf8"));
  const documents = manifest.documents.filter(({ id }) => !options.docs || options.docs.includes(id));
  const prompts = await loadPrompts(repositoryRoot);
  const prompt = prompts[{ pass: "pass", converge: "verify", arbitrate: "arbitrate" }[step.kind]];
  const humans = step.kind === "arbitrate" ? await humanUnitsByDocument(repositoryRoot, documents) : new Map();
  const previous = previousPassStep(step.id, options.chain);
  const annotationDir = join(outRoot, "annotations", step.id);
  quotaLogPath = join(outRoot, "quota-log.jsonl");
  const stateDir = join(outRoot, "corrige", step.id);
  await mkdir(annotationDir, { recursive: true });
  if (step.kind === "pass") await mkdir(stateDir, { recursive: true });
  const transport = await createTransport(step, options.transport);
  if (transport.name !== "fake") {
    const percent = await transport.gate();
    log(JSON.stringify({ usageGate: percent, stopped: transport.stopped }));
    if (transport.stopped) {
      await writeFile(join(annotationDir, "_summary.json"), `${JSON.stringify({ step: step.id,
        done: 0, stopped: transport.stopped, at: new Date().toISOString() }, null, 1)}\n`);
      return { step: step.id, stopped: transport.stopped, done: 0 };
    }
  }
  const summary = { step: step.id, chain: options.chain, done: 0, skipped: 0, notReady: 0,
    failed: 0, noCall: 0, stopped: null };
  const queue = [...documents];
  const worker = async () => {
    for (;;) {
      if (transport.stopped) { summary.stopped = transport.stopped; return; }
      const document = queue.shift();
      if (!document) return;
      const target = join(annotationDir, `${document.id}.json`);
      if (await readJsonIfPresent(target)) { summary.skipped += 1; continue; }
      const lineage = await documentLineage(outRoot, document.id);
      if (previous && !lineage.includes(previous.id)) { summary.notReady += 1; continue; }
      const head = lineage.at(-1) ?? null;
      const state = head
        ? await readJsonIfPresent(join(outRoot, "corrige", head, `${document.id}.json`))
        : emptyState(document.id);
      const pages = documentPages(await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8"));
      const base = { documentId: document.id, step: step.id, chain: options.chain, model: step.model,
        effort: step.effort, transport: transport.name, promptSha256: prompt.sha256,
        inputStateStep: head, inputStateSha256: sha256(JSON.stringify(state)) };
      let items = null;
      if (step.kind === "converge") items = reviewItemsOf(state);
      if (step.kind === "arbitrate") {
        const records = {};
        for (const converge of CONVERGE_STEPS) {
          records[converge.family] = await readJsonIfPresent(join(outRoot, "annotations", converge.id, `${document.id}.json`));
        }
        if (!Object.values(records).every(Boolean)) { summary.notReady += 1; continue; }
        items = arbitrationItemsOf({ documentId: document.id, pages, state, records,
          humans: humans.get(document.id) ?? [], partialHuman: document.id === PARTIAL_HUMAN });
        base.verificationSha256 = sha256(JSON.stringify(Object.values(records).map(({ votes }) => votes)));
      }
      if (items && items.length === 0) {
        await writeFile(target, `${JSON.stringify({ ...base, items: [], votes: [], noCall: true }, null, 1)}\n`);
        summary.noCall += 1; continue;
      }
      const user = step.kind === "pass" ? passUserMessage(document, pages, activeUnits(state))
        : step.kind === "converge" ? verifyUserMessage(document, pages, items)
          : arbitrateUserMessage(document, pages, items);
      let answer;
      try { answer = await transport.generate(prompt.text, user, document.id); }
      catch (error) {
        summary.failed += 1;
        await writeFile(join(annotationDir, `${document.id}.error.json`), `${JSON.stringify({ ...base,
          error: String(error.message).slice(0, 300), receipt: error.receipt ?? null,
          at: new Date().toISOString() }, null, 1)}\n`);
        if (error.fatal) summary.stopped = String(error.message);
        log(JSON.stringify({ documentId: document.id, error: String(error.message).slice(0, 200) }));
        if (error.fatal) return;
        continue;
      }
      await writeFile(join(annotationDir, `${document.id}.receipt.json`), `${JSON.stringify({ ...base,
        inputSha256: sha256(user), responseSha256: sha256(answer.text), ...answer.receipt,
        at: new Date().toISOString() }, null, 1)}\n`);
      let parsed = null; let parseError = null;
      try { parsed = parseJsonObject(answer.text); } catch (error) { parseError = String(error.message); }
      if (step.kind === "pass") {
        const operations = Array.isArray(parsed?.operations) ? parsed.operations : null;
        if (!operations) parseError ??= "no operations[] array";
        const result = applyOperations(state, operations ?? [], pages, step.id);
        await writeFile(target, `${JSON.stringify({ ...base, rawText: answer.text, parseError,
          operations, applied: result.applied, rejects: result.rejects, counters: result.counters,
          activeAfter: activeUnits(result.state).length }, null, 1)}\n`);
        if (!parseError) await writeFile(join(stateDir, `${document.id}.json`), `${JSON.stringify(result.state, null, 1)}\n`);
        log(JSON.stringify({ documentId: document.id, applied: result.applied.length,
          rejects: result.rejects.length, active: activeUnits(result.state).length, parseError }));
      } else {
        const votes = Array.isArray(parsed?.votes) ? parsed.votes : null;
        if (!votes) parseError ??= "no votes[] array";
        await writeFile(target, `${JSON.stringify({ ...base, rawText: answer.text, parseError,
          items: step.kind === "converge"
            ? items.map(({ item, unitId, current }) => ({ item, unitId, current }))
            : items,
          votes: votes ?? [] }, null, 1)}\n`);
        log(JSON.stringify({ documentId: document.id, items: items.length, votes: votes?.length ?? 0, parseError }));
      }
      // A parse failure is retried on the next run: the annotation file is kept for the record
      // under another name and removed from the resume key.
      if (parseError) {
        const failed = await readFile(target, "utf8");
        await writeFile(join(annotationDir, `${document.id}.parse-error.json`), failed);
        await rm(target);
        summary.failed += 1;
      } else summary.done += 1;
    }
  };
  const concurrency = Math.min(options.concurrency ?? (transport.name === "claude-cli" ? 4 : 2),
    transport.name === "claude-cli" ? 4 : 8);
  await Promise.all(Array.from({ length: concurrency }, worker));
  summary.stopped ??= transport.stopped;
  await writeFile(join(annotationDir, "_summary.json"), `${JSON.stringify({ ...summary,
    at: new Date().toISOString() }, null, 1)}\n`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = await runStep(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(summary));
  if (summary.stopped) process.exitCode = 3;
}

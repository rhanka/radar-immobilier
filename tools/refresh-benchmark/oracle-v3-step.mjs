// Runs one oracle-v3 step (see STEPS in oracle-v3-lib.mjs) over the 100 frozen documents.
//
//   node tools/refresh-benchmark/oracle-v3-step.mjs <step> [--docs id,id] [--concurrency n]
//        [--transport fake:<dir>] [--chain astra,fable,gemini] [--out <dir>]
//
// A pass step reads the gold left by the previous pass step of the chain (empty for the first one),
// sends the frozen text + that gold to its model, grounds and applies the returned operations and
// writes the new gold. A converge step sends the disputes of the gold after the last pass step and
// stores the three-way votes (resolution happens in oracle-v3-build.mjs). Steps are resumable: a
// document whose output exists is skipped; a failed call writes <doc>.error.json and is retried on
// the next run.
//
// Guards: every real model call needs ORACLE_V3_GO=1 (the conductor's GO); Astra additionally needs
// ORACLE_V3_ASTRA_GO=1 (Codex seat blocked until 2026-09-22 09:12). The Claude seat transport runs
// on the host with the constrained CLI form only, reads the weekly counter every 25 calls and stops
// above 40 %. The llm-mesh transports (codex, cloud-code) only work inside the benchmark container
// (run-oracle-v3-mesh.sh), with API keys unset.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { activeUnits, applyOperations, convergeUserMessage, disputesOf, documentPages,
  emptyState, loadPrompts, ORACLE_V3_DIR, parseJsonObject, passUserMessage, PASS_STEPS, sha256,
  stepById } from "./oracle-v3-lib.mjs";

const USAGE_EVERY = 25;
const WEEKLY_STOP_PERCENT = 40;
// Owner guard (2026-09-18): the production refresh shares the Codex seat. Astra stops above 70 % of
// the weekly Codex window (wham/usage, as codex-preflight.mjs), read before the step and every 10
// Astra annotations; an unreadable counter stops Astra too - never Astra blind.
const CODEX_EVERY = 10;
const CODEX_STOP_PERCENT = 70;
const TIMEOUT_MS = { xhigh: 1_800_000, high: 900_000 };

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

// Pass steps of the chain, in order. The default chain is the owner's order; a shorter chain is
// only for dry runs and is written in every output so it can never pass for the full method.
export function chainSteps(chain) {
  return chain.flatMap((family) => PASS_STEPS.filter((step) => step.family === family));
}

export function previousPassStep(stepId, chain) {
  const steps = chainSteps(chain);
  const step = stepById(stepId);
  if (step.kind === "converge") return steps.at(-1) ?? null;
  const index = steps.findIndex(({ id }) => id === stepId);
  if (index < 0) throw new Error(`${stepId} is not in chain ${chain.join(",")}`);
  return index === 0 ? null : steps[index - 1];
}

const readJsonIfPresent = async (path) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

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
          stderrTail: result.code === 0 ? "" : String(result.stderr).slice(-300) };
        if (result.code !== 0 || !payload || payload.is_error) {
          const text = String(payload?.result ?? result.stderr ?? "");
          const fatal = /usage limit|limit reached|rate limit/iu.test(text);
          if (fatal) stopped = `seat limit: ${text.slice(0, 120)}`;
          throw Object.assign(new Error(`CLAUDE_CLI_FAILED rc=${result.code}`), { receipt, fatal });
        }
        return { text: payload.result ?? "", receipt };
      } finally { await rm(cwd, { recursive: true, force: true }); }
    },
  };
}

async function meshTransport(step) {
  if (!["codex", "cloud-code"].includes(step.transport)) throw new Error(`no mesh transport for ${step.id}`);
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY"]) {
    if (process.env[name]) throw new Error(`${name} must be unset: oracle-v3 uses seats only`);
  }
  const { createProvider } = await import("./v101-provider.mjs");
  const arm = { name: `oracle-v3-${step.family}`, transport: step.transport, model: step.model,
    effort: step.effort, capEnforced: step.transport !== "codex" };
  const provider = await createProvider(arm, { timeoutMs: TIMEOUT_MS[step.effort] ?? 900_000,
    beforeRequest() {} });
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
        const result = await provider.generate(messages, affinityKey);
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
  const prompt = step.kind === "pass" ? prompts.pass : prompts.converge;
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
      const state = previous
        ? await readJsonIfPresent(join(outRoot, "corrige", previous.id, `${document.id}.json`))
        : emptyState(document.id);
      if (!state) { summary.notReady += 1; continue; }
      const pages = documentPages(await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8"));
      const base = { documentId: document.id, step: step.id, chain: options.chain, model: step.model,
        effort: step.effort, transport: transport.name, promptSha256: prompt.sha256,
        inputStateStep: previous?.id ?? null, inputStateSha256: sha256(JSON.stringify(state)) };
      let disputes = null;
      if (step.kind === "converge") {
        disputes = disputesOf(state);
        if (disputes.length === 0) {
          await writeFile(target, `${JSON.stringify({ ...base, disputes: [], votes: [], noCall: true }, null, 1)}\n`);
          summary.noCall += 1; continue;
        }
      }
      const user = step.kind === "pass" ? passUserMessage(document, pages, activeUnits(state))
        : convergeUserMessage(document, pages, disputes);
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
          disputes: disputes.map(({ dispute, unitId, current }) => ({ dispute, unitId, current })),
          votes: votes ?? [] }, null, 1)}\n`);
        log(JSON.stringify({ documentId: document.id, disputes: disputes.length, votes: votes?.length ?? 0, parseError }));
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

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createProvider } from "./v101-provider.mjs";
import { classifyFailure, rateLimitPlan } from "./v101-runner-state.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();

export function judgeConfig(name) {
  if (name === "judge-terra") return { name, lane: "judge", transport: "codex",
    provider: "openai", model: "gpt-5.6-terra", effort: "medium", capEnforced: false };
  if (name === "judge-opus46-thinking") return { name, lane: "judge", transport: "cloud-code",
    provider: "anthropic", model: "claude-opus-4-6-thinking", effort: null };
  throw new Error(`Unknown v101b judge: ${name ?? "N-A"}`);
}

export function judgeMessages(bundle, entry, document) {
  const shape = { alias: "string", units: [{ summary: "string", page: 1, supported: true }],
    missedUnits: [{ summary: "string", page: 1 }],
    unsupportedClaims: [{ summary: "string", page: 1, reason: "string" }],
    citationDefects: [{ page: 1, excerpt: "string", defect: "string" }],
    usefulness: 3, notes: "string" };
  return [{ role: "system", content: [...bundle.judgeInstructions,
    `Réponds exactement avec ces clés : ${JSON.stringify(shape)}`,
    "usefulness est un entier de 1 à 5; units contient au plus 15 actes."].join("\n") },
  { role: "user", content: [`Alias : ${entry.alias}`,
    "=== TEXTE MUNICIPAL ===", document.pages.map(({ page, text }) =>
      `[PAGE ${page}]\n${text}`).join("\n"), "=== EXTRACTION ===",
    JSON.stringify(entry.extraction)].join("\n\n") }];
}

async function exists(path) {
  try { await readFile(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export async function runV101bJudge(name) {
  const arm = judgeConfig(name);
  const resultRoot = required("BENCHMARK_RESULT_ROOT");
  const bundle = JSON.parse(await readFile(resolve(resultRoot, "judges", "blind-bundle.json"), "utf8"));
  const documents = new Map(bundle.documents.map((document) => [document.alias, document]));
  const [from, to] = String(process.env.BENCHMARK_SLICE ?? `1-${bundle.entries.length}`)
    .split("-").map(Number);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > bundle.entries.length
    || from > to) throw new Error("BENCHMARK_SLICE must select valid judge entries");
  const entries = bundle.entries.slice(from - 1, to);
  const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? "1");
  if (![1, 2].includes(concurrency)) throw new Error("Judge concurrency must be 1 or 2");
  const judgeRoot = resolve(resultRoot, "judges", name);
  const verdictRoot = resolve(judgeRoot, "verdicts");
  await mkdir(verdictRoot, { recursive: true });
  let cursor = 0; let requests = 0; let completed = 0; let failed = 0; let deferred = false;
  const worker = async () => {
    const provider = await createProvider(arm, { timeoutMs: 480_000,
      beforeRequest() {
        if (requests >= 2_000) throw Object.assign(new Error("Judge request budget"),
          { code: "REQUEST_BUDGET_SUSPENDED" });
        requests += 1;
      } });
    for (;;) {
      if (deferred) return;
      const entry = entries[cursor++]; if (!entry) return;
      const verdictPath = resolve(verdictRoot, `${entry.alias}.json`);
      const intentPath = resolve(verdictRoot, `${entry.alias}.intent.json`);
      if (await exists(verdictPath)) continue;
      if (await exists(intentPath)) throw new Error(`Uncertain judge intent: ${entry.alias}`);
      await writeFile(intentPath, `${JSON.stringify({ schemaVersion: 1, state: "in-flight",
        alias: entry.alias, judge: name, startedAt: new Date().toISOString() })}\n`, { flag: "wx" });
      const started = Date.now(); let actual = null; let errorRecord = null;
      let suspension = 0; let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          actual = await provider.generate(judgeMessages(bundle, entry,
            documents.get(entry.documentAlias)), entry.alias); break;
        } catch (error) {
          const failure = classifyFailure({ httpStatus: error?.httpStatus, code: error?.code,
            terminalSse: error?.wire?.terminalSse });
          if (failure.category === "rate-limit") {
            const plan = rateLimitPlan(error.headers, suspension); suspension = plan.consecutive;
            await appendFile(resolve(judgeRoot, "limits.jsonl"), `${JSON.stringify({
              at: new Date().toISOString(), alias: entry.alias, category: "rate-limit",
              resetAt: plan.resetAt, resumeAt: plan.resumeAt, suspension })}\n`);
            if (plan.yieldLane) { await rm(intentPath); deferred = true; return; }
            await wait(plan.waitMs); continue;
          }
          if (attempt === 1 && failure.retry) continue;
          errorRecord = { category: failure.category, code: String(error?.code ?? "UNKNOWN"),
            httpStatus: error?.httpStatus ?? null }; break;
        }
      }
      if (deferred) return;
      let verdict = null; let parseError = null;
      if (actual) try { verdict = JSON.parse(actual.text); }
      catch (error) { parseError = String(error.message).slice(0, 200); }
      const record = { schemaVersion: 1, campaign: "v101b", alias: entry.alias, judge: name,
        requested: { modelId: arm.model, effort: arm.effort }, requestCount: attempt,
        actual: actual ? { responseId: actual.id, modelId: actual.modelId,
          finishReason: actual.finishReason, responseTextSha256: sha256(actual.text),
          usage: actual.usage } : null,
        latencyMs: Date.now() - started, error: errorRecord, parseError, verdict,
        redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
      await writeFile(verdictPath, `${JSON.stringify(record)}\n`, { flag: "wx" });
      completed += Number(Boolean(verdict)); failed += Number(!verdict);
      process.stdout.write(`${JSON.stringify({ judge: name, alias: entry.alias,
        completed: Boolean(verdict), latencyMs: record.latencyMs })}\n`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { judge: name, entries: entries.length, completed, failed, requests, deferred };
}

// bench-v11 (v12, CP+) : cascade de précision avec Muse Spark 1.3 xhigh comme relecteur.
// Méthode CP inchangée (harness/precision-cascade.mjs, commit dd0561f6c) : actsOf, filterUserMessage et
// applyDecisions du harnais, prompt de filtre de CP inchangé (harness/cp-prompt-filtre.md, sha256 du bloc
// cf015e57…). Seul le relecteur change : Muse Spark 1.3 xhigh via le siège Muse (muse exec --json), prompt
// envoyé = bloc de filtre + "\n\n" + message utilisateur (convention des bras Muse : système puis utilisateur).
// Source : sorties acceptées du rejeu GPT-6 Astra medium (arms/astra-medium-rejeu/validated).
// Usage :
//   node full/run-cascade-muse.mjs --verify <dossier decisions de CP>   (contrôle d'identité des messages)
//   node full/run-cascade-muse.mjs [concurrence=4]                         (relecture réelle)
// MUSE_EFFORT=low writes a separate low arm; xhigh remains the default. Maximum concurrency: 8.
// Garde : quota hebdomadaire Muse lu avant chaque document, arrêt à STOP_WEEKLY_PCT (défaut 85).
// STOP_WEEKLY_PCT=100 disables the guard, including when no counter is available.
// Quota de siège jamais compté comme refus : attente 300 s, reprise (12 au plus).
/* global setInterval, clearInterval */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPTS = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const { actsOf, filterUserMessage, applyDecisions } = await import(`${DIR}/harness/precision-cascade.mjs`);
const { documentPages, parseJsonObject } = await import(`${DIR}/harness/oracle-v3-lib.mjs`);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const markdown = await readFile(`${DIR}/harness/cp-prompt-filtre.md`, "utf8");
const filterPrompt = markdown.match(/<!-- PROMPT-FILTER-BEGIN -->\n([\s\S]*?)\n<!-- PROMPT-FILTER-END -->/u)[1];
const FILTER_SHA = "cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68";
if (sha(filterPrompt) !== FILTER_SHA) throw new Error("prompt de filtre : empreinte différente de CP");
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const pagesOf = async (id) => documentPages(await readFile(`${DIR}/full/corpus/text/${id}.txt`, "utf8"));

// ---- contrôle : les messages reconstruits ici sont octet-identiques à ceux envoyés par CP.
if (process.argv[2] === "--verify") {
  const dir = process.argv[3];
  let ok = 0; let ko = 0;
  for (const f of (await readdir(dir)).filter((n) => /^[a-z0-9-]+\.json$/.test(n))) {
    const d = JSON.parse(await readFile(`${dir}/${f}`, "utf8"));
    const doc = manifest.documents.find((x) => x.id === d.documentId);
    const user = filterUserMessage(doc, await pagesOf(doc.id), d.acts);
    if (sha(user) === d.receipt?.inputSha256 && d.promptSha256 === FILTER_SHA) ok += 1; else { ko += 1; console.log("DIFF", d.documentId); }
  }
  console.log(JSON.stringify({ verified: ok, different: ko }));
  process.exit(ko ? 1 : 0);
}

const effort = process.env.MUSE_EFFORT ?? "xhigh";
if (!["low", "xhigh"].includes(effort)) throw new Error(`Unsupported reviewer effort: ${effort}`);
const concurrency = Math.max(1, Math.min(8, Number(process.argv[2] ?? 4)));
const STOP = Number(process.env.STOP_WEEKLY_PCT ?? 85);
const RUN_CWD = process.env.MUSE_CWD ?? `${process.env.TMPDIR ?? "/tmp"}/muse-cp-plus-run`;
await mkdir(RUN_CWD, { recursive: true });
if ((await readdir(RUN_CWD)).length) throw new Error(`MUSE_CWD ${RUN_CWD} n'est pas vide`);
const srcDir = `${DIR}/full/arms/astra-medium-rejeu`;
if (existsSync(`${srcDir}/runner.lock`)) throw new Error("Wait for the Astra replay to finish");
for (const { id } of manifest.documents) {
  if (!existsSync(`${srcDir}/validated/medium--${id}.receipt.json`)) throw new Error(`Missing Astra validation: ${id}`);
}
const out = `${DIR}/full/arms/cp-plus-muse13-${effort}`;
for (const d of ["prompts", "jsonl", "raw", "usage", "decisions", "validated"]) await mkdir(`${out}/${d}`, { recursive: true });
const lockPath = `${out}/runner.lock`;
closeSync(openSync(lockPath, "wx"));
process.once("exit", () => { try { unlinkSync(lockPath); } catch { /* preserve original exit */ } });
const log = (row) => appendFile(`${out}/meta.jsonl`, `${JSON.stringify(row)}\n`);
const weekly = () => {
  try { return JSON.parse(execFileSync("muse", ["usage", "--json"], { encoding: "utf8", timeout: 60_000 })).allowance?.weekly?.usedPercent ?? null; }
  catch { return null; }
};
const quotaRe = /429|rate.?limit|overloaded|quota|capacity|usage limit/i;
const summary = { done: 0, skipped: 0, failed: 0, noAstraOutput: 0, noActs: 0 };
let stop = false;
const children = new Set();
const guard = () => {
  const used = weekly();
  if (STOP < 100 && (used === null || used >= STOP)) {
    stop = true;
    for (const child of children) child.kill("SIGTERM");
  }
  return used;
};
const w0 = weekly();
await log({ event: "START", weeklyUsedPercent: w0, at: new Date().toISOString(), concurrency, cwd: RUN_CWD });
if (STOP < 100 && (w0 === null || w0 >= STOP)) throw new Error(`Muse quota unavailable or at stop threshold: ${w0}`);
const watchdog = setInterval(() => {
  const used = guard();
  void log({ event: stop ? "WATCHDOG-STOP" : "WATCHDOG", weeklyUsedPercent: used, at: new Date().toISOString() });
}, 600_000);

const runMuse = (promptFile, jsonl) => new Promise((resolve) => {
  const t0 = Date.now();
  const child = spawn("timeout", ["1200", "muse", "exec", "--provider", "meta", "--model", "muse-spark-1.3", "--contributor-mode", "off",
    "--reasoning-effort", effort, "--prompt-file", promptFile, "--json"], { cwd: RUN_CWD, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const chunks = []; const err = [];
  child.stdout.on("data", (c) => chunks.push(c)); child.stderr.on("data", (c) => err.push(c));
  child.on("close", async (code) => {
    children.delete(child);
    await writeFile(jsonl, Buffer.concat(chunks)); await writeFile(`${jsonl}.stderr`, Buffer.concat(err));
    const stdout = Buffer.concat(chunks).toString("utf8");
    resolve({ code, ms: Date.now() - t0, quota: (code !== 0 || !stdout.includes('"run.terminal.completed"'))
      && quotaRe.test(Buffer.concat(err).toString("utf8") + stdout) });
  });
});

async function oneDoc(document) {
  const id = document.id;
  if (existsSync(`${out}/decisions/${id}.json`)) { summary.skipped += 1; return; }
  const srcOut = `${srcDir}/validated/medium--${id}.output.json`;
  if (!existsSync(srcOut)) { summary.noAstraOutput += 1; await log({ doc: id, event: "NO-ASTRA-OUTPUT" }); return; }
  const source = JSON.parse(await readFile(srcOut, "utf8"));
  const pages = await pagesOf(id);
  const acts = actsOf(source);
  const base = { documentId: id, sourceArm: "astra-medium-rejeu", promptSha256: FILTER_SHA, sourceOutputSha256: sha(JSON.stringify(source)),
    model: "muse-spark-1.3", effort, transport: "muse-exec-json" };
  let decisions = []; let rawText = null; let receipt = null;
  if (acts.length === 0) summary.noActs += 1;
  else {
    const user = filterUserMessage(document, pages, acts);
    const promptFile = `${out}/prompts/${id}.txt`;
    await writeFile(promptFile, `${filterPrompt}\n\n${user}`);
    for (let attempt = 1; ; attempt += 1) {
      const w = guard();
      if (stop) { await log({ doc: id, event: "WEEKLY-STOP", weeklyUsedPercent: w }); return; }
      const startedAt = new Date().toISOString();
      const jsonl = `${out}/jsonl/${id}.jsonl`;
      const r = await runMuse(promptFile, jsonl);
      await mkdir(`${out}/jsonl/attempts`, { recursive: true });
      const archive = `${out}/jsonl/attempts/${id}.${Date.parse(startedAt)}.jsonl`;
      await writeFile(archive, await readFile(jsonl));
      await writeFile(`${archive}.stderr`, await readFile(`${jsonl}.stderr`));
      if (stop || r.quota) {
        await log({ doc: id, event: stop ? "QUOTA-STOP" : "QUOTA", attempt, exit: r.code, ms: r.ms, startedAt });
        if (stop || attempt > 12) { stop = true; return; }
        await new Promise((s) => setTimeout(s, 300_000)); continue;
      }
      execFileSync("node", [`${SCRIPTS}/extract-usage.mjs`, jsonl, `${out}/raw/${id}.txt`, `${out}/usage/${id}.json`], { stdio: "ignore" });
      rawText = await readFile(`${out}/raw/${id}.txt`, "utf8");
      const usage = JSON.parse(await readFile(`${out}/usage/${id}.json`, "utf8"));
      await mkdir(`${out}/usage/attempts`, { recursive: true });
      await writeFile(`${out}/usage/attempts/${id}.${Date.parse(startedAt)}.json`, JSON.stringify(usage));
      receipt = { transport: "muse-exec-json", exit: r.code, latencyMs: r.ms, inputSha256: sha(user), promptFileSha256: sha(`${filterPrompt}\n\n${user}`), usage, startedAt, attempt };
      await log({ doc: id, exit: r.code, ms: r.ms, attempt, acts: acts.length, bytes: Buffer.byteLength(rawText), weeklyUsedPercent: usage.allowance?.weekly?.used_percent ?? null, model: usage.model, startedAt });
      if (r.code !== 0 || !rawText.trim()) { summary.failed += 1; await writeFile(`${out}/decisions/${id}.error.json`, JSON.stringify({ ...base, receipt, error: `exit ${r.code}` }, null, 1)); return; }
      try { decisions = parseJsonObject(rawText).decisions ?? []; }
      catch (e) { summary.failed += 1; await writeFile(`${out}/decisions/${id}.parse-error.json`, JSON.stringify({ ...base, rawText, parseError: String(e.message), receipt }, null, 1)); return; }
      break;
    }
  }
  const { filtered, log: filterLog } = applyDecisions(source, acts, decisions, pages);
  await writeFile(`${out}/decisions/${id}.json`, `${JSON.stringify({ ...base, acts, rawText, decisions, filter: filterLog, receipt }, null, 1)}\n`);
  await writeFile(`${out}/validated/${effort}--${id}.output.json`, JSON.stringify(filtered));
  summary.done += 1;
  console.log(`done ${id} acts=${acts.length} removed=${filterLog.removed.length}`);
}
const queue = [...manifest.documents];
await Promise.all(Array.from({ length: concurrency }, async () => { for (let d = queue.shift(); d && !stop; d = queue.shift()) await oneDoc(d); }));
clearInterval(watchdog);
const w1 = weekly();
await writeFile(`${out}/_summary.json`, `${JSON.stringify({ ...summary, stopped: stop, weeklyBefore: w0, weeklyAfter: w1, at: new Date().toISOString() }, null, 1)}\n`);
await log({ event: stop ? "STOPPED" : "DONE", weeklyUsedPercent: w1, at: new Date().toISOString() });
console.log(JSON.stringify({ ...summary, stopped: stop, weeklyBefore: w0, weeklyAfter: w1 }));

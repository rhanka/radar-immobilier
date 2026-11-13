// bench-v11 (v12, CP+) : rejeu du bras d'extraction GPT-6 Astra medium avec le transport codex du v10.
// Même chemin que tools/refresh-benchmark/v101-provider.mjs + run-arm.mjs (commit dd0561f6c) :
//   llm-mesh 0.19.3, compte « codex » du trousseau EncryptedFileKeyring, CodexRuntimeClient,
//   messages [system = manifest.promptFreeze.systemPrompt, user = « Schema: … \n\n prompt » (full/prompts/<id>.user.txt)],
//   reasoning.effort, responseFormat json-object, pas de plafond de sortie (Codex le refuse), délai 480 s.
// Siège seulement : refuse de tourner si une clé API est présente. Le quota de siège n'est jamais un refus :
// attente 300 s et reprise (12 au plus). Quota hebdomadaire codex lu sur wham/usage (champs de quota
// seulement, jamais de jeton) avant chaque document ; arrêt à STOP_CODEX_PCT (défaut 90).
// Usage : BENCH_MESH_DIR=<dossier contenant node_modules/@sentropic/llm-mesh> \
//   BENCHMARK_OWNER_SCOPE=<portée> node full/run-arm-astra-mesh.mjs [effort=medium] [concurrence=2]
// Sorties : full/arms/astra-<effort>-rejeu/{raw,usage}/<effort>--<doc>.*, meta.jsonl, codex-quota.jsonl.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MESH = process.env.BENCH_MESH_DIR;
const SCOPE = process.env.BENCHMARK_OWNER_SCOPE;
const KEYRING = process.env.BENCH_KEYRING ?? `${process.env.HOME}/.sentropic/llm-mesh-keyring`;
const effort = process.argv[2] ?? "medium";
const concurrency = Math.max(1, Math.min(4, Number(process.argv[3] ?? 2)));
const STOP = Number(process.env.STOP_CODEX_PCT ?? 90);
const TIMEOUT_MS = effort === "xhigh" ? 900_000 : 480_000;
if (!MESH || !SCOPE) throw new Error("BENCH_MESH_DIR et BENCHMARK_OWNER_SCOPE sont requis");
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MISTRAL_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
  if (process.env[k]) throw new Error(`${k} doit être absent : sièges seulement`);
}
const mod = (p) => import(pathToFileURL(`${MESH}/node_modules/@sentropic/llm-mesh/dist/${p}`).href);
const meshVersion = JSON.parse(await readFile(`${MESH}/node_modules/@sentropic/llm-mesh/package.json`, "utf8")).version;
if (meshVersion !== "0.19.3") throw new Error("Frozen transport requires llm-mesh 0.19.3");
const { CodexRuntimeClient } = await mod("index.js");
const { createLlmMeshFacade } = await mod("service/facade.js");
const { EncryptedFileKeyring } = await mod("node/index.js");
const sha = (s) => createHash("sha256").update(s).digest("hex");

const facade = createLlmMeshFacade({ mode: "cli", configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring(KEYRING) });
const accounts = (await facade.listAccounts({ ownerScope: SCOPE })).filter(({ providerId }) => providerId === "codex");
if (accounts.length !== 1) throw new Error(`un seul compte codex attendu, ${accounts.length} trouvé(s)`);
const account = accounts[0];
const pseudonym = `acct-${sha(account.accountId).slice(0, 10)}`;
const acquire = (affinityKey, requestId) => facade.acquire({ accountId: account.accountId, ownerScopeRef: SCOPE,
  targetProviderId: "openai", transportProviderId: "codex", modelId: "gpt-6-astra", affinityKey, requestId });

const armDir = `${DIR}/full/arms/astra-${effort}-rejeu`;
await mkdir(`${armDir}/raw`, { recursive: true });
await mkdir(`${armDir}/usage`, { recursive: true });
const log = (file, row) => appendFile(`${armDir}/${file}`, `${JSON.stringify(row)}\n`);

// Quota hebdomadaire codex (même source que codex-weekly-usage.mjs du v10) : seuls les champs de quota sortent.
async function codexWeekly(tag) {
  const acq = await acquire("cp-plus-quota", `cp-plus-quota-${Date.now()}`);
  try {
    const auth = acq.material;
    const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers: {
      authorization: `Bearer ${auth.accessToken}`, accept: "application/json", originator: "radar-refresh-benchmark",
      "user-agent": "@sentropic/llm-mesh-refresh-benchmark", ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}) } });
    const payload = await res.json().catch(() => null);
    const limits = payload?.rate_limit ?? {};
    const windows = Object.fromEntries(Object.entries(limits).filter(([, v]) => v && typeof v === "object")
      .map(([n, v]) => [n, { used_percent: v.used_percent ?? null, limit_window_seconds: v.limit_window_seconds ?? null, reset_at: v.reset_at ?? null }]));
    const weekly = Object.values(windows).find((w) => w.limit_window_seconds === 604_800) ?? null;
    const row = { at: new Date().toISOString(), tag, httpStatus: res.status, planType: payload?.plan_type ?? null,
      limitReached: limits.limit_reached ?? null, weeklyUsedPercent: weekly?.used_percent ?? null, windows };
    await log("codex-quota.jsonl", row);
    if (!res.ok || weekly?.used_percent == null) throw new Error("Codex weekly quota unavailable; stopping");
    return row;
  } finally { await facade.release(acq); }
}

const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const system = manifest.promptFreeze.systemPrompt;
if (sha(system) !== manifest.promptFreeze.systemPromptSha256) throw new Error("prompt système gelé : empreinte différente");
const quotaWords = /429|rate.?limit|usage.?limit|quota|too many requests/i;
let stop = false;
const before = await codexWeekly("avant");
console.log(JSON.stringify({ arm: `astra-${effort}-rejeu`, account: pseudonym, codexWeeklyBefore: before.weeklyUsedPercent }));
if (before.weeklyUsedPercent !== null && before.weeklyUsedPercent >= STOP) throw new Error(`quota codex ${before.weeklyUsedPercent} % ≥ ${STOP} %`);
if (process.env.QUOTA_ONLY === "1") { console.log(JSON.stringify({ planType: before.planType, httpStatus: before.httpStatus, windows: before.windows })); process.exit(0); }

const queue = manifest.documents.map((d) => d.id).filter((id) => !existsSync(`${armDir}/usage/${effort}--${id}.json`));
// Second exécutant possible (owner 13/11 : paralléliser) : 4e argument « reverse » = file prise par la fin ;
// un verrou par document (wx) évite qu'un document soit traité deux fois.
if (process.argv[4] === "reverse") {
  // 5e argument : index minimal du manifeste (moitié haute seulement, pour ne pas croiser le premier exécutant, qui ne pose pas de verrou).
  const minIdx = Number(process.argv[5] ?? 0); const idx = new Map(manifest.documents.map((d, i) => [d.id, i]));
  queue.splice(0, queue.length, ...queue.filter((id) => idx.get(id) >= minIdx).reverse());
}
console.log(`à faire : ${queue.length}`);
async function runDoc(id) {
  const user = await readFile(`${DIR}/full/prompts/${id}.user.txt`, "utf8");
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  for (let attempt = 1; attempt <= 13; attempt += 1) {
    const startedAt = new Date().toISOString(); const t0 = Date.now();
    const acq = await acquire(id, `cp-plus-astra-${effort}-${id}-${attempt}`);
    try {
      const client = new CodexRuntimeClient({});
      const r = await client.generate({ modelId: "gpt-6-astra", messages, reasoning: { effort },
        responseFormat: { type: "json-object" }, signal: AbortSignal.timeout(TIMEOUT_MS) }, { auth: acq.material });
      const text = r.text ?? "";
      await writeFile(`${armDir}/raw/${effort}--${id}.txt`, text);
      const usage = r.usage ?? null;
      await writeFile(`${armDir}/usage/${effort}--${id}.json`, JSON.stringify({ modelId: r.modelId ?? null, finishReason: r.finishReason ?? null, usage }, null, 1));
      await log("meta.jsonl", { arm: `astra-${effort}-rejeu`, doc: id, exit: 0, ms: Date.now() - t0, attempt, bytes: Buffer.byteLength(text),
        promptSha256: sha(`${system}\n\n${user}`), userSha256: sha(user), startedAt, modelId: r.modelId ?? null, finishReason: r.finishReason ?? null, usage });
      console.log(`done ${id} ${Date.now() - t0}ms bytes=${Buffer.byteLength(text)}`);
      return;
    } catch (error) {
      const msg = String(error?.message ?? error).slice(0, 300); const code = error?.code ?? error?.cause?.code ?? null;
      const status = error?.httpStatus ?? error?.status ?? null;
      const isQuota = status === 429 || quotaWords.test(msg) || quotaWords.test(String(code));
      await log("meta.jsonl", { arm: `astra-${effort}-rejeu`, doc: id, event: isQuota ? "QUOTA" : "ERROR", attempt, ms: Date.now() - t0, code, status, message: msg, startedAt });
      if (isQuota && attempt <= 12) { await new Promise((r) => setTimeout(r, 300_000)); continue; }
      if (!isQuota && attempt < 2) continue; // une reprise d'infrastructure, jamais comptée comme refus
      await log("meta.jsonl", { arm: `astra-${effort}-rejeu`, doc: id, exit: 1, attempt, code, status, message: msg });
      return;
    } finally { await facade.release(acq); }
  }
}
let done = 0;
async function worker() {
  for (let id = queue.shift(); id && !stop; id = queue.shift()) {
    if (done % 10 === 0) {
      const q = await codexWeekly(`garde-${done}`);
      if (q.weeklyUsedPercent !== null && q.weeklyUsedPercent >= STOP) { stop = true; await log("meta.jsonl", { event: "CODEX-STOP", weeklyUsedPercent: q.weeklyUsedPercent }); break; }
    }
    if (existsSync(`${armDir}/usage/${effort}--${id}.json`)) continue;
    try { writeFileSync(`${armDir}/raw/.lock-${id}`, String(process.pid), { flag: "wx" }); } catch { continue; }
    await runDoc(id); done += 1;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const after = await codexWeekly("après");
await log("meta.jsonl", { arm: `astra-${effort}-rejeu`, event: stop ? "ARM-STOPPED" : `ARM-DONE-C${concurrency}`, at: new Date().toISOString() });
console.log(JSON.stringify({ done, stopped: stop, codexWeeklyAfter: after.weeklyUsedPercent }));

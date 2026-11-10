// bench-v11 burn + usage capture: Gemini Argon low, 10 frozen docs, sequential.
// Same frozen prompts, same AGY model AND same invocation mode as the scored
// arm (run-arm-argon.mjs): AGY headless stream-json on stdin/stdout, so the
// burn is measured under the scored transport. (The burn published in the
// v11 dossier was measured earlier under the argv channel
// `agy --output-format json --print=<prompt>`; see dossier section 6, gap M2.)
// The extracted raw response (result.response) is written as <doc>.txt.
// Seat quota is never a refusal: wait 300 s and resume (max 12 attempts).
// No seat allowance counter is exposed by the AGY stream-json results (usage
// only); the seat burn therefore stays `missing source` unless a counter is
// read elsewhere.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const MODEL = "gemini-4-argon-low";
const OUTDIR = `${DIR}/full/burn-argon-usage10`;
await mkdir(OUTDIR, { recursive: true });
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const docs = manifest.documents.slice(0, 10).map((d) => d.id);
const QUOTA_RE = /429|rate.?limit|overloaded|quota|capacity|usage limit|individual quota/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runOnce(prompt) {
  return new Promise((resolve) => {
    const child = spawn("agy", ["--model", MODEL, "--input-format", "stream-json", "--output-format", "stream-json"], {
      cwd: process.env.BENCH_REPO ?? `${DIR}/../..`,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const outChunks = [];
    const errChunks = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 1200_000);
    child.stdout.on("data", (c) => outChunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, out: Buffer.concat(outChunks), err: Buffer.concat([...errChunks, Buffer.from(String(err))]) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out: Buffer.concat(outChunks), err: Buffer.concat(errChunks) }); });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ event: "user", message: { content: prompt } })}\n`, "utf8");
  });
}

for (const doc of docs) {
  const usagePath = `${OUTDIR}/${doc}.usage.json`;
  if (existsSync(usagePath)) {
    try {
      const u = JSON.parse(await readFile(usagePath, "utf8"));
      if (u.inputTokens !== null && u.inputTokens !== undefined) { console.log(`skip ${doc}`); continue; }
    } catch { /* rerun */ }
  }
  const prompt = await readFile(`${DIR}/full/prompts/${doc}.muse.txt`, "utf8");
  let attempt = 0;
  while (true) {
    attempt += 1;
    const start = Date.now();
    const startedAt = new Date().toISOString();
    const { code, out, err } = await runOnce(prompt);
    const ms = Date.now() - start;
    const endedAt = new Date().toISOString();
    await writeFile(`${OUTDIR}/${doc}.json`, out);
    await writeFile(`${OUTDIR}/${doc}.json.stderr`, err);
    const hay = `${err.toString("utf8")}\n${out.toString("utf8").slice(0, 4000)}`;
    if (code !== 0 && QUOTA_RE.test(hay) && attempt <= 12) {
      await appendFile(`${OUTDIR}/meta.jsonl`, `${JSON.stringify({ arm: "gemini-argon-low-burn10", doc, event: "QUOTA", attempt, ms, startedAt, endedAt })}\n`);
      console.log(`QUOTA ${doc} attempt=${attempt} wait 300s`);
      await sleep(300_000);
      continue;
    }
    let envelope = null;
    for (const line of out.toString("utf8").split("\n").filter(Boolean)) {
      try { const o = JSON.parse(line); if (o.event === "result") envelope = o.result ?? null; } catch { /* keep scanning */ }
    }
    const usage = envelope?.usage ?? null;
    const response = typeof envelope?.response === "string" ? envelope.response : "";
    await writeFile(`${OUTDIR}/${doc}.txt`, response, "utf8");
    await writeFile(usagePath, `${JSON.stringify({
      doc, model: MODEL, startedAt, endedAt, exit: code, ms, attempt,
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
      status: envelope?.status ?? null,
      conversationId: envelope?.conversation_id ?? null,
      durationSeconds: envelope?.duration_seconds ?? null,
      numTurns: envelope?.num_turns ?? null,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      thinkingTokens: usage?.thinking_tokens ?? null,
      cachedTokens: usage?.cache_read_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      responseChars: response.length,
      error: envelope?.error ?? null,
      finishedReason: envelope?.finished_reason ?? null,
    }, null, 1)}\n`, "utf8");
    await appendFile(`${OUTDIR}/meta.jsonl`, `${JSON.stringify({ arm: "gemini-argon-low-burn10", doc, exit: code, ms, attempt, startedAt, endedAt })}\n`);
    console.log(`done ${doc} exit=${code} ms=${ms} attempt=${attempt} in=${usage?.input_tokens ?? null} out=${usage?.output_tokens ?? null}`);
    break;
  }
}
await appendFile(`${OUTDIR}/meta.jsonl`, `${JSON.stringify({ arm: "gemini-argon-low-burn10", event: "BURN-DONE" })}\n`);
console.log("BURN DONE");

// bench-v11: Gemini Argon low seat arm (AGY CLI, subscription, no API key).
// Strictly same method as v11alpha: same frozen prompts (full/prompts/*.muse.txt,
// byte-exact file content sent as the turn content), same validation
// (validate-outputs.mjs) and same scoring (score-676.mjs, oracle 676).
// Only declared difference: concurrency 10 (owner amendment, as Muse Wonder low).
// Model: gemini-4-argon-low (AGY seat catalog; effort low encoded in the model id).
// Transport: AGY headless stream-json (stdin NDJSON -> stdout NDJSON):
//   agy --model gemini-4-argon-low --input-format stream-json --output-format stream-json
//   input line: {"event":"user","message":{"content":<frozen prompt bytes>}}
//   raw output file = result.response of the final `result` event.
// The stdin channel is used for every document (uniform transport): the argv
// channel (--print=<prompt>) hits the Linux 128 KiB single-argument limit
// (spawn E2BIG) on the largest frozen prompts. Pass 1 (argv, 53/100 docs,
// 3 toolbox errors, crash on E2BIG before any validation/scoring) is archived
// under arms/gemini-argon-low/pass1-print-raw/ and is not scored.
// Seat quota is never a refusal: on quota text, wait 300 s and resume (max 12 attempts).
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";

const DIR = "/home/antoinefa/src/radar-immobilier-bench/tmp/bench-wonder";
const ARM = "gemini-argon-low";
const MODEL = "gemini-4-argon-low";
const ARM_DIR = `${DIR}/full/arms/${ARM}`;
const CONCURRENCY = 1;
const TIMEOUT_MS = 1200_000;
const QUOTA_RE = /429|rate.?limit|overloaded|quota|capacity|usage limit|individual quota/i;

await mkdir(`${ARM_DIR}/raw`, { recursive: true });
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const docs = manifest.documents.map((d) => d.id);

let metaChain = Promise.resolve();
const appendMeta = (obj) => {
  metaChain = metaChain.then(() => appendFile(`${ARM_DIR}/meta.jsonl`, `${JSON.stringify(obj)}\n`, "utf8"));
  return metaChain;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runOnce(prompt, stderrPath, streamPath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("agy", ["--model", MODEL, "--input-format", "stream-json", "--output-format", "stream-json"], {
        cwd: "/home/antoinefa/src/radar-immobilier-bench",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ code: -1, result: null, streamText: "", err: Buffer.from(String(err)) });
      return;
    }
    const outChunks = [];
    const errChunks = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (c) => outChunks.push(c));
    child.stderr.on("data", (c) => errChunks.push(c));
    child.on("error", async (err) => {
      clearTimeout(timer);
      const errBuf = Buffer.concat([...errChunks, Buffer.from(String(err))]);
      const streamText = Buffer.concat(outChunks).toString("utf8");
      await writeFile(stderrPath, errBuf).catch(() => {});
      await writeFile(streamPath, streamText).catch(() => {});
      resolve({ code: -1, result: null, streamText, err: errBuf });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      const errBuf = Buffer.concat(errChunks);
      const streamText = Buffer.concat(outChunks).toString("utf8");
      await writeFile(stderrPath, errBuf).catch(() => {});
      await writeFile(streamPath, streamText).catch(() => {});
      let result = null;
      for (const line of streamText.split("\n").filter(Boolean)) {
        try {
          const o = JSON.parse(line);
          if (o.event === "result") result = o.result ?? null;
        } catch { /* keep scanning */ }
      }
      resolve({ code: code ?? -1, result, streamText, err: errBuf });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ event: "user", message: { content: prompt } })}\n`, "utf8");
  });
}

async function runDoc(doc) {
  const outPath = `${ARM_DIR}/raw/low--${doc}.txt`;
  const stderrPath = `${outPath}.stderr`;
  const streamPath = `${ARM_DIR}/raw/low--${doc}.stream.jsonl`;
  try {
    const st = await stat(outPath);
    if (st.size > 0) { console.log(`skip ${doc}`); return; }
  } catch { /* run */ }
  const prompt = await readFile(`${DIR}/full/prompts/${doc}.muse.txt`, "utf8");
  let attempt = 0;
  while (true) {
    attempt += 1;
    const start = Date.now();
    const { code, result, err } = await runOnce(prompt, stderrPath, streamPath);
    const ms = Date.now() - start;
    const status = result?.status ?? null;
    const response = typeof result?.response === "string" ? result.response : "";
    const errorText = `${err.toString("utf8")}\n${result?.error ?? ""}`;
    const isQuota = QUOTA_RE.test(errorText);
    if (isQuota && attempt <= 12 && (code !== 0 || status !== "SUCCESS")) {
      await appendMeta({ arm: ARM, doc, event: "QUOTA", attempt, ms });
      console.log(`QUOTA ${doc} attempt=${attempt} ms=${ms} wait 300s`);
      await sleep(300_000);
      continue;
    }
    const okRun = status === "SUCCESS" && response.length > 0;
    const outBuf = Buffer.from(response, "utf8");
    if (!okRun) {
      await unlink(outPath).catch(() => {});
    } else {
      await writeFile(outPath, outBuf);
    }
    await appendMeta({
      arm: ARM, doc, exit: code, status, ms, attempt, bytes: okRun ? outBuf.length : 0,
      inputTokens: result?.usage?.input_tokens ?? null,
      outputTokens: result?.usage?.output_tokens ?? null,
      thinkingTokens: result?.usage?.thinking_tokens ?? null,
      cachedTokens: result?.usage?.cache_read_tokens ?? null,
      durationSeconds: result?.duration_seconds ?? null,
      conversationId: result?.conversation_id ?? null,
      error: okRun ? null : (result?.error ?? `exit=${code}`),
    });
    console.log(`done ${doc} exit=${code} status=${status} ms=${ms} bytes=${okRun ? outBuf.length : 0} attempt=${attempt}`);
    break;
  }
}

let next = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= docs.length) return;
    await runDoc(docs[i]);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
await appendMeta({ arm: ARM, event: "ARM-DONE-SEQRETRY" });
await metaChain;
console.log("ALL DONE");

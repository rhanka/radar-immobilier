// bench-v11: single-arm driver for Muse Ember (xhigh | max), reuses
// score-676.mjs scoreSource exactly (same code path as score-wonder.mjs).
// Usage: node full/score-ember.mjs <effort>   -> full/scores-ember-<effort>.json
// Tokens: real provider usage (`muse exec --json`, run.usage) on every
// completed document of the arm (usage/<effort>--<doc>.usage.json).
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const effort = process.argv[2];
if (!["xhigh", "max"].includes(effort)) throw new Error("usage: score-ember.mjs <xhigh|max>");
const { scoreSource } = await import(`${DIR}/full/score-676.mjs`);
const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const quantile = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const arm = `muse-ember-${effort}`;
const armDir = `${DIR}/full/arms/${arm}`;
const meta = (await readFile(`${armDir}/meta.jsonl`, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const done = meta.filter((r) => r.exit !== undefined);
const quotas = meta.filter((r) => r.event === "QUOTA");
const stops = meta.filter((r) => r.event === "WEEKLY-STOP" || r.event === "ARM-STOPPED");
const resolveDoc = async (documentId) => {
  const out = `${armDir}/validated/${effort}--${documentId}.output.json`;
  if (!existsSync(out)) return { state: "refused_or_missing" };
  return { state: "accepted", output: JSON.parse(await readFile(out, "utf8")) };
};
const scored = await scoreSource(arm, "muse-ember-seat", resolveDoc);
const failClasses = { J: 0, V: 0, Pr: 0, T: 0 };
for (const d of manifest.documents) {
  const rc = `${armDir}/validated/${effort}--${d.id}.receipt.json`;
  if (existsSync(rc)) { const fc = JSON.parse(await readFile(rc, "utf8")).validation.failureClass;
    if (fc === "json") failClasses.J += 1; else if (fc === "profile") failClasses.V += 1; else if (fc === "provenance") failClasses.Pr += 1;
  } else failClasses.T += 1;
}
// Latency: last completed attempt per document (exit recorded).
const lastByDoc = new Map();
for (const r of done) lastByDoc.set(r.doc, r);
const last = [...lastByDoc.values()];
const ok = last.filter((r) => r.exit === 0);
const usages = [];
for (const f of (await readdir(`${armDir}/usage`)).filter((n) => n.endsWith(".usage.json")).sort()) {
  const u = JSON.parse(await readFile(`${armDir}/usage/${f}`, "utf8"));
  if (u.inputTokens !== null && u.inputTokens !== undefined) usages.push({ doc: f.replace(/\.usage\.json$/, "").split("--").slice(1).join("--"), ...u });
}
const uMean = (key) => usages.length ? usages.reduce((s, u) => s + (u[key] ?? 0), 0) / usages.length : null;
const modelIds = [...new Set(usages.map((u) => u.model))];
const termModelIds = [...new Set(last.map((r) => r.term?.modelId ?? null))];
const outBytesMean = ok.length ? ok.reduce((s, r) => s + r.bytes, 0) / ok.length : null;
const row = { arm, model: "muse-ember-1.0", effort, docs: manifest.documents.length,
  completed: last.length, exit0: ok.length, attempts: done.length, quotaEvents: quotas.length, stopEvents: stops.length,
  accepted: scored.accepted, strict: scored.net, broad: scored.broad,
  stageTolerant: scored.stageTolerant, soft: scored.soft, f1n4: scored.human4.f1, failClasses,
  p50s: quantile(last.map((r) => r.ms), 0.5) / 1000, p90s: quantile(last.map((r) => r.ms), 0.9) / 1000,
  modelIdsUsage: modelIds, modelIdsConfigured: termModelIds,
  tokens: { note: "real provider usage from muse exec --json run.usage (all docs with usage)", n: usages.length,
    inTokensMean: uMean("inputTokens"), outTokensMean: uMean("outputTokens"),
    reasoningTokensMean: uMean("reasoningTokens"), cachedTokensMean: uMean("cachedTokens"), outBytesMean },
  usages };
await writeFile(`${DIR}/full/scores-ember-${effort}.json`, JSON.stringify({ arms: [row], cases: scored.cases }, null, 1));
const { usages: _u, ...printable } = row;
console.log(JSON.stringify(printable, null, 1));

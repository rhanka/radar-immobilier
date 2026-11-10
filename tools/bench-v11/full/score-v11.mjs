// bench-v11: aggregate the 11 seat arms into SUMMARY-ready rows.
// Reads arms/<arm>/meta.jsonl + arms/<arm>/validated/*.output.json,
// scores against oracle 676 via score-676.mjs scoreSource.
// Usage: node score-v11.mjs  (writes full/scores-v11.json)
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR = process.env.BENCH_DIR ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { scoreSource } = await import(`${DIR}/full/score-676.mjs`);

const OPUS_ARMS = ["off", "low", "medium", "high", "xhigh"].map((e) => ({
  arm: `opus55-${e}`, kind: "opus55-seat", effort: e,
  model: "claude-opus-5-5", promptFile: (id) => `${DIR}/full/prompts/${id}.user.txt`,
}));
const MUSE_ARMS = ["minimal", "low", "medium", "high", "xhigh", "max"].map((e) => ({
  arm: `muse13-${e}`, kind: "muse13-seat", effort: e,
  model: "muse-spark-1.3", promptFile: (id) => `${DIR}/full/prompts/${id}.muse.txt`,
}));
const F_SEAT_CLAUDE = 0.030248; // v10 burn, Claude Max 20x
const MUSE_RATE = { input: 1.25, output: 4.25 }; // Meta standard tier (secondary sources)

const manifest = JSON.parse(await readFile(`${DIR}/harness/manifest-v101b.json`, "utf8"));
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const rows = [];
for (const spec of [...OPUS_ARMS, ...MUSE_ARMS]) {
  const armDir = `${DIR}/full/arms/${spec.arm}`;
  let meta = [];
  try {
    meta = (await readFile(`${armDir}/meta.jsonl`, "utf8")).split("\n")
      .filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* meta.jsonl absent: no runs */ }
  const done = meta.filter((r) => r.exit !== undefined);
  const resolveDoc = async (documentId) => {
    const prefix = spec.kind === "opus55-seat" ? spec.effort : spec.effort;
    const out = `${armDir}/validated/${prefix}--${documentId}.output.json`;
    if (!existsSync(out)) return { state: "refused_or_missing" };
    return { state: "accepted", output: JSON.parse(await readFile(out, "utf8")) };
  };
  const scored = await scoreSource(spec.arm, spec.kind, resolveDoc);
  const ms = done.map((r) => r.ms);
  const failClasses = { J: 0, V: 0, Pr: 0, T: 0 };
  for (const d of manifest.documents) {
    const prefix = spec.effort;
    const rc = `${armDir}/validated/${prefix}--${d.id}.receipt.json`;
    if (existsSync(rc)) {
      const fc = JSON.parse(await readFile(rc, "utf8")).validation.failureClass;
      if (fc === "json") failClasses.J += 1;
      else if (fc === "profile") failClasses.V += 1;
      else if (fc === "provenance") failClasses.Pr += 1;
    } else {
      failClasses.T += 1; // transport: exit≠0, timeout, or never completed
    }
  }
  const row = { arm: spec.arm, model: spec.model, effort: spec.effort,
    docs: manifest.documents.length, completed: done.length,
    accepted: scored.accepted, strict: scored.net, broad: scored.broad,
    f1n4: scored.human4.f1, failClasses,
    p50s: quantile(ms, 0.5) == null ? null : quantile(ms, 0.5) / 1000,
    p90s: quantile(ms, 0.9) == null ? null : quantile(ms, 0.9) / 1000 };
  if (spec.kind === "opus55-seat") {
    const ok = done.filter((r) => r.exit === 0);
    const mean = (f) => ok.length ? ok.reduce((s, r) => s + (r[f] ?? 0), 0) / ok.length : null;
    const apiEquiv = ok.length ? ok.reduce((s, r) => s + (r.costUsd ?? 0), 0) / ok.length : null;
    row.tokens = { inMean: mean("inTok"), cacheMkMean: mean("cacheMk"),
      cacheRdMean: mean("cacheRd"), outMean: mean("outTok"), thinkMean: mean("thinkTok") };
    row.usdApiEquivPerDoc = apiEquiv;
    row.usdSeatPerDoc = apiEquiv == null ? null : apiEquiv * F_SEAT_CLAUDE;
    row.seatsPer1000 = row.usdSeatPerDoc == null ? null : row.usdSeatPerDoc * 1000;
  } else {
    const ok = done.filter((r) => r.exit === 0);
    let inBytes = 0;
    for (const d of manifest.documents) {
      try { inBytes += (await readFile(spec.promptFile(d.id))).length; } catch { /* prompt absent: skip */ }
    }
    row.tokens = { note: "estimated bytes/4, no provider usage on muse exec",
      inBytesMean: inBytes / manifest.documents.length,
      outBytesMean: ok.length ? ok.reduce((s, r) => s + r.bytes, 0) / ok.length : null };
    const inTok = row.tokens.inBytesMean / 4;
    const outTok = row.tokens.outBytesMean == null ? null : row.tokens.outBytesMean / 4;
    row.usdApiEquivPerDoc = outTok == null ? null
      : (inTok * MUSE_RATE.input + outTok * MUSE_RATE.output) / 1_000_000;
    row.usdSeatPerDoc = null; // Muse seat plan unobservable
    row.seatsPer1000 = null;
  }
  rows.push(row);
  console.log(`${row.arm}: done=${row.completed} acc=${row.accepted} F1=${row.strict.f1?.toFixed(3) ?? "n/a"}`);
}
await writeFile(`${DIR}/full/scores-v11.json`, JSON.stringify({ arms: rows }, null, 1));

// bench-v11: generate the full v11 dossier (Markdown + SVG charts + HTML)
// from frozen published rows (v10/v11alpha, never altered) plus the two new
// seat arms scored in tmp/bench-wonder (Muse Wonder low, Gemini Argon low).
// PDF is produced afterwards with Chromium headless --print-to-pdf.
// Usage (from repo root):
//   node tools/bench-v11/build-v11-report.mjs [benchTmpDir] [outPrefix]
// Defaults: benchTmpDir=tmp/bench-wonder, outPrefix=docs/reports/benchmark-v11-2026-11-09
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// Mode v12 (BENCH_REPORT=v12): v11 rows + Muse Ember xhigh/max arms
// (BENCH_EMBER_DIR, default tools/bench-v11) and v10-style charts
// (charts-v12.mjs) -> docs/reports/benchmark-v12-2026-11-13.* and
// assets/2026-11/benchmark-v12-*.svg. Without it: the v11 dossier of
// 2026-11-09, byte for byte.
const V12 = process.env.BENCH_REPORT === "v12";
const TMP = process.argv[2] ?? "tmp/bench-wonder";
const OUT = process.argv[3] ?? (V12 ? "docs/reports/benchmark-v12-2026-11-13" : "docs/reports/benchmark-v11-2026-11-09");
const ASSETS = "docs/reports/assets/2026-11";
const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v)) ? "N-A" : v.toFixed(d);
const fmtUsd = (v) => (v === null || v === undefined) ? "missing source" : (v < 0.01 ? v.toFixed(5) : v.toFixed(4));

// ---- Published rows: v11alpha section 2 (oracle 676) + costs from v10
// section 5 (unchanged by the 676 rescore) and v11alpha section 3.
// api/seat: USD per document; null = missing source (never estimated here).
// flag "a" = value carried from v10 report (oracle 674) as published in v11alpha.
const OLD = [
  // label, accepted, P, R, F1, apiUsd, seatUsd, flag
  ["CP actuel (astra-medium → gemini low)", 99, 0.484, 0.533, 0.507, 0.48134, 0.021214, ""],
  ["CP-low (astra-low → gemini low)", 100, 0.479, 0.491, 0.485, null, null, ""],
  ["Astra medium", 99, 0.371, 0.534, 0.438, 0.46894, 0.02074, ""],
  ["Astra low", 100, 0.373, 0.491, 0.424, 0.40724, 0.01801, ""],
  ["Sol medium", 94, 0.444, 0.398, 0.420, 0.26855, 0.01188, "a"],
  ["Sol low", 90, 0.465, 0.358, 0.404, 0.19671, 0.00870, "a"],
  ["C2", 100, 0.456, 0.358, 0.401, 0.06895, 0.00277, "a"],
  ["C3", 100, 0.461, 0.353, 0.400, 0.05427, 0.00211, "a"],
  ["Sol xhigh", 85, 0.308, 0.488, 0.378, 0.54978, 0.02432, ""],
  ["Gemini low", 85, 0.475, 0.300, 0.368, 0.03764, 0.00143, ""],
  ["Sol high", 82, 0.377, 0.337, 0.356, 0.34596, 0.01530, ""],
  ["Opus 5.5 medium (siège)", 93, 0.328, 0.311, 0.319, 0.4999, 0.01512, ""],
  ["Opus 5 low (API)", 74, 0.350, 0.292, 0.319, 0.39756, 0.01203, "a"],
  ["Gemini medium", 79, 0.449, 0.223, 0.298, 0.05386, 0.00204, ""],
  ["Opus 5 off (API)", 68, 0.314, 0.258, 0.283, 0.65071, 0.01968, "a"],
  ["Opus 5 high (API)", 63, 0.318, 0.251, 0.280, 0.64717, 0.01958, "a"],
  ["Astra high", 68, 0.289, 0.260, 0.274, 0.58955, 0.02608, ""],
  ["Astra xhigh", 65, 0.252, 0.297, 0.273, 0.99288, 0.04392, ""],
  ["Muse 1.3 medium (siège)", 80, 0.355, 0.207, 0.262, 0.0305, null, ""],
  ["Opus 5.5 low (siège)", 90, 0.325, 0.217, 0.260, 0.4239, 0.01282, ""],
  ["Muse 1.3 xhigh (siège)", 93, 0.302, 0.225, 0.258, 0.0343, null, ""],
  ["Luna medium", 51, 0.454, 0.175, 0.252, 0.01172, 0.00052, ""],
  ["Luna high", 43, 0.371, 0.185, 0.247, 0.01993, 0.00088, ""],
  ["Sonnet 5 high", 70, 0.330, 0.193, 0.243, 0.22953, 0.00694, "a"],
  ["Sonnet 5 off", 62, 0.333, 0.185, 0.238, 0.23072, 0.00698, "a"],
  ["Muse 1.3 low (siège)", 77, 0.347, 0.170, 0.228, 0.0284, null, ""],
  ["Gemini high", 53, 0.386, 0.141, 0.206, 0.11232, 0.00426, ""],
  ["Muse 1.3 high (siège)", 80, 0.297, 0.155, 0.204, 0.0310, null, ""],
  ["Sonnet 5 low", 58, 0.393, 0.136, 0.203, 0.11143, 0.00337, "a"],
  ["Luna xhigh", 47, 0.240, 0.147, 0.182, 0.03459, 0.00153, "a"],
  ["Luna low", 39, 0.448, 0.109, 0.176, 0.00949, 0.00042, ""],
  ["Muse 1.3 minimal (siège)", 50, 0.385, 0.102, 0.161, 0.0279, null, ""],
  ["Sonnet 4.6 off (Cloud Code)", 32, 0.307, 0.096, 0.146, 0.17499, null, ""],
  ["Sonnet 4.6 low (Cloud Code)", 14, 0.453, 0.058, 0.102, 0.14782, null, ""],
  ["Muse 1.3 max (siège, coupé)", 8, 0.606, 0.030, 0.056, null, null, ""],
  ["GPT-4.1 off", 64, 0.048, 0.013, 0.021, 0.05425, null, ""],
  ["Mistral Small 4 off", 40, 0.227, 0.007, 0.014, 0.00500, null, ""],
  ["Sonnet 4.6 high (Cloud Code)", 0, null, 0.000, 0.000, null, null, ""],
].map(([label, accepted, p, r, f1, api, seat, flag]) => ({ label, accepted, p, r, f1, api, seat, flag, isNew: false }));

// Published seat-arm detail (v11alpha section 3). tokOut null = N-A published.
const DETAIL_OLD = [
  // bras, tentés, acceptés, J, V, T, f1n4, p50, p90, tokOut, api, seat
  ["Opus 5.5 low", 100, 90, 0, 6, 4, 0.143, 49, 97, 6188, 0.4239, 0.01282],
  ["Opus 5.5 medium", 100, 93, 0, 3, 4, 0.388, 75, 150, 10269, 0.4999, 0.01512],
  ["Muse 1.3 minimal", 100, 50, 18, 32, 0, 0.167, 27, 45, null, 0.0279, null],
  ["Muse 1.3 low", 100, 77, 3, 20, 0, 0.386, 35, 61, null, 0.0284, null],
  ["Muse 1.3 medium", 100, 80, 2, 18, 0, 0.515, 63, 102, null, 0.0305, null],
  ["Muse 1.3 high", 100, 80, 10, 10, 0, 0.415, 76, 147, null, 0.0310, null],
  ["Muse 1.3 xhigh", 100, 93, 3, 4, 0, 0.241, 107, 157, null, 0.0343, null],
];

// ---- New arms from scored files ----
const wonderScores = JSON.parse(await readFile(`${TMP}/full/scores-wonder.json`, "utf8")).arms[0];
const argonScores = JSON.parse(await readFile(`${TMP}/full/scores-argon.json`, "utf8")).arms[0];

async function readUsageDir(dir) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".usage.json")).sort();
  const rows = [];
  for (const f of files) { try { rows.push(JSON.parse(await readFile(`${dir}/${f}`, "utf8"))); } catch { /* ignore */ } }
  return rows;
}
const wonderBurn = (await readUsageDir(`${TMP}/full/burn-wonder-usage10`)).filter((u) => u.inputTokens !== null && u.inputTokens !== undefined);
const argonBurn = (await readUsageDir(`${TMP}/full/burn-argon-usage10`)).filter((u) => u.inputTokens !== null && u.inputTokens !== undefined);
const mean = (rows, key) => rows.length ? rows.reduce((s, r) => s + (r[key] ?? 0), 0) / rows.length : null;

// Muse Wonder API equivalent (burn n=10, real tokens):
// [(I-C)*4.00 + C*0.20 + O*20.00] / 1e6 ; reasoning shown separately.
const wonderApiBurn = wonderBurn.length ? wonderBurn.reduce((s, u) => s
  + (((u.inputTokens - (u.cachedTokens ?? 0)) * 4.00) + ((u.cachedTokens ?? 0) * 0.20) + (u.outputTokens * 20.00)) / 1e6, 0) / wonderBurn.length : null;
const wonderApiBurnWithReasoning = wonderBurn.length ? wonderBurn.reduce((s, u) => s
  + (((u.inputTokens - (u.cachedTokens ?? 0)) * 4.00) + ((u.cachedTokens ?? 0) * 0.20) + ((u.outputTokens + (u.reasoningTokens ?? 0)) * 20.00)) / 1e6, 0) / wonderBurn.length : null;

// Argon tokens from the scored arm itself (stream-json usage on all docs).
const argonMeta = (await readFile(`${TMP}/full/arms/gemini-argon-low/meta.jsonl`, "utf8"))
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const argonDone = argonMeta.filter((r) => r.exit !== undefined);
const argonOk = argonDone.filter((r) => r.status === "SUCCESS");
const argonQuota = argonMeta.filter((r) => r.event === "QUOTA").length;
const argonTok = {
  in: mean(argonOk, "inputTokens"), out: mean(argonOk, "outputTokens"),
  think: mean(argonOk, "thinkingTokens"), cached: mean(argonOk, "cachedTokens"),
};
// Gemini 4 Argon API equivalent: [(I-C)*2.00 + C*0.10 + (O+T)*10.00] / 1e6
// (tarif en vigueur au 2026-11-09, avant le doublement du 2026-12-01).
const argonApiArm = argonOk.length ? argonOk.reduce((s, r) => s
  + ((((r.inputTokens ?? 0) - (r.cachedTokens ?? 0)) * 2.00) + ((r.cachedTokens ?? 0) * 0.10)
    + (((r.outputTokens ?? 0) + (r.thinkingTokens ?? 0)) * 10.00)) / 1e6, 0) / argonOk.length : null;
const argonApiBurn = argonBurn.length ? argonBurn.reduce((s, u) => s
  + ((((u.inputTokens ?? 0) - (u.cachedTokens ?? 0)) * 2.00) + ((u.cachedTokens ?? 0) * 0.10)
    + (((u.outputTokens ?? 0) + (u.thinkingTokens ?? 0)) * 10.00)) / 1e6, 0) / argonBurn.length : null;

// ---- Burn /usage follow-up (2026-11-09, lane COST) ----
// AGY : /usage lu en headless (agy -p "/usage" --output-format json), fractions
// remaining_fraction avant/apres un burn sequentiel de 10 documents (memes
// prompts geles, meme runner que run-burn-argon.mjs, concurrence 1, aucun
// autre processus agy sur le siege). Muse : muse usage (texte + --json),
// lectures directes sans tour modele, meme echantillon (run-burn-usage-*).
const AGY_USAGE_FOLLOWUP = {
  beforeAt: "2026-11-09T20:26:10.352Z", afterAt: "2026-11-09T20:47:12.377Z",
  weeklyBefore: 0.9517107009887695, weeklyAfter: 0.9499691724777222,
  h5Before: 0.8068429231643677, h5After: 0.7998764514923096,
  weeklyReset: "2026-11-16T16:00:42Z", h5Reset: "2026-11-09T21:00:42Z",
  docs: 10, inTok: 17614.3, outTok: 10410,
};
const agyWeeklySharePerDoc = (AGY_USAGE_FOLLOWUP.weeklyBefore - AGY_USAGE_FOLLOWUP.weeklyAfter) / AGY_USAGE_FOLLOWUP.docs;
const MONTH_DAYS = 365.25 / 12;
const ultra20xWeeklyUsd = 199.99 * 7 / MONTH_DAYS;
const argonSeatUsd20x = agyWeeklySharePerDoc * ultra20xWeeklyUsd;
const wonderRow = {
  label: "Muse Wonder low (siège)", accepted: wonderScores.accepted,
  p: wonderScores.strict.precision, r: wonderScores.strict.recall, f1: wonderScores.strict.f1,
  api: wonderApiBurn, seat: null, flag: "", isNew: true,
};
const argonRow = {
  label: "Gemini Argon low (siège AGY)", accepted: argonScores.accepted,
  p: argonScores.strict.precision, r: argonScores.strict.recall, f1: argonScores.strict.f1,
  api: argonApiArm, seat: argonSeatUsd20x, flag: "", isNew: true,
};
// ---- Muse Ember arms (update 2026-11-12, benchmark B lane) ----
// v12 mode only: read from BENCH_EMBER_DIR (default tools/bench-v11), which
// holds full/scores-ember-{xhigh,max}.json (score-ember.mjs). In v11 mode the
// dossier is emitted exactly as published on 2026-11-09.
// muse-ember-1.0 API equivalent on real arm tokens (all docs with usage),
// primary tariff dev.meta.ai/models/muse-ember/ read 2026-11-13:
// <=200k context 0.10 in / 0.004 cached / 0.50 out ; >200k 0.30 / 0.012 / 1.50.
const EMBER_DIR = V12 ? (process.env.BENCH_EMBER_DIR ?? "tools/bench-v11") : null;
const EMBER_PRICE = { threshold: 200_000, lo: { i: 0.10, c: 0.004, o: 0.50 }, hi: { i: 0.30, c: 0.012, o: 1.50 } };
const emberDocUsd = (u, withReasoning) => {
  const t = (u.inputTokens > EMBER_PRICE.threshold) ? EMBER_PRICE.hi : EMBER_PRICE.lo;
  const c = u.cachedTokens ?? 0;
  const o = u.outputTokens + (withReasoning ? (u.reasoningTokens ?? 0) : 0);
  return (((u.inputTokens - c) * t.i) + (c * t.c) + (o * t.o)) / 1e6;
};
const EMBER = [];
if (EMBER_DIR) {
  for (const effort of ["xhigh", "max"]) {
    const path = `${EMBER_DIR}/full/scores-ember-${effort}.json`;
    if (!existsSync(path)) continue;
    const s = JSON.parse(await readFile(path, "utf8")).arms[0];
    const us = s.usages ?? [];
    const api = us.length ? us.reduce((acc, u) => acc + emberDocUsd(u, false), 0) / us.length : null;
    const apiR = us.length ? us.reduce((acc, u) => acc + emberDocUsd(u, true), 0) / us.length : null;
    const hiDocs = us.filter((u) => u.inputTokens > EMBER_PRICE.threshold).length;
    const allow = us.filter((u) => u.allowance?.weekly).sort((a, b) => (a.allowance.as_of_ms ?? 0) - (b.allowance.as_of_ms ?? 0));
    // CLI access surface (audit-muse-surface.mjs) and sensitivity of the
    // tool-call documents (score-ember-sensitivity.mjs): required evidence.
    const armDir = `${EMBER_DIR}/full/arms/muse-ember-${effort}`;
    const surface = JSON.parse(await readFile(`${armDir}/surface.json`, "utf8"));
    const sensPath = `${EMBER_DIR}/full/scores-ember-${effort}-sensitivity.json`;
    const sens = existsSync(sensPath) ? JSON.parse(await readFile(sensPath, "utf8")) : null;
    const meta = (await readFile(`${armDir}/meta.jsonl`, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const runs = meta.filter((m) => m.startedAt && m.ms !== undefined);
    const window = runs.length ? { start: Math.min(...runs.map((m) => Date.parse(m.startedAt))),
      end: Math.max(...runs.map((m) => Date.parse(m.startedAt) + m.ms)) } : null;
    EMBER.push({ effort, s, api, apiR, hiDocs, allow, surface, sens, window,
      row: { label: `Muse Ember ${effort} (siège)`, accepted: s.accepted, p: s.strict.precision, r: s.strict.recall,
        f1: s.strict.f1, api, seat: null, flag: "", isNew: true } });
  }
}
if (V12 && EMBER.length !== 2) throw new Error(`v12 needs scores-ember-{xhigh,max}.json under ${EMBER_DIR}/full`);
// v12: full versioned model names (sources: v10 report « Noms des modèles »,
// v11alpha §1, v11 §2). [short prefix, full name, provider id]
const MODEL_NAMES = [
  ["Astra", "GPT-6 Astra", "gpt-6-astra"], ["Sol", "GPT-5.6 Sol", "gpt-5.6-sol"], ["Luna", "GPT-5.6 Luna", "gpt-5.6-luna"],
  ["GPT-4.1", "GPT-4.1", "gpt-4.1"], ["Gemini Argon", "Gemini 4 Argon", "gemini-4-argon-low"], ["Gemini", "Gemini 3.8 Flash", "gemini-3.8-flash"],
  ["Opus 5.5", "Opus 5.5", "claude-opus-5-5"], ["Opus 5", "Opus 5", "claude-opus-5"], ["Sonnet 5", "Sonnet 5", "claude-sonnet-5"],
  ["Sonnet 4.6", "Sonnet 4.6", "claude-sonnet-4.6"], ["Muse 1.3", "Muse Spark 1.3", "muse-spark-1.3"],
  ["Muse Wonder", "Muse Wonder 1.0", "muse-wonder-1.0"], ["Muse Ember", "Muse Ember 1.0", "muse-ember-1.0"],
  ["Mistral Small 4", "Mistral Small 4", "mistral-small-2603"],
];
const CASCADES = {
  "CP actuel (astra-medium → gemini low)": ["CP actuel (GPT-6 Astra medium → Gemini 3.8 Flash low)", "CP actuel : GPT-6 Astra → Gemini 3.8 Flash", "medium → low"],
  "CP-low (astra-low → gemini low)": ["CP-low (GPT-6 Astra low → Gemini 3.8 Flash low)", "CP-low : GPT-6 Astra → Gemini 3.8 Flash", "low → low"],
  // v10 policies: C2 = 2 essais Gemini puis Astra (#719) ; C3 = 3 essais Gemini puis Astra.
  C2: ["C2 (2× Gemini 3.8 Flash low → repli GPT-6 Astra)", "C2 : 2× Gemini 3.8 Flash → repli GPT-6 Astra", "low (2 essais) → repli"],
  C3: ["C3 (3× Gemini 3.8 Flash low → repli GPT-6 Astra)", "C3 : 3× Gemini 3.8 Flash → repli GPT-6 Astra", "low (3 essais) → repli"],
};
const EFFORT_WORDS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
function splitLabel(label) {
  const m = label.match(/^(.*?)\s*(\([^)]*\))?\s*$/);
  const bare = m[1]; const paren = m[2] ? ` ${m[2]}` : "";
  const parts = bare.split(" "); const effort = parts.at(-1);
  if (!EFFORT_WORDS.includes(effort)) return null;
  const base = parts.slice(0, -1).join(" ");
  const entry = MODEL_NAMES.find(([short]) => short === base);
  return entry ? { full: entry[1], effort, paren } : null;
}
function fullName(label) {
  if (CASCADES[label]) return CASCADES[label][0];
  const s = splitLabel(label);
  return s ? `${s.full} ${s.effort}${s.paren}` : null;
}
const modelOf = (label) => (CASCADES[label] ? CASCADES[label][1] : (splitLabel(label) ? `${splitLabel(label).full}${splitLabel(label).paren}` : label));
const effortOf = (label) => (CASCADES[label] ? CASCADES[label][2] : (splitLabel(label)?.effort ?? "N-A"));
let V12_CHARTS = null;
const ALL = [...OLD, wonderRow, argonRow, ...EMBER.map((e) => e.row)].sort((a, b) => (b.r - a.r) || (b.f1 - a.f1));
const rankByRecall = new Map(ALL.map((row, i) => [row.label, i + 1]));

// Burn allowance readings (Muse), chronological by as_of_ms.
const wonderAllow = [...wonderBurn].filter((u) => u.allowance)
  .sort((a, b) => (a.allowance.as_of_ms ?? 0) - (b.allowance.as_of_ms ?? 0));
const iso = (ms) => (ms ? new Date(ms).toISOString() : "N-A");

// ================= Charts (SVG, style proche v101b, générés en Node) =================
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function providerOf(label) {
  if (label.startsWith("CP") || label.startsWith("C2") || label.startsWith("C3")) return "Cascade";
  if (/Astra|Sol|Luna|GPT/.test(label)) return "OpenAI";
  if (/Gemini|Sonnet 4\.6/.test(label)) return "Google";
  if (/Opus|Sonnet 5/.test(label)) return "Anthropic";
  if (/Muse/.test(label)) return "Meta";
  if (/Mistral/.test(label)) return "Mistral";
  return "Autre";
}
const COLORS = { OpenAI: "#1f77b4", Google: "#d62728", Anthropic: "#2ca02c", Meta: "#9467bd", Mistral: "#ff7f0e", Cascade: "#b82561", Autre: "#7f7f7f" };
function axesSvg(w, h, ml, mr, mt, mb, xTicks, yTicks, xLabel, yLabel, title) {
  const iw = w - ml - mr, ih = h - mt - mb;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/><style>text{font-family:'DejaVu Sans',sans-serif}</style>`;
  s += `<text x="${w / 2}" y="22" font-size="15" text-anchor="middle" fill="#123d50">${esc(title)}</text>`;
  for (const t of xTicks) s += `<line x1="${t.x}" y1="${mt}" x2="${t.x}" y2="${mt + ih}" stroke="#b0b0b0" stroke-opacity="0.13"/><text x="${t.x}" y="${mt + ih + 16}" font-size="11" text-anchor="middle">${esc(t.label)}</text>`;
  for (const t of yTicks) s += `<line x1="${ml}" y1="${t.y}" x2="${ml + iw}" y2="${t.y}" stroke="#b0b0b0" stroke-opacity="0.13"/><text x="${ml - 6}" y="${t.y + 4}" font-size="11" text-anchor="end">${esc(t.label)}</text>`;
  s += `<rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="none" stroke="#333" stroke-width="0.8"/>`;
  s += `<text x="${ml + iw / 2}" y="${h - 4}" font-size="12" text-anchor="middle">${esc(xLabel)}</text>`;
  s += `<text x="14" y="${mt + ih / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 14 ${mt + ih / 2})">${esc(yLabel)}</text>`;
  return { s, iw, ih };
}
function chartPrecisionRecall() {
  const w = 1080, h = 580, ml = 76, mr = 24, mt = 44, mb = 52;
  const iw = w - ml - mr, ih = h - mt - mb;
  const X = (r) => ml + r * iw, Y = (p) => mt + ih - p * ih;
  const xTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => ({ x: X(v), label: v.toFixed(1) }));
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => ({ y: Y(v), label: v.toFixed(1) }));
  let { s } = axesSvg(w, h, ml, mr, mt, mb, xTicks, yTicks, "Rappel strict (oracle 676, refus comptés en manqués)", "Precision stricte", "Precision-rappel nets - benchmark v11 (oracle 676)");
  for (const f of [0.2, 0.3, 0.4, 0.5]) {
    let d = "";
    for (let r = 0.02; r <= 0.62; r += 0.01) { const p = (f * r) / (2 * r - f); if (p < 0 || p > 0.62) continue; d += `${d ? "L" : "M"}${X(r).toFixed(1)} ${Y(p).toFixed(1)} `; }
    s += `<path d="${d}" fill="none" stroke="#999" stroke-width="0.7" stroke-dasharray="4 3"/><text x="${X(0.60)}" y="${Y((f * 0.60) / (1.2 - f)) - 3}" font-size="10" fill="#666">F1=${f.toFixed(1)}</text>`;
  }
  for (const row of ALL) {
    if (row.p === null || row.p === undefined) continue;
    const c = COLORS[providerOf(row.label)];
    const isCascade = providerOf(row.label) === "Cascade";
    const mark = isCascade
      ? `<path d="M${X(row.r)} ${Y(row.p) - 7} L${X(row.r) + 7} ${Y(row.p)} L${X(row.r)} ${Y(row.p) + 7} L${X(row.r) - 7} ${Y(row.p)} Z" fill="${c}" stroke="#fff" stroke-width="1"/>`
      : `<circle cx="${X(row.r)}" cy="${Y(row.p)}" r="${row.isNew ? 7 : 5}" fill="${c}" fill-opacity="0.85" stroke="${row.isNew ? "#000" : "#fff"}" stroke-width="${row.isNew ? 1.6 : 0.8}"/>`;
    s += mark;
    if (row.isNew || row.f1 >= 0.40) s += `<text x="${X(row.r) + 9}" y="${Y(row.p) + 4}" font-size="10.5" fill="#1d2b37">${esc(row.label.replace(" (siège)", "").replace(" (siège AGY)", " (AGY)"))}</text>`;
  }
  let lx = ml + 8, ly = mt + 16;
  for (const [name, c] of Object.entries(COLORS)) { s += `<circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${c}"/><text x="${lx + 14}" y="${ly}" font-size="11">${esc(name)}</text>`; ly += 17; }
  s += `<text x="${ml + 8}" y="${mt + ih - 8}" font-size="10.5" fill="#444">Anneau noir : nouveaux bras v11. Courbes grises : meme F1. Base : 676 unites, 43 non resolus neutres.</text>`;
  return s + "</svg>";
}
function chartF1Cost() {
  const rows = ALL.filter((r) => r.seat && r.seat > 0);
  const w = 1080, h = 580, ml = 92, mr = 24, mt = 44, mb = 52;
  const iw = w - ml - mr, ih = h - mt - mb;
  const lo = -3.2, hi = -0.9; // log10 USD/docs seat range approx 0.0006..0.13
  const X = (usd) => ml + ((Math.log10(usd) - lo) / (hi - lo)) * iw;
  const Y = (f1) => mt + ih - (f1 / 0.55) * ih;
  const xTicks = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05].map((v) => ({ x: X(v), label: String(v) }));
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => ({ y: Y(v), label: v.toFixed(1) }));
  let { s } = axesSvg(w, h, ml, mr, mt, mb, xTicks, yTicks, "USD siege / doc (echelle log, allocation a pleine capacite)", "F1 strict", "F1 strict et cout siege - benchmark v11");
  for (const row of rows) {
    const c = COLORS[providerOf(row.label)];
    s += `<circle cx="${X(row.seat)}" cy="${Y(row.f1)}" r="${row.isNew ? 7 : 5}" fill="${c}" fill-opacity="0.85" stroke="${row.isNew ? "#000" : "#fff"}" stroke-width="${row.isNew ? 1.6 : 0.8}"/>`;
    if (row.isNew || row.f1 >= 0.40) s += `<text x="${X(row.seat) + 9}" y="${Y(row.f1) + 4}" font-size="10.5">${esc(row.label.replace(" (siège)", "").replace(" (siège AGY)", " (AGY)"))}</text>`;
  }
  s += `<text x="${ml + 8}" y="${mt + ih - 8}" font-size="10.5" fill="#444">Siege = API x facteur fournisseur (v10). Argon low : part /usage mesuree. ${EMBER.length ? "Wonder low et Ember xhigh/max : parts non attribuables, absents, jamais estimes." : "Wonder low : part non attribuable, absent, jamais estime."}</text>`;
  return s + "</svg>";
}
function chartAcceptation() {
  const rows = [...ALL].sort((a, b) => b.accepted - a.accepted);
  const w = 1080, h = 640, ml = 300, mr = 60, mt = 44, mb = 36;
  const iw = w - ml - mr, ih = h - mt - mb;
  const bh = ih / rows.length;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/><style>text{font-family:'DejaVu Sans',sans-serif}</style><text x="${w / 2}" y="22" font-size="15" text-anchor="middle" fill="#123d50">Acceptation sur 100 documents - benchmark v11</text>`;
  rows.forEach((row, i) => {
    const y = mt + i * bh;
    const aw = (row.accepted / 100) * iw;
    s += `<text x="${ml - 6}" y="${y + bh * 0.68}" font-size="10" text-anchor="end">${esc(row.label)}</text>`;
    s += `<rect x="${ml}" y="${y + 1}" width="${aw}" height="${bh - 2}" fill="${row.isNew ? "#b82561" : "#15927e"}"/>`;
    s += `<rect x="${ml + aw}" y="${y + 1}" width="${iw - aw}" height="${bh - 2}" fill="#e3a6bb" fill-opacity="0.55"/>`;
    s += `<text x="${ml + aw + 4}" y="${y + bh * 0.68}" font-size="10">${row.accepted}/100</text>`;
  });
  s += `<text x="${ml}" y="${h - 6}" font-size="10.5" fill="#444">Vert/bordeaux : acceptes. Rose : refuses ou absents (100 - acceptes). Rouge : nouveaux bras v11.</text>`;
  return s + "</svg>";
}
function chartRecall() {
  const rows = ALL; // already sorted by recall
  const w = 1080, h = 640, ml = 300, mr = 60, mt = 44, mb = 36;
  const iw = w - ml - mr, ih = h - mt - mb;
  const bh = ih / rows.length;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/><style>text{font-family:'DejaVu Sans',sans-serif}</style><text x="${w / 2}" y="22" font-size="15" text-anchor="middle" fill="#123d50">Rappel strict trie decroissant - benchmark v11 (F1 en point noir)</text>`;
  rows.forEach((row, i) => {
    const y = mt + i * bh;
    const rw = (row.r / 0.6) * iw;
    s += `<text x="${ml - 6}" y="${y + bh * 0.68}" font-size="10" text-anchor="end">${esc(row.label)}</text>`;
    s += `<rect x="${ml}" y="${y + 1}" width="${rw}" height="${bh - 2}" fill="${row.isNew ? "#b82561" : "#4a7fb5"}"/>`;
    s += `<circle cx="${ml + (row.f1 / 0.6) * iw}" cy="${y + bh / 2}" r="3.2" fill="#111"/>`;
    s += `<text x="${ml + rw + 4}" y="${y + bh * 0.68}" font-size="10">R ${fmt(row.r)} - F1 ${fmt(row.f1)}</text>`;
  });
  return s + "</svg>";
}

// ================= Markdown dossier v11 =================
function detailRowNew(scores, tokLine, api, seatNote) {
  return { scores, tokLine, api, seatNote };
}
const wonderDetail = detailRowNew(wonderScores,
  `entrée réelle (burn n=${wonderBurn.length}) ${Math.round(mean(wonderBurn, "inputTokens") ?? 0)} / sortie réelle ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)} (raisonnement ${Math.round(mean(wonderBurn, "reasoningTokens") ?? 0)}, cache ${Math.round(mean(wonderBurn, "cachedTokens") ?? 0)}) ; bras complet : sortie estimée octets/4 ${Math.round(wonderScores.tokens?.outTokensMeanEst ?? 0)} (unverified)`,
  wonderApiBurn, "missing source");
const argonDetail = detailRowNew(argonScores,
  `entrée réelle (bras, n=${argonOk.length}) ${Math.round(argonTok.in ?? 0)} / sortie réelle ${Math.round(argonTok.out ?? 0)} (réflexion ${Math.round(argonTok.think ?? 0)}, cache ${Math.round(argonTok.cached ?? 0)})`,
  argonApiArm, "missing source");

const globalRowsMd = ALL.map((row, i) => `| ${i + 1} | ${row.isNew ? `**${row.label}**` : row.label}${row.flag === "a" ? " ᵃ" : ""} | ${row.accepted} | ${fmt(row.p)} | ${fmt(row.r)} | ${fmt(row.f1)} | ${row.api === null || row.api === undefined ? "missing source" : fmtUsd(row.api)} | ${row.seat === null || row.seat === undefined ? "missing source" : fmtUsd(row.seat)} |`).join("\n");

const seatDetailMd = [
  ...DETAIL_OLD.map((d) => `| ${d[0]} | ${d[1]} | ${d[2]} | ${d[3]} · ${d[4]} · N-A · ${d[5]} | ${fmt(d[6])} | ${d[7]} | ${d[8]} | ${d[9] === null ? "N-A" : d[9]} | ${fmtUsd(d[10])} | ${d[11] === null ? "missing source" : fmtUsd(d[11])} |`),
  `| **Muse Wonder low** | 100 | ${wonderScores.accepted} | ${wonderScores.failClasses.J} · ${wonderScores.failClasses.V} · ${wonderScores.failClasses.Pr} · ${wonderScores.failClasses.T} | ${fmt(wonderScores.f1n4)} | ${fmt(wonderScores.p50s, 1)} ¹ | ${fmt(wonderScores.p90s, 1)} ¹ | ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)} réelle (burn) | ${fmtUsd(wonderApiBurn)} ² | missing source |`,
  `| **Gemini Argon low** | 100 | ${argonScores.accepted} | ${argonScores.failClasses.J} · ${argonScores.failClasses.V} · ${argonScores.failClasses.Pr} · ${argonScores.failClasses.T} | ${fmt(argonScores.f1n4)} | ${fmt(argonScores.p50s, 1)} ¹ | ${fmt(argonScores.p90s, 1)} ¹ | ${Math.round(argonTok.out ?? 0)} réelle (bras) | ${fmtUsd(argonApiArm)} ³ | ${fmtUsd(argonSeatUsd20x)} ⁴ |`,
].join("\n");

let md = `# Quel modèle pour lire les documents municipaux ?

**Benchmark v11 · Rapport complet · 9 novembre 2026**<br>
Rédaction : lane benchmark v11 (conductor i-cond) ; base v10 (v101b, oracle 674) et v11alpha (oracle 676, #725).

## 1. Résumé exécutif

Ce dossier **v11** (sans « alpha ») intègre les lignes v11alpha, le bras **Muse Wonder low** complet et le nouveau bras **Gemini Argon low**, selon strictement la même méthode que v11alpha : mêmes prompts gelés (revérifiés \`count=100, fail=0\`), même validateur v9 gelé + provenance, même scoreur oracle 676 (43 non résolus neutres). Différence de protocole, déclarée exactement : **concurrence 10** pour Muse Wonder low ; pour Gemini Argon low, échantillon final **mixte** — passage principal en concurrence 10 puis reprises séquentielles des échecs d'infrastructure (140 tentatives, 100 documents distincts réussis, 18 documents repris ; détail §2). Aucune valeur publiée en v10 ou v11alpha n'est altérée ; les nouvelles lignes s'ajoutent.

- **Muse Wonder low** (\`muse-wonder-1.0\`, siège Muse) : ${wonderScores.accepted}/100 acceptés, P ${fmt(wonderScores.strict.precision)}, R ${fmt(wonderScores.strict.recall)}, F1 strict ${fmt(wonderScores.strict.f1)} — rang ${rankByRecall.get("Muse Wonder low (siège)")} au tri par rappel.
- **Gemini Argon low** (\`gemini-4-argon-low\`, siège AGY / Gemini Ultra) : ${argonScores.accepted}/100 acceptés, P ${fmt(argonScores.strict.precision)}, R ${fmt(argonScores.strict.recall)}, F1 strict ${fmt(argonScores.strict.f1)} — rang ${rankByRecall.get("Gemini Argon low (siège AGY)")} au tri par rappel.
- Le **combo CP actuel** reste en tête en F1 (0,507) ; aucun modèle seul ne l'égale. Le tri du tableau global v11 est par **rappel décroissant** (consigne du dossier), le F1 reste affiché.
- Coûts : équivalents API calculés depuis les jetons réels et des tarifs publics relevés sur **sources secondaires** datées (section 6 ; tarifs marqués \`unverified\`, aucune page tarifaire primaire citée avec URL exacte). Coût siège **Gemini Argon low mesuré par burn \`/usage\`** : 0,00801 USD/doc (part hebdomadaire mesurée × prix hebdomadaire du palier Google AI Ultra 20x à 199,99 USD/mois ; relevés bruts en section 6). Coût siège **Muse Wonder low : \`missing source\`** (compteur \`muse usage\` lu avant/après, bascule partagée avec les sessions du compte, non attribuable — relevés complets en section 6). Rien n'est estimé à la place.

## 2. Protocole

- Corpus : 100 documents du manifeste v101b (sha256 PDF vérifiés), prompts gelés sha256 identiques au v10, validation profil v9 + provenance, notation oracle v3 stricte sur **oracle 676** (#725, 43 non résolus neutres). Règle « Fair Benchmarking — No Cheating » (\`rules/MASTER.md\`) : métriques gelées avant notation, appliquées à l'identique, aucune fabrication, traçabilité complète.
- **Gemini Argon low** — modèle exact \`gemini-4-argon-low\` (catalogue AGY relevé le 2026-11-09 : \`gemini-4-argon-{low,medium,high}\`, effort encodé dans l'identifiant). Transport siège headless AGY, uniforme sur les 100 documents : \`agy --model gemini-4-argon-low --input-format stream-json --output-format stream-json\`, ligne d'entrée \`{"event":"user","message":{"content":<octets du prompt gelé>}}\`, fichier brut = \`result.response\` de l'événement final. Le canal stdin remplace le canal argv (\`--print=<prompt>\`) qui heurte la limite Linux de 128 Kio par argument (\`spawn E2BIG\`) sur les plus gros prompts gelés : un premier passage argv (53/100 documents, 3 erreurs d'outillage, arrêt E2BIG avant toute validation ni notation) est archivé sous \`arms/gemini-argon-low/pass1-print-raw/\` et n'est **pas** noté. La CLI AGY ajoute son propre contexte d'agent autour du prompt gelé : l'écart avec un appel API brut n'est **pas mesuré** (même réserve que les bras Opus 5.5 \`claude -p\` de v11alpha).
- **Surface d'accès AGY (déclaration complète)** — wrapper : CLI AGY (\`agy\`, Antigravity) en mode headless \`stream-json\` stdin/stdout, siège uniquement (aucune clé API ; aucun drapeau de restriction d'outils passé par le runner). Contexte ajouté : la CLI ajoute son propre contexte d'agent autour du contenu du tour utilisateur (les octets du prompt gelé, envoyés tels quels) ; écart avec un appel API brut **non mesuré** (même réserve que les bras Opus 5.5 \`claude -p --system-prompt-file\` de v11alpha). Répertoire de travail (\`cwd\`) du processus AGY : la racine du dépôt benchmark, qui contient \`tmp/bench-wonder/\` (prompts gelés, oracle 676, corpus, sorties des bras). Outils actifs : l'événement \`init\` du premier flux archivé liste 60 outils disponibles, dont \`view_file\`, \`run_command\`, \`grep_search\`, \`search_web\`, \`call_mcp_tool\`, \`read_url_content\`, en mode d'autorisation \`request-review\`, sans restriction appliquée par le runner. Usage effectif observé sur les 100 flux notés : étapes \`user_input\` puis \`agent_response\` uniquement, **aucun appel d'outil**, 100 événements \`result\` en \`SUCCESS\`. La comparaison avec les transports \`claude -p --system-prompt-file\` (v11alpha) et API reste donc asymétrique en surface d'accès déclarée, pas seulement en contexte ; aucun score n'est invalidé (aucun outil utilisé pendant l'extraction).
- **Muse Wonder low** — \`muse-wonder-1.0\`, \`muse exec --provider meta --reasoning-effort low --prompt-file <prompt gelé>\`, siège Muse, déjà exécuté (100/100, 0 événement quota). Colonnes complétées ici par capture d'usage \`--json\` sur l'échantillon burn (jetons réels fournisseur).
- Sièges uniquement, aucune clé API. Reprise sur quota de siège : attente 300 s, maximum 12 tentatives, jamais de bascule clé, le quota n'est jamais compté comme un refus. Argon : ${argonQuota} événement(s) quota sur le passage noté ; Wonder : 0.
- **Concurrence** (au lieu de 1 en v11alpha), énoncée exactement : Muse Wonder low a été exécuté en concurrence 10. Pour Gemini Argon low, l'échantillon final noté est **mixte** : passage principal en concurrence 10, puis reprises **séquentielles** (concurrence 1, \`run-arm-argon-retry.mjs\`) des échecs d'infrastructure — le \`meta.jsonl\` du bras compte 140 tentatives pour 100 documents distincts réussis, 40 tentatives en erreur et 18 documents repris. Les latences p50/p90 des deux nouveaux bras sont mesurées sous cette concurrence et **ne sont pas comparables** aux colonnes de latence v10/v11alpha. P, R, F1 et acceptés ne dépendent pas de la concurrence.
- Incidents d'infrastructure Argon (jamais comptés comme refus ni quota) : erreurs de construction de boîte à outils AGY (\`mcp_h2a_render_BarChart\`, \`$ref\` distant résolu en URL fichier), authentification expirée et flux interrompus. Cause établie par reproduction : en séquentiel, aucune erreur d'outillage ; en rafale de 10 démarrages simultanés, les constructions de boîte à outils entrent en collision. Les échecs ont été repris par relances du runner (seules les sorties non vides sont sautées), les derniers documents en séquentiel avec la même commande et les mêmes octets. Les flux des réponses réussies ne contiennent aucun appel d'outil (étapes \`user_input\` puis \`agent_response\`) : la boîte à outils n'intervient pas dans l'extraction.

## 3. Tableau global — tri par rappel décroissant (oracle 676)

40 lignes : 38 lignes v11alpha recopiées sans rescoring, plus Muse Wonder low et Gemini Argon low. ᵃ = valeur du rapport v10 (oracle 674) telle que publiée en v11alpha. USD hors taxes ; \`missing source\` = jamais estimé.
<!-- page:wide -->
| # (rappel) | Modèle · effort | Acceptés /100 | P | R | F1 strict | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|
${globalRowsMd}

Lecture : le tri par rappel met Astra medium (R 0,534) et CP (R 0,533) en tête ; CP reste premier en F1 (0,507) et en précision (0,484). Gemini Argon low et Muse Wonder low se classent par leur rappel respectif (voir rangs ci-dessus). les coûts siège historiques valent \`API × facteur fournisseur\` mesuré par burn en v10 (Codex 0,044235 ; Google 0,037931 ; Claude 0,030248) ; Gemini Argon low reçoit un facteur mesuré par burn \`/usage\` (section 6), Muse Wonder low reste sans part attribuable : \`missing source\`.

## 4. Détail des bras siège

J = JSON invalide ; V = profil v9 refusé ; Pr = provenance ; T = transport / réponse vide. Pour les bras v11alpha, la colonne publiée était J · V · T (Pr non séparé : N-A ici, sans rescoring).

| Bras | Tentés | Acceptés | Échecs (J · V · Pr · T) | F1 net 4 doc | p50 s | p90 s | Sortie moy. (jetons) | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|---|---|
${seatDetailMd}

¹ Concurrence : Wonder en concurrence 10 ; Argon en échantillon mixte (passage concurrence 10 + reprises séquentielles, voir §2) : non comparable aux latences v11alpha (concurrence 1). ² Tarif \`muse-wonder-1.0\` 4,00 / 0,20 (cache) / 20,00 USD par million de jetons (entrée / cache / sortie), relevé le 2026-11-03 sur **source secondaire** (voir §6 : tarif \`unverified\`, aucune page tarifaire primaire Meta citée) ; formule \`[(I−C)×4 + C×0,20 + O×20]/10⁶\` sur jetons réels du burn (n=${wonderBurn.length}, seau S — voir limites §6). Avec raisonnement facturé en sortie : ${fmtUsd(wonderApiBurnWithReasoning)}. ³ Tarif \`Gemini 4 Argon\` 2,00 / 0,10 (cache) / 10,00 USD par million, relevé le 2026-11-03 sur **source secondaire** (voir §6 : tarif \`unverified\`, URL de la page tarifaire primaire Google non citée ; le passage à 4/20 au 2026-12-01 annoncé par ce relevé secondaire n'est pas vérifié sur source primaire) ; formule \`[(I−C)×2 + C×0,10 + (O+T)×10]/10⁶\` sur jetons réels du bras complet (n=${argonOk.length}) ; burn (n=${argonBurn.length}, mesuré sous un autre mode d'invocation — voir §6) : ${fmtUsd(argonApiBurn)}. ⁴ USD siège Argon : burn \`/usage\` (section 6), part hebdomadaire 0,000174153/doc × 45,9936 USD/semaine (Ultra 20x, 199,99 USD/mois) = 0,00801 USD/doc ; variante 5x cohérente (part ×4, 99,99 USD/mois) : 0,01602 USD/doc.

Détail Wonder : ${wonderDetail.tokLine}. Détail Argon : ${argonDetail.tokLine}. Scores secondaires (même scoreur) — Wonder : F1 broad ${fmt(wonderScores.broad.f1)}, stage-tolerant ${fmt(wonderScores.stageTolerant.f1)}, soft ${fmt(wonderScores.soft.f1)} (TP ${wonderScores.strict.tp}, FP ${wonderScores.strict.fp}, FN ${wonderScores.strict.fn}). Argon : F1 broad ${fmt(argonScores.broad.f1)}, stage-tolerant ${fmt(argonScores.stageTolerant.f1)}, soft ${fmt(argonScores.soft.f1)} (TP ${argonScores.strict.tp}, FP ${argonScores.strict.fp}, FN ${argonScores.strict.fn}).

<!-- page:wide -->

## 5. Latences

Les p50/p90 des bras v10/v11alpha (concurrence 1) restent ceux des rapports publiés (tableaux v10 §5 et v11alpha §3, non recopiés ici pour éviter toute altération). Nouveaux bras, concurrence 10 — **non comparables** : Muse Wonder low p50 ${fmt(wonderScores.p50s, 1)} s, p90 ${fmt(wonderScores.p90s, 1)} s ; Gemini Argon low p50 ${fmt(argonScores.p50s, 1)} s, p90 ${fmt(argonScores.p90s, 1)} s (temps mur des seules tentatives réussies distinctes ; échantillon final Argon mixte — passage principal en concurrence 10 et reprises séquentielles d'erreurs d'infrastructure, 140 tentatives pour 100 documents réussis, 18 documents repris — donc doublement non comparable ; événements quota Argon : ${argonQuota}). Sous concurrence 10, ces durées incluent l'attente d'ordonnancement du siège partagé.

## 6. Coûts, sièges et tests de burn

Un accès API facture les jetons ; un siège est un abonnement à quota. Le burn mesure la consommation de quota sur un échantillon fixe (10 documents gelés, les 10 premiers du manifeste), avec relevés avant/après quand le fournisseur expose un compteur. Méthode v10 : \`C_siège = C_API × f\`, \`f = S / É_mois\` extrapolé de la fraction de quota consommée. Sans bascule de compteur attribuable, aucun facteur n'est dérivé : \`missing source\`. Correctif du 2026-11-09 (lane COST) : AGY expose bien un compteur d'allocation via la commande slash \`/usage\`, lisible en headless ; l'affirmation inverse de la première version de ce dossier est retirée (méthode et relevés ci-dessous).

### Tarifs publics utilisés (source et date de relevé)

Statut des sources : aucun tarif ci-dessous n'est cité depuis la page tarifaire primaire du fournisseur avec son URL exacte. Chaque tarif est donc présenté explicitement comme relevé sur **source secondaire** et marqué \`unverified\` ; aucun n'est présenté comme une page officielle. Seule exception de disponibilité (pas de prix) : la page officielle des abonnements Google a été réouverte le 2026-11-09 (voir dernière ligne des sources §9).

| Objet | Tarif | Source | Relevé |
|---|---|---|---|
| \`muse-wonder-1.0\` (équivalent API) | 4,00 entrée / 0,20 cache / 20,00 sortie USD par M jetons — \`unverified\` | **Source secondaire** (agrégateur) : https://superagnt.com/muse/pricing ; sentisight.ai — aucune page tarifaire primaire Meta citée | 2026-11-03 |
| \`Gemini 4 Argon\` (équivalent API) | 2,00 entrée / 0,10 cache / 10,00 sortie USD par M jetons — \`unverified\` (le passage à 4/20 au 2026-12-01 vient du même relevé secondaire, non vérifié sur source primaire) | **Source secondaire** (agrégateur) : licenseware.io, se déclarant sourcé de la page Gemini Developer API pricing au 2026-11-03 — URL de la page primaire non citée ici | 2026-11-03 |
| Google AI Ultra (siège AGY) | Palier affiché par l'en-tête de la session interactive AGY le 2026-11-09 : « Google AI Ultra » (multiplicateur 5x/20x non affiché par \`/usage\`) — 99,99 USD/mois (5x) ; 199,99 USD/mois (20x), US — \`unverified\` | **Source secondaire** : lilachbullock.com ; whizi.io (relevés concordants). Page officielle https://gemini.google/subscriptions réouverte le 2026-11-09 (édition Canada, Argon confirmé sur Pro et Ultra) pour la disponibilité, sans prix US cité ici | octobre 2026 |
| Muse (siège) | Power Usage 50 USD/mois ; Maximum Usage 200 USD/mois (Wonder Full inclus). Palier lu sur ce siège par \`muse usage\` : « Muse Code Max Usage » (= Maximum Usage) — \`unverified\` | **Source secondaire** (agrégateur) : https://superagnt.com/muse/pricing — aucune page tarifaire primaire Meta citée | 2026-11-03 |

Paliers lus dans cette lane : AGY « Google AI Ultra » (en-tête interactif ; multiplicateur non affiché, le calcul siège Argon est donc publié au prix 20x avec la variante cohérente 5x en regard) ; Muse « Muse Code Max Usage » (= Maximum Usage, 200 USD/mois). Aucun autre palier n'entre dans les calculs. Les prix restent des relevés secondaires \`unverified\` (voir statut des sources ci-dessus), revérifiés le 2026-11-09 (blog.laozhang.ai du 2026-11-06 ; limitdigest.com vérifié le 2026-11-09 ; engineerfoodie.in du 2026-10-29).

### Burn Muse Wonder low (siège Muse, compteur exposé)

Échantillon : 10 premiers documents du manifeste, \`muse exec --provider meta --model muse-wonder-1.0 --reasoning-effort low --json\` séquentiel (run-burn-wonder-usage10). Un premier essai Saint-Polycarpe a échoué sur timeout du runtime Muse (exit 1, usage nul) puis a réussi à la reprise ; il n'est pas compté comme un refus. Jetons réels moyens : entrée ${Math.round(mean(wonderBurn, "inputTokens") ?? 0)}/doc, sortie ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)}/doc, raisonnement ${Math.round(mean(wonderBurn, "reasoningTokens") ?? 0)}/doc, cache ${Math.round(mean(wonderBurn, "cachedTokens") ?? 0)}/doc. Ces entrées incluent le contexte propre de la CLI Muse (contexte d'agent autour du prompt gelé) : l'équivalent API surestime donc le coût du seul prompt gelé en API brute — même réserve que les bras \`claude -p\` de v11alpha.

Relevés d'allocation (\`run.usage.allowance\`, source \`stream\`) : hebdomadaire ${wonderAllow.length ? `${wonderAllow[0].allowance.weekly.used_percent} % au ${iso(wonderAllow[0].allowance.as_of_ms)} → ${wonderAllow[wonderAllow.length - 1].allowance.weekly.used_percent} % au ${iso(wonderAllow[wonderAllow.length - 1].allowance.as_of_ms)}` : "N-A"} (réinitialisation ${wonderAllow.length ? iso(wonderAllow[0].allowance.weekly.resets_at_ms) : "N-A"}). La fenêtre courte a basculé entre-temps (réinitialisation intermédiaire) et n'est pas comparable. Le compteur hebdomadaire est partagé avec toutes les sessions du compte, y compris la session conductrice : la bascule observée (+1 point entier, granularité ±1 point) n'est pas attribuable au seul échantillon. Relevés directs \`muse usage\` (sans tour modèle, lane COST du 2026-11-09, même échantillon séquentiel de 10 documents, \`muse exec --json\` ; jetons du burn mesuré : entrée 60 345/doc, sortie 4 875/doc) : palier « Muse Code Max Usage », hebdomadaire 19 % au 2026-11-09T20:28:54.912Z → 20 % au 2026-11-09T20:53:04.883Z (réinitialisation 2026-11-16T00:00:00.000Z), fenêtre courte 16 % → 19 % (réinitialisation 2026-11-09T21:26:11.000Z). Pendant ce burn, 15 à 16 processus Muse du même compte étaient actifs (sessions interactives, exécutions \`muse exec\` tierces et la session conductrice elle-même) : la bascule hebdomadaire de +1 point (granularité entière, identique en \`muse usage --json\` et en \`run.usage.allowance\`) couvre donc le burn plus cette activité concurrente. Si elle était attribuée en totalité au burn (hypothèse haute, réfutée par la fenêtre courte à +3 points), la part vaudrait 0,1 point/doc, soit 0,0460 USD/doc à 200 USD/mois. **USD siège/doc Muse Wonder low : \`missing source\`** (compteur lu par \`muse usage\` et par \`run.usage.allowance\`, dérivation non attribuable ; palier « Muse Code Max Usage » = Maximum Usage établi).

### Burn Gemini Argon low (siège AGY / Google AI Ultra, compteur \`/usage\` mesuré)

Échantillon : mêmes 10 documents, séquentiel (run-burn-argon). **Écart de mode d'invocation (déclaré)** : le burn publié ici a été mesuré sous le canal argv \`agy --model gemini-4-argon-low --output-format json --print=<prompt>\`, un mode **différent** de celui du bras noté (\`stream-json\` sur stdin, uniforme sur les 100 documents). L'équivalent API du burn (${fmtUsd(argonApiBurn)}) est donc mesuré sous un autre transport que le bras et n'est pas strictement comparable ; l'équivalent principal (${fmtUsd(argonApiArm)}), calculé sur les jetons du bras \`stream-json\` complet, n'est pas affecté. Le runner versionné \`run-burn-argon.mjs\` utilise désormais le même mode \`stream-json\` que le bras noté, pour toute mesure future. Jetons réels moyens du burn : entrée ${argonBurn.length ? Math.round(mean(argonBurn, "inputTokens") ?? 0) : "N-A"}/doc, sortie ${argonBurn.length ? Math.round(mean(argonBurn, "outputTokens") ?? 0) : "N-A"}/doc, réflexion ${argonBurn.length ? Math.round(mean(argonBurn, "thinkingTokens") ?? 0) : "N-A"}/doc (horodatages par document dans \`burn-argon-usage10/*.usage.json\`). Ces entrées incluent le contexte d'agent AGY (voir avertissement en synthèse ci-dessous). Lecture du compteur (lane COST du 2026-11-09) : \`/usage\` est une commande slash de la CLI AGY (alias \`quota\`, « View model quota usage »), lisible en headless par \`agy -p "/usage"\` (texte, pourcentages entiers) et \`agy -p "/usage" --output-format json\` (champ \`command.data.groups[].buckets[].remaining_fraction\`, précision fine). La commande ne consomme aucun jeton (\`num_turns\` 0, usage nul) et n'apparaît ni dans \`--help\` ni parmi les sous-commandes. Burn mesuré : mêmes 10 documents gelés, même runner que le burn initial (\`agy --model gemini-4-argon-low --output-format json --print\`), concurrence 1, aucun autre processus \`agy\` actif sur le siège pendant le burn (vérifié par \`ps\`). Relevés bruts — avant (2026-11-09T20:26:10.352Z) : \`Gemini Models / Weekly Limit Remaining\` fraction restante 0,9517107009887695 (texte 95 %, réinitialisation 2026-11-16T16:00:42Z), \`Five Hour Limit Remaining\` 0,8068429231643677 (texte 81 %, réinitialisation 2026-11-09T21:00:42Z) ; après (2026-11-09T20:47:12.377Z) : hebdomadaire 0,9499691724777222 (texte 95 %), fenêtre 5 h 0,7998764514923096 (texte 80 %). Les groupes \`Claude and GPT models\` restent à 1,0. Part consommée : hebdomadaire (0,9517107009887695 − 0,9499691724777222) / 10 = 0,000174153 par document (0,0174 % du quota hebdomadaire du siège ; capacité ≈ 5 742 documents/semaine, ≈ 24 966 documents/mois) ; fenêtre 5 h : 0,000696647 par document (contrôle croisé, fenêtre à réinitialisation glissante, non utilisée pour le prix). Jetons du burn mesuré : entrée 17 614/doc, sortie 10 410/doc (burn initial : entrée ${argonBurn.length ? Math.round(mean(argonBurn, "inputTokens") ?? 0) : "N-A"}/doc, voir ci-dessus). Prix : palier « Google AI Ultra », prix hebdomadaire = prix mensuel × 7 / 30,4375 jours. Au prix 20x de 199,99 USD/mois (45,9936 USD/semaine) : **USD siège/doc Gemini Argon low = 0,000174153 × 45,9936 = 0,00801 USD/doc**. Variante cohérente si le siège était en 5x (quota divisé par 4, part ×4, prix 99,99 USD/mois soit 22,9956 USD/semaine) : 0,01602 USD/doc (recalculée, non mesurée ; le multiplicateur n'est pas affiché par \`/usage\`). Équivalent API du burn : ${fmtUsd(argonApiBurn)} ; du bras complet (n=${argonOk.length}, jetons réels \`stream-json\`) : ${fmtUsd(argonApiArm)}.

### Synthèse coûts des nouveaux bras

| Bras | Jetons entrée/doc | Jetons sortie/doc | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|
| Muse Wonder low | ${Math.round(mean(wonderBurn, "inputTokens") ?? 0)} (burn n=${wonderBurn.length}, CLI incluse) | ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)} (+ raisonnement ${Math.round(mean(wonderBurn, "reasoningTokens") ?? 0)}) | ${fmtUsd(wonderApiBurn)} | missing source |
| Gemini Argon low | ${Math.round(argonTok.in ?? 0)} (bras n=${argonOk.length}, contexte AGY inclus) | ${Math.round(argonTok.out ?? 0)} (+ réflexion ${Math.round(argonTok.think ?? 0)}) | ${fmtUsd(argonApiArm)} | ${fmtUsd(argonSeatUsd20x)} ⁴ |

Avertissement « contexte CLI inclus » (les deux bras) : les jetons d'entrée incluent le contexte propre de la CLI — contexte d'agent de la CLI Muse pour Wonder (voir burn Wonder ci-dessus), contexte d'agent AGY pour Argon (non mesuré séparément, §2) — autour du prompt gelé. Les équivalents API ci-dessus surestiment donc le coût du seul prompt gelé en API brute, pour Argon comme pour Wonder (même réserve que les bras \`claude -p\` de v11alpha).

## 7. Graphiques

![Précision-rappel nets, nouveaux bras cerclés de noir](assets/2026-11/benchmark-v11-precision-rappel.svg)

![F1 strict et coût siège ; Gemini Argon low placé par burn /usage, Muse Wonder low absent (part non attribuable)](assets/2026-11/benchmark-v11-f1-cost.svg)

![Acceptation sur 100 documents](assets/2026-11/benchmark-v11-acceptation.svg)

![Rappel strict trié décroissant, F1 en point noir](assets/2026-11/benchmark-v11-rappel.svg)

Graphiques régénérés en Node dans le style v101b (fond blanc, grille claire, DejaVu Sans) par \`tools/bench-v11/build-v11-report.mjs\` — les SVG v10 venaient de Matplotlib, non réutilisable sous la règle zéro Python du dépôt. Gemini Argon low est placé sur le graphique F1-coût siège (0,00801 USD/doc, burn \`/usage\`) ; Muse Wonder low en reste absent, faute de part attribuable.

## 8. Lecture

- Aucun modèle seul n'égale le combo CP (F1 0,507). Au tri par rappel, Astra medium et CP dominent ; les deux nouveaux bras se placent dans le peloton des bras siège (F1 Wonder ${fmt(wonderScores.strict.f1)}, Argon ${fmt(argonScores.strict.f1)}).
- Muse Wonder low dépasse tous les bras Muse 1.3 de v11alpha (meilleur : medium 0,262) ; Gemini Argon low est le premier bras Gemini 4 mesuré sur ce banc (à comparer à Gemini 3.8 low 0,368, medium 0,298, high 0,206 — générations différentes, même oracle).
- Les refus des nouveaux bras sont dominés par le profil v9 (V), comme en v11alpha aux efforts bas ; le détail J · V · Pr · T est en section 4.
- Côté coûts, les équivalents API des nouveaux bras (${fmtUsd(wonderApiBurn)} Wonder sur burn, ${fmtUsd(argonApiArm)} Argon sur bras) restent très inférieurs à CP (0,48134), pour une qualité moindre : le compromis publié en v10 n'est pas renversé par ces deux lignes.

## 9. Limites et traçabilité

- Échantillon burn Wonder : 10 documents du seau S (petits) ; les moyennes de jetons ne se extrapolent pas sans réserve aux seaux M/L. Les entrées Muse incluent le contexte CLI (voir §6).
- Compteurs de siège : Muse lu (\`muse usage\`, texte et \`--json\`, plus \`run.usage.allowance\` par document) mais non attribuable (15 à 16 processus du même compte actifs pendant le burn, granularité entière) : USD siège/doc Wonder \`missing source\`. AGY lu par \`/usage\` en headless (fractions fines en JSON ; le texte seul, en points entiers 95 % → 95 %, aurait manqué le signal) : USD siège/doc Argon publié à 0,00801 (palier Ultra 20x) avec variante 5x cohérente à 0,01602. Échantillon de burn : 10 premiers documents du manifeste (seau S) ; la part par document n'est pas extrapolée aux seaux M/L sans réserve.
- Passage Argon argv archivé non noté (voir §2) ; erreurs d'outillage AGY (construction de boîte à outils MCP, \`retryable:false\`) reprises par relance du runner (seules les sorties non vides sont sautées) — jamais comptées comme refus modèle ni quota.
- Traçabilité par exécution du prompt réellement envoyé : les runners Argon versionnés (\`run-arm-argon.mjs\`, \`run-arm-argon-retry.mjs\`, \`run-burn-argon.mjs\`) enregistrent désormais \`promptSha256\` (sha256 du contenu du tour utilisateur réellement envoyé) et \`startedAt\` dans chaque ligne \`meta.jsonl\` / fichier d'usage. Pour le passage noté publié ici, antérieur à cet ajout, les \`meta.jsonl\` archivés ne portent ni l'un ni l'autre : la preuve repose sur la revérification octet par octet en amont (\`prepare-prompts.mjs\` : sha256 et longueurs contre \`promptFreeze\` du manifeste, \`count=100, fail=0\`) et sur le code du runner, qui envoie le contenu du fichier gelé tel quel comme contenu du tour utilisateur.
- Harnais versionné autonome : \`tools/bench-v11/\` (scripts, manifeste + \`SHA256SUMS\`, oracle 676, profil gelé, dépendance \`sandbox/\` ; PDF du corpus non conservés — seuls les textes vérifiés sont gardés). Racine paramétrable par \`BENCH_DIR\` (défaut : le harnais lui-même, résolu depuis l'emplacement du script) ; chaîne complète depuis le manifeste seul documentée dans \`tools/bench-v11/README.md\`. Preuves d'exécution du passage publié (clone, non versionnées) : \`tmp/bench-wonder/full/arms/{muse-wonder-low,gemini-argon-low}/\`, \`tmp/bench-wonder/full/scores-{wonder,argon}.json\`, \`tmp/bench-wonder/full/burn-{wonder,argon}-usage10/\`, \`tmp/bench-wonder/full/prompts/verify.json\`.
- Rapports v10 (\`benchmark-v101b-2026-09-17.md\`) et v11alpha (\`benchmark-v11alpha-2026-09-29.md\` + complément Wonder) intacts ; ce dossier les prolonge sans les modifier.

### Sources (prix et modèles, relevés publics)

- **Source secondaire** — tarifs \`muse-wonder-1.0\` (4,00 / 0,20 / 20,00 USD par M) et Muse Power 50 / Maximum 200 USD/mois : relevés concordants du 2026-11-03 (https://superagnt.com/muse/pricing ; sentisight.ai, « Muse Wonder Token Pricing » ; blog.laozhang.ai). Consultés pour ce dossier le 2026-11-09. Tarifs marqués \`unverified\` : aucune page tarifaire primaire Meta n'est citée avec son URL exacte.
- **Source secondaire** — tarifs \`Gemini 4 Argon\` (2,00 / 0,10 / 10,00 USD par M ; passage à 4/20 annoncé au 2026-12-01 par le même relevé, non vérifié) : relevés concordants du 2026-11-03 (licenseware.io, « Gemini API Cost per Million Tokens (November 2026) », se déclarant sourcé de la page Gemini Developer API pricing). Consultés le 2026-11-09. Tarifs marqués \`unverified\` : l'URL exacte de la page tarifaire primaire Google n'est pas citée ici.
- **Source secondaire** — Google AI Ultra 99,99 (5x) / 199,99 (20x) USD/mois US : relevés concordants d'octobre 2026 (lilachbullock.com ; whizi.io, lecture du 2026-10-11), tarifs marqués \`unverified\`. Page officielle https://gemini.google/subscriptions réouverte le 2026-11-09 (édition Canada, Argon confirmé sur Pro et Ultra) pour la disponibilité uniquement.
- Catalogue AGY du siège : \`agy models\` le 2026-11-09 (\`gemini-4-argon-low\` = « Gemini 4 Argon (Low) ») ; CLI \`agy\` headless \`--input-format stream-json\`.
`;

// ================= Mise à jour Muse Ember (12/11) =================
// Anchored insertions only: every published sentence above stays as is.
if (EMBER.length) {
  const lines = () => md.split("\n");
  const insertAfter = (prefix, text) => {
    const ls = lines();
    const idx = ls.map((l, i) => (l.startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) throw new Error(`anchor not unique (${idx.length}): ${prefix.slice(0, 60)}`);
    ls.splice(idx[0] + 1, 0, text);
    md = ls.join("\n");
  };
  const insertBefore = (prefix, text) => {
    const ls = lines();
    const idx = ls.map((l, i) => (l.startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) throw new Error(`anchor not unique (${idx.length}): ${prefix.slice(0, 60)}`);
    ls.splice(idx[0], 0, text, "");
    md = ls.join("\n");
  };
  const appendToLine = (prefix, text) => {
    const ls = lines();
    const idx = ls.map((l, i) => (l.startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
    if (idx.length !== 1) throw new Error(`anchor not unique (${idx.length}): ${prefix.slice(0, 60)}`);
    ls[idx[0]] += text;
    md = ls.join("\n");
  };
  const replaceOnce = (from, to) => {
    if (md.split(from).length !== 2) throw new Error(`replace anchor not unique: ${from.slice(0, 60)}`);
    md = md.replace(from, to);
  };
  const fr = (v, d = 3) => fmt(v, d).replace(".", ",");
  const lab = (e) => `Muse Ember 1.0 ${e.effort}`;
  const rk = (e) => rankByRecall.get(e.row.label);
  const tok = (e, k) => Math.round(e.s.tokens[k] ?? 0);
  const both = EMBER.map(lab).join(" et ");
  const quotaTxt = EMBER.map((e) => `${e.effort} ${e.s.quotaEvents}`).join(", ");
  const stopTxt = EMBER.some((e) => e.s.stopEvents > 0) ? "atteinte (arrêt, voir §6)" : "jamais atteinte";
  const allowTxt = (e) => e.allow.length
    ? `${e.allow[0].allowance.weekly.used_percent} % au ${iso(e.allow[0].allowance.as_of_ms)} → ${e.allow[e.allow.length - 1].allowance.weekly.used_percent} % au ${iso(e.allow[e.allow.length - 1].allowance.as_of_ms)}`
    : "N-A";
  const row42 = ALL.length;
  // Weekly seat readings: only what the guard logged (muse-weekly-log.jsonl,
  // `muse usage --json`, no model turn), placed against the arms' run windows
  // taken from meta.jsonl (startedAt + ms). Nothing is typed in by hand.
  const guardLog = existsSync(`${EMBER_DIR}/full/muse-weekly-log.jsonl`)
    ? (await readFile(`${EMBER_DIR}/full/muse-weekly-log.jsonl`, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.weeklyUsedPercent !== undefined)
    : [];
  const phaseOf = (ms) => {
    const [a, b] = [...EMBER].sort((x, y) => x.window.start - y.window.start);
    if (ms < a.window.start) return "avant le premier bras";
    if (ms <= a.window.end && (!b || ms < b.window.start)) return `pendant le bras ${a.effort}`;
    if (b && ms >= b.window.start && ms <= b.window.end) return `pendant le bras ${b.effort}${ms <= a.window.end ? ` (et la fin du bras ${a.effort})` : ""}`;
    if (b && ms > a.window.end && ms < b.window.start) return "entre les deux bras";
    return "après les deux bras";
  };
  const winTxt = [...EMBER].sort((x, y) => x.window.start - y.window.start)
    .map((e) => `bras ${e.effort} du ${iso(e.window.start)} au ${iso(e.window.end)}`).join(", ");
  const EMBER_USAGE_READINGS = guardLog.length
    ? `palier « Muse Code Max Usage » ; fenêtres d'exécution (meta.jsonl) : ${winTxt}. Relevés du chien de garde (\`muse-weekly-log.jsonl\`) : ${guardLog.map((r) => `${r.weeklyUsedPercent} % hebdomadaire (fenêtre courte ${r.windowUsedPercent} %) au ${r.at}, ${phaseOf(Date.parse(r.at))}`).join(" ; ")}. Les deux premiers relevés viennent du lancement puis du redémarrage du chien de garde. Aucun relevé consigné après la fin des bras. Seuil d'arrêt 85 % ${EMBER.some((e) => e.s.stopEvents > 0) ? "atteint" : "jamais atteint"} (garde par document du runner et chien de garde)`
    : "relevés du chien de garde : `missing source`";
  const gem = OLD.find((r) => r.label === "Gemini low");
  const m13 = OLD.filter((r) => /^Muse 1\.3 (medium|xhigh)/.test(r.label));
  const m13best = Math.max(...m13.map((r) => r.f1));
  const best = [...EMBER].sort((a, b) => b.s.strict.f1 - a.s.strict.f1)[0];
  const other = EMBER.find((e) => e !== best);
  const factor = (ref, v) => {
    const k = ref / v;
    return k >= 1 ? `${fr(k, 1)} fois moins cher` : `${fr(1 / k, 1)} fois plus cher`;
  };
  const factorsTxt = EMBER.map((e) => `${lab(e)} ${fmtUsd(e.api)} USD/doc : ${factor(gem.api, e.api)} que Gemini 3.8 Flash low (${fmtUsd(gem.api)}) et ${factor(wonderApiBurn, e.api)} que Muse Wonder 1.0 low (${fmtUsd(wonderApiBurn)}, burn)`).join(" ; ");
  const beatsGem = best.s.strict.f1 >= gem.f1;
  const beatsWonder = best.s.strict.f1 >= wonderRow.f1;
  const levelM13 = best.s.strict.f1 > m13best ? "au-dessus des Muse Spark 1.3" : "au niveau des Muse Spark 1.3 ou en dessous";
  // Does treating the tool-call document(s) as refused change the verdict?
  const f1With = (e) => (e.sens ? e.sens.strict.f1 : e.s.strict.f1);
  const bestSens = [...EMBER].sort((a, b) => f1With(b) - f1With(a))[0];
  const sensSame = bestSens === best && (f1With(bestSens) >= gem.f1) === beatsGem && (f1With(bestSens) >= wonderRow.f1) === beatsWonder;
  const EMBER_VERDICT_SHORT = `${beatsGem ? "Ember égale ou dépasse Gemini 3.8 Flash low en F1 strict." : "Ember n'est pas un remplaçant à qualité égale de Gemini 3.8 Flash low."} Meilleur effort mesuré : ${best.effort}, F1 ${fr(best.s.strict.f1)} contre ${fr(gem.f1)} pour Gemini 3.8 Flash low et ${fr(wonderRow.f1)} pour Muse Wonder 1.0 low ; acceptation ${best.s.accepted}/100 ; équivalent API ${fmtUsd(best.api)} USD/doc. ${beatsGem ? "Secours plausible à qualité égale (détail §8)." : `Secours plausible seulement en dernier recours bon marché${beatsWonder ? "" : ", derrière Muse Wonder 1.0 low"} (détail §8).`}`;
  const EMBER_VERDICT_LONG = `Gemini est retiré du refresh ; la question est de savoir si Ember peut tenir le rôle de secours. ${beatsGem ? "À qualité mesurée, oui." : "À qualité égale, les mesures disent non."} ${lab(best)} (P ${fr(best.s.strict.precision)}, R ${fr(best.s.strict.recall)}, F1 ${fr(best.s.strict.f1)})${other ? ` et ${lab(other)} (P ${fr(other.s.strict.precision)}, R ${fr(other.s.strict.recall)}, F1 ${fr(other.s.strict.f1)})` : ""} ${beatsGem ? "atteignent ou dépassent" : "restent sous"} Gemini 3.8 Flash low (P ${fr(gem.p)}, R ${fr(gem.r)}, F1 ${fr(gem.f1)}) ; Muse Wonder 1.0 low : P ${fr(wonderRow.p)}, R ${fr(wonderRow.r)}, F1 ${fr(wonderRow.f1)}. Ember se place ${levelM13} (${m13.map((r) => `${r.label.replace(" (siège)", "").replace("Muse 1.3", "Muse Spark 1.3")} ${fr(r.f1)}`).join(", ")}). ${best.s.strict.precision < gem.p ? `Sa précision (${fr(best.s.strict.precision)}) est inférieure à celle de Gemini 3.8 Flash low (${fr(gem.p)}) : plus de faux positifs à filtrer en aval. ` : ""}Atouts : acceptation (${EMBER.map((e) => `${e.effort} ${e.s.accepted}/100`).join(", ")}) et coût. Facteurs de coût par bras (équivalent API, raisonnement non facturé) : ${factorsTxt}. ${other ? `${lab(best)} ${best.s.strict.precision >= other.s.strict.precision && best.s.strict.recall >= other.s.strict.recall ? "domine" : "devance en F1"} ${lab(other)} (P, R, F1), pour un équivalent API ${fmtUsd(best.api)} contre ${fmtUsd(other.api)}. ` : ""}Sensibilité à l'appel d'outil observé (§2) : ${EMBER.filter((e) => e.sens).map((e) => `${lab(e)} sans ${e.sens.excludedAsRefused.join(", ")} (compté refusé) : P ${fr(e.sens.strict.precision)}, R ${fr(e.sens.strict.recall)}, F1 ${fr(e.sens.strict.f1)}`).join(" ; ") || "aucun document concerné"} ; ${sensSame ? "la conclusion ne change pas" : "la conclusion change : voir ci-dessous"}. Conclusion : ${beatsGem ? `${lab(best)} est un secours plausible du refresh.` : `${lab(best)} est un secours plausible de dernier rang (disponibilité sur le siège Muse, coût, acceptation), pas un remplaçant de Gemini 3.8 Flash low.`}${beatsWonder ? "" : " À qualité mesurée, Muse Wonder 1.0 low reste le meilleur secours mono-modèle du siège Muse."} Une cascade CP avec Ember en second étage n'a pas été mesurée : \`not covered\`.`;

  // En-tête
  replaceOnce("**Benchmark v11 · Rapport complet · 9 novembre 2026**<br>", "**Benchmark v12 · Rapport complet · 13 novembre 2026**");
  replaceOnce("Rédaction : lane benchmark v11 (conductor i-cond) ; base v10 (v101b, oracle 674) et v11alpha (oracle 676, #725).",
    "Rédaction : lane benchmark B (conductor i-cond) ; base v11 (9 novembre 2026), v10 (v101b, oracle 674) et v11alpha (oracle 676, #725).");
  insertAfter("Rédaction : lane benchmark B", `\n**Ce qui change depuis v11** (dossier \`benchmark-v11-2026-11-09\`, laissé intact) :\n\n- deux nouveaux bras, **${both}** (\`muse-ember-1.0\`, siège Muse), mesurés selon la même méthode, pour évaluer un secours du refresh après le retrait de Gemini (exécution 2026-11-13 UTC) ;\n- les quatre graphiques reprennent le style du v10 (v101b) : couleur = fournisseur, forme = modèle, pointillé = progression d'effort, étoile = cascade, libellé à côté de chaque point ;\n- noms complets des modèles, avec version, dans les tableaux et les graphiques (correspondance en §2) ;\n- tableau « Meilleurs bras » ci-dessous, calculé depuis les données ;\n\nToutes les valeurs v11 sont reprises sans modification ; seuls les rangs positionnels sont recalculés sur ${row42} lignes.`);

  // 1. Résumé
  insertAfter("- **Gemini Argon low** (`gemini-4-argon-low`", EMBER.map((e) =>
    `- **${lab(e)}** (\`muse-ember-1.0\`, siège Muse, nouveau en v12) : ${e.s.accepted}/100 acceptés, P ${fmt(e.s.strict.precision)}, R ${fmt(e.s.strict.recall)}, F1 strict ${fmt(e.s.strict.f1)} — rang ${rk(e)} au tri par rappel ; équivalent API ${fmtUsd(e.api)} USD/doc (jetons réels du bras, n=${e.s.tokens.n}) ; USD siège/doc \`missing source\`.`).join("\n")
    + `\n- **Secours du refresh sans Gemini** (demande owner du 12/11) : ${EMBER_VERDICT_SHORT}`);

  // 2. Protocole
  insertAfter("- **Muse Wonder low** — ", `- **${both}** (nouveau en v12) — modèle exact \`muse-ember-1.0\`, commande \`muse exec --provider meta --model muse-ember-1.0 --contributor-mode off --reasoning-effort {xhigh|max} --prompt-file <prompt gelé> --json\`, siège Muse (palier « Muse Code Max Usage »), runner versionné \`full/run-arm-ember.sh\`, notation \`full/score-ember.mjs\` (même \`scoreSource\` que Wonder). Mêmes prompts gelés : reconstruits par \`prepare-prompts.mjs\` (\`DONE ok=100 fail=0\`, \`verify.json\` identique au \`prompts-verify.json\` versionné) et 100/100 octet-identiques aux prompts du bras Wonder. Corpus : 100/100 textes vérifiés par sha256 contre le manifeste (\`dl-corpus.mjs\`, reprise), une partie téléchargée ou relue depuis les caches PDF locaux, le reste (dont les 11 URL mortes) repris du clone d'exécution Wonder \`tmp/bench-wonder\`, chaque texte revérifié contre le manifeste. Même validateur v9 + provenance, même oracle 676. **\`--contributor-mode off\`** : avec \`--preset empty\`, la CLI résout \`muse-ember-1.0\` vers la variante cachée \`muse-ember-1.0-contributor\` (refus « lack access ») ; la commande du bras, sans \`--preset\`, résout \`model_id\` \`muse-ember-1.0\` avec et sans le drapeau (vérifié le 2026-11-13) ; le drapeau est passé pour figer l'identifiant public, et \`model_id\` \`muse-ember-1.0\` est relevé sur ${EMBER.map((e) => `${e.s.tokens.n}/100`).join(" et ")} documents. Répertoire de travail de la CLI : dossier vide hors dépôt, comme \`/tmp/wonder-run\` pour Wonder (même contexte CLI : espace non approuvé, aucune règle de projet chargée). **Écarts déclarés** : concurrence **4** (Wonder : 10) ; capture \`--json\` sur **le bras complet** (Wonder : bras en texte brut, puis burn \`--json\` n=10) — le texte terminal \`run.terminal.completed\` est extrait par \`extract-usage.mjs\` vers \`raw/\` avant validation, et les jetons réels couvrent tous les documents ; \`--contributor-mode off\` ajouté (absent de la commande Wonder). Événements quota : ${quotaTxt} ; garde hebdomadaire 85 % ${stopTxt}.`);
  // Surface d'accès de la CLI Muse (déclaration complète, modèle : déclaration Argon).
  const surf = EMBER.map((e) => ({ e, sum: e.surface.summary, docs: e.surface.docs }));
  const toolDocs = surf.flatMap(({ e, docs }) => docs.filter((d) => d.tools.length).map((d) => ({ e, d })));
  const multiDocs = surf.flatMap(({ e, docs }) => docs.filter((d) => d.modelResponses > 1).map((d) => ({ e, d })));
  const nDocs = surf.reduce((a, { docs }) => a + docs.length, 0);
  const skills = [...new Set(surf.flatMap(({ sum }) => sum.skillsLines))].map((l) => String(l).replace(/^Skills: /, "")).join(" / ");
  const toolTxt = toolDocs.map(({ e, d }) => `${lab(e)} \`${d.doc}\` : ${d.tools.map((t) => `\`tool.${t.tool}\` (${t.outcome}${t.paths.length ? `, fichiers ${t.paths.map((p) => `\`${p}\``).join(" et ")}` : ""})`).join(", ")}`).join(" ; ");
  const accTool = toolDocs.map(({ e, d }) => (existsSync(`${EMBER_DIR}/full/arms/muse-ember-${e.effort}/validated/${e.effort}--${d.doc}.output.json`) ? "accepté et noté" : "non accepté")).join(", ");
  insertAfter(`- **${both}** (nouveau en v12) — modèle exact`, `- **Surface d'accès de la CLI Muse (bras Ember, déclaration complète)** — wrapper : CLI \`muse exec\` 1.4.18 en mode headless \`--json\`, siège uniquement (aucune clé API). Aucun drapeau de restriction d'outils n'est passé : ni \`--disable-web-tools\`, ni \`--disable-reminders\`, ni \`--max-model-steps\`. Outils disponibles : outils natifs de la CLI (dont \`bash\`, exécuté sur l'hôte), outils web non désactivés, et le serveur MCP utilisateur \`h2a\` activé (\`muse mcp list\`). Le flux \`--json\` n'expose pas le catalogue : la liste exacte et le nombre d'outils restent \`unverified\`. Skills chargées : ${skills} (catalogue \`skills_catalog\` tronqué à 32 Ko ; espace non approuvé, skills de projet ignorées, délégation d'agent indisponible). **Appels d'outil observés : ${toolDocs.length} document(s) sur ${nDocs}** — ${toolTxt || "aucun"}. ${toolDocs.length ? `Pour ce document, le modèle a écrit puis exécuté un script Node qui a produit le JSON ; la réponse finale est identique (JSON égal, vérifié le 2026-11-13) au fichier \`/tmp/out.json\` écrit par l'outil ; ce document est ${accTool}.` : ""} **Tours supplémentaires : ${multiDocs.length} document(s) sur ${nDocs}** avec deux réponses modèle au lieu d'une — ${multiDocs.map(({ e, d }) => `${lab(e)} \`${d.doc}\``).join(", ")}. Le second tour suit un rappel de la CLI (\`verify-reminder\` ou \`goal-reminder\`) ou le retour de l'outil ; les ${nDocs - multiDocs.length} autres documents ont une seule réponse modèle. Les tâches de rappel (\`skill-reminder\`, \`goal-reminder\`, \`verify-reminder\`) sont proposées par la CLI sur chaque document. **Le score publié n'est pas modifié** : l'exclusion éventuelle du document avec appel d'outil est laissée à l'owner (sensibilité en §8 et §9). Risque déclaré : le script de l'outil écrit dans \`/tmp\` de l'hôte (\`/tmp/build.js\`, \`/tmp/out.json\`) ; en concurrence 4, deux documents utilisant les mêmes chemins pourraient entrer en collision. Un seul document a utilisé un outil ici, donc aucune collision n'a eu lieu entre documents Ember ; un autre processus de la machine écrivant ces chemins n'est pas exclu (\`unverified\`). Pour **Muse Wonder low**, la même surface est \`unverified\` : le bras a été capturé en texte brut, sans flux d'événements.`);

  // 3. Tableau global
  replaceOnce("40 lignes : 38 lignes v11alpha recopiées sans rescoring, plus Muse Wonder low et Gemini Argon low.",
    `${row42} lignes : 38 lignes v11alpha recopiées sans rescoring, plus Muse Wonder low et Gemini Argon low (9 novembre), puis ${both} (nouveaux en v12).`);
  appendToLine("Lecture : le tri par rappel met Astra medium", ` Nouveau en v12 : ${EMBER.map((e) => `${lab(e)} au rang ${rk(e)} (R ${fr(e.s.strict.recall)}, F1 ${fr(e.s.strict.f1)})`).join(", ")} ; USD siège/doc \`missing source\` (compteur Muse partagé, non attribuable, §6).`);

  // 4. Détail des bras siège
  insertAfter("| **Gemini Argon low** |", EMBER.map((e) =>
    `| **${lab(e)}** | 100 | ${e.s.accepted} | ${e.s.failClasses.J} · ${e.s.failClasses.V} · ${e.s.failClasses.Pr} · ${e.s.failClasses.T} | ${fmt(e.s.f1n4)} | ${fmt(e.s.p50s, 1)} ⁵ | ${fmt(e.s.p90s, 1)} ⁵ | ${tok(e, "outTokensMean")} réelle (bras) | ${fmtUsd(e.api)} ⁶ | missing source |`).join("\n"));
  insertAfter("¹ Concurrence : Wonder en concurrence 10", `\n⁵ Ember : concurrence 4, temps mur de la dernière tentative par document ; non comparable aux latences v11alpha (concurrence 1) ni à Wonder (concurrence 10). ⁶ Tarif \`muse-ember-1.0\` 0,10 / 0,004 (cache) / 0,50 USD par million de jetons (entrée / cache / sortie, contexte ≤ 200 k ; au-delà 0,30 / 0,012 / 1,50), relevé le 2026-11-13 sur la **page primaire Meta** https://dev.meta.ai/models/muse-ember/ ; formule \`[(I−C)×0,10 + C×0,004 + O×0,50]/10⁶\` par document, palier haut appliqué au-delà de 200 000 jetons d'entrée (${EMBER.map((e) => `${e.effort} : ${e.hiDocs} document(s)`).join(" ; ")}), moyenne sur les jetons réels du bras complet. Avec raisonnement facturé en sortie : ${EMBER.map((e) => `${e.effort} ${fmtUsd(e.apiR)}`).join(", ")} (la page primaire ne dit pas si le raisonnement est inclus dans la sortie).`);
  insertAfter("Détail Wonder : ", `\nDétail Ember (nouveau en v12) — ${EMBER.map((e) => `${e.effort} : entrée réelle (bras, n=${e.s.tokens.n}) ${tok(e, "inTokensMean")} / sortie réelle ${tok(e, "outTokensMean")} (raisonnement ${tok(e, "reasoningTokensMean")}, cache ${tok(e, "cachedTokensMean")}) ; F1 broad ${fmt(e.s.broad.f1)}, stage-tolerant ${fmt(e.s.stageTolerant.f1)}, soft ${fmt(e.s.soft.f1)} (TP ${e.s.strict.tp}, FP ${e.s.strict.fp}, FN ${e.s.strict.fn})`).join(". ")}.`);

  // 5. Latences
  appendToLine("Les p50/p90 des bras v10/v11alpha", ` Nouveau en v12, Muse Ember en concurrence 4 (non comparable non plus) : ${EMBER.map((e) => `${e.effort} p50 ${fmt(e.s.p50s, 1)} s, p90 ${fmt(e.s.p90s, 1)} s`).join(" ; ")}.`);

  // 6. Coûts
  insertAfter("Statut des sources : aucun tarif ci-dessous", `\nException ajoutée en v12 : le tarif \`muse-ember-1.0\` est relevé sur la **page primaire Meta** (URL exacte dans le tableau), concordant avec deux relevés secondaires (llmgateway.io, llmreference.com).`);
  insertAfter("| `Gemini 4 Argon` (équivalent API)","| `muse-ember-1.0` (équivalent API) | 0,10 entrée / 0,004 cache / 0,50 sortie USD par M jetons (contexte ≤ 200 k) ; 0,30 / 0,012 / 1,50 au-delà | **Page primaire Meta** : https://dev.meta.ai/models/muse-ember/ ; concordant : llmgateway.io/models/muse-ember-1.0, llmreference.com (Meta Model API) | 2026-11-13 |");
  insertBefore("### Synthèse coûts des nouveaux bras", `### Muse Ember xhigh et max (siège Muse, compteur exposé, non attribuable)\n\nPas de burn séparé : la capture \`--json\` couvre le bras complet (100 documents par effort), donc les jetons réels et le relevé \`run.usage.allowance\` existent pour chaque document. Relevés directs \`muse usage --json\` (sans tour modèle) : ${EMBER_USAGE_READINGS}. Relevés \`run.usage.allowance\` (source \`stream\`) : ${EMBER.map((e) => `${e.effort} ${allowTxt(e)}`).join(" ; ")}. Le compteur hebdomadaire est partagé avec toutes les sessions du compte : un aveugle de classification tournait sur le même siège, et d'autres sessions \`muse exec\` du compte étaient actives au lancement. La bascule observée (granularité ±1 point entier) n'est donc pas attribuable aux bras Ember : **USD siège/doc \`missing source\`** pour les deux efforts, jamais estimé.`);
  insertAfter("| Gemini Argon low | ", EMBER.map((e) =>
    `| ${lab(e)} | ${tok(e, "inTokensMean")} (bras n=${e.s.tokens.n}, CLI incluse) | ${tok(e, "outTokensMean")} (+ raisonnement ${tok(e, "reasoningTokensMean")}) | ${fmtUsd(e.api)} | missing source |`).join("\n"));
  insertAfter("Avertissement « contexte CLI inclus »", `\nMême avertissement pour Muse Ember (nouveau en v12) : les entrées incluent le contexte d'agent de la CLI Muse, non mesuré séparément ; l'équivalent API surestime donc le coût du seul prompt gelé.`);

  // 7. Graphiques
  appendToLine("Graphiques régénérés en Node", ` Nouveau en v12 : les quatre graphiques sont régénérés avec ${both} (rouge / anneau noir comme les autres nouveaux bras) ; Ember est absent du graphique F1-coût siège, faute de part attribuable.`);

  // 8. Lecture
  insertAfter("- Côté coûts, les équivalents API des nouveaux bras", `- **Ember comme secours du refresh (nouveau en v12)** : ${EMBER_VERDICT_LONG}`);

  // 9. Limites et sources
  insertAfter("- Compteurs de siège : Muse lu", `- Muse Ember (nouveau en v12) : jetons réels sur le bras complet (pas d'échantillon burn) ; concurrence 4 ; compteur hebdomadaire Muse partagé avec un aveugle de classification et d'autres sessions du compte, donc USD siège/doc \`missing source\`. Les runners versionnés \`run-arm-ember.sh\` et \`watch-muse-weekly.sh\` (lecture \`muse usage --json\` toutes les 10 minutes, arrêt à 85 %) enregistrent \`promptSha256\`, \`startedAt\`, \`model_id\` et le pourcentage hebdomadaire par document.`);
  insertAfter("- Muse Ember (nouveau en v12) : jetons réels", `- Surface d'accès Muse (bras Ember, §2) : outils non restreints (dont \`bash\` sur l'hôte et le serveur MCP \`h2a\`, catalogue exact \`unverified\`) ; ${toolDocs.length} appel(s) d'outil observé(s) sur ${nDocs} documents (${toolDocs.map(({ e, d }) => `${lab(e)} \`${d.doc}\``).join(", ") || "aucun"}), ${multiDocs.length} documents à deux réponses modèle, skills : ${skills}. Sensibilité, score publié inchangé : ${EMBER.filter((e) => e.sens).map((e) => `${lab(e)} avec ${e.sens.excludedAsRefused.map((x) => `\`${x}\``).join(", ")} compté refusé : ${e.sens.accepted}/100 acceptés, P ${fr(e.sens.strict.precision)}, R ${fr(e.sens.strict.recall)}, F1 ${fr(e.sens.strict.f1)} (publié : P ${fr(e.s.strict.precision)}, R ${fr(e.s.strict.recall)}, F1 ${fr(e.s.strict.f1)})`).join(" ; ") || "aucune"} ; l'exclusion est une décision owner. Risque de collision sur \`/tmp/out.json\` et \`/tmp/build.js\` en concurrence 4 (écriture dans \`/tmp\` de l'hôte). Muse Wonder low : surface \`unverified\` (bras capturé en texte brut).`);
  insertAfter("- Catalogue AGY du siège", "- **Page primaire Meta** — tarif `muse-ember-1.0` (0,10 / 0,004 / 0,50 USD par M jusqu'à 200 k de contexte ; 0,30 / 0,012 / 1,50 au-delà) : https://dev.meta.ai/models/muse-ember/, consultée le 2026-11-13 ; concordant avec llmgateway.io/models/muse-ember-1.0 et llmreference.com/model/muse-ember/meta-model-api (sorti le 2026-11-09 selon ces pages). La page ne dit pas si le raisonnement est facturé comme sortie.");

  // ---- v12 : noms complets, meilleurs bras, graphiques style v10 ----
  replaceOnce("Ce dossier **v11** (sans « alpha ») intègre", "Le socle **v11** (sans « alpha ») intègre");
  replaceOnce("Le tri du tableau global v11 est par", "Le tri du tableau global v12 est par");
  appendToLine("- Coûts : équivalents API calculés depuis les jetons réels", " Exception v12 : le tarif `muse-ember-1.0` est relevé sur la page primaire Meta (§6) ; coût siège Muse Ember 1.0 : `missing source` (compteur partagé, non attribuable).");
  insertAfter("- Corpus : 100 documents du manifeste v101b", `- **Noms complets des modèles (v12)** — tableaux et graphiques : ${MODEL_NAMES.map(([, full, id]) => `${full} = \`${id}\``).join(" ; ")}. Cascades : CP actuel = GPT-6 Astra medium puis vérification Gemini 3.8 Flash low ; CP-low = GPT-6 Astra low puis Gemini 3.8 Flash low ; C2 = 2 essais Gemini 3.8 Flash low puis repli GPT-6 Astra (politique historique #719) ; C3 = 3 essais Gemini 3.8 Flash low puis repli GPT-6 Astra (variante documentaire v10). Sources : rapport v10 §« Noms des modèles » et §« les deux cascades reconstruites », v11alpha §1. Le texte courant garde les noms courts (Astra = GPT-6 Astra, etc.).`);
  insertAfter("- tableau « Meilleurs bras » ci-dessous", `- surface d'accès de la CLI Muse déclarée (§2, §9) : ${toolDocs.length} appel(s) d'outil sur ${nDocs} documents Ember, ${multiDocs.length} documents à deux réponses modèle ; score publié inchangé, sensibilité donnée, exclusion laissée à l'owner.`);
  // Ambiguous "new arms" wording of the v11 text: name the arms explicitly.
  replaceOnce("Les latences p50/p90 des deux nouveaux bras", "Les latences p50/p90 des deux bras v11 (Muse Wonder low, Gemini Argon low)");
  replaceOnce("Nouveaux bras, concurrence 10", "Bras v11 (Muse Wonder low, Gemini Argon low), concurrence 10");
  replaceOnce("### Synthèse coûts des nouveaux bras", "### Synthèse coûts des bras v11 et v12");
  replaceOnce("contexte CLI inclus » (les deux bras)", "contexte CLI inclus » (Muse Wonder low et Gemini Argon low, bras v11)");
  replaceOnce("les deux nouveaux bras se placent", "les deux bras v11 (Muse Wonder low, Gemini Argon low) se placent");
  replaceOnce("Les refus des nouveaux bras", "Les refus des bras v11 et v12 (Wonder, Argon, Ember)");
  replaceOnce("les équivalents API des nouveaux bras", "les équivalents API des deux bras v11");
  // Table rows: full versioned model names.
  md = md.split("\n").map((line) => {
    if (!line.startsWith("|")) return line;
    const cells = line.split("|");
    const k = /^\s*\d+\s*$/.test(cells[1]) ? 2 : 1;
    const raw = cells[k].trim();
    const bold = raw.startsWith("**");
    const flag = raw.endsWith(" ᵃ") ? " ᵃ" : "";
    const bare = raw.replace(/ ᵃ$/, "").replace(/\*\*/g, "");
    const full = fullName(bare);
    if (!full) return line;
    cells[k] = ` ${bold ? `**${full}**` : full}${flag} `;
    return cells.join("|");
  }).join("\n");
  // Meilleurs bras (computed from ALL, never hard-coded). F1 / coût API is
  // given under both billing hypotheses for reasoning tokens (Meta's page does
  // not say): only the Muse rows with separate reasoning counts change.
  const isCascade = (row) => /^(CP|C2$|C3$)/.test(row.label);
  const pick = (rows, score) => rows.filter((row) => score(row) !== null && Number.isFinite(score(row)))
    .sort((a, b) => (score(b) - score(a)) || (b.f1 - a.f1))[0];
  const apiWithReasoning = (row) => {
    const e = EMBER.find((x) => x.row.label === row.label);
    if (e) return e.apiR;
    if (row.label === wonderRow.label) return wonderApiBurnWithReasoning;
    return row.api;
  };
  const ratioApi = (row) => (row.api > 0 && row.f1 > 0 ? row.f1 / row.api : null);
  const ratioApiR = (row) => { const a = apiWithReasoning(row); return a > 0 && row.f1 > 0 ? row.f1 / a : null; };
  const winA = pick(ALL, ratioApi), winB = pick(ALL, ratioApiR);
  const runnerUp = (score, w) => pick(ALL.filter((row) => row !== w), score);
  const hypTxt = (w, score, other, rival) => `${(score(w)).toFixed(1)} F1 par USD/doc ; second : ${fullName(other.label)} ${(score(other)).toFixed(1)}${rival && rival !== w && rival !== other ? ` ; ${fullName(rival.label)} (gagnant de l'autre hypothèse) : ${(score(rival)).toFixed(1)}` : ""}`;
  const bestRows = [
    ["Meilleur F1 strict (toutes lignes)", pick(ALL, (row) => row.f1), (row) => `F1 ${fmt(row.f1)}`],
    ["Meilleur rappel strict", pick(ALL, (row) => row.r), (row) => `R ${fmt(row.r)}`],
    ["Meilleur bras seul (hors cascade), F1 strict", pick(ALL.filter((row) => !isCascade(row)), (row) => row.f1), (row) => `F1 ${fmt(row.f1)}`],
    ["Meilleur rapport F1 / coût API — hypothèse A : raisonnement non facturé", winA, (row) => hypTxt(row, ratioApi, runnerUp(ratioApi, row), winB)],
    ["Meilleur rapport F1 / coût API — hypothèse B : raisonnement facturé en sortie", winB, (row) => `${hypTxt(row, ratioApiR, runnerUp(ratioApiR, row), winA)} (coût API retenu : ${fmtUsd(apiWithReasoning(row))})`],
    ["Meilleur rapport F1 / coût — siège (lignes avec siège attribuable)", pick(ALL, (row) => (row.seat > 0 && row.f1 > 0 ? row.f1 / row.seat : null)), (row) => `${(row.f1 / row.seat).toFixed(1)} F1 par USD/doc`],
  ];
  const cell = (v, d = 3) => (v === null || v === undefined ? "N-A (aucune sortie acceptée)" : fmt(v, d));
  const usd = (v) => (v === null || v === undefined ? "missing source" : fmtUsd(v));
  const sameWinner = winA === winB;
  const bestMd = [
    "## Meilleurs bras (v12)",
    "",
    `Calculé depuis les ${ALL.length} lignes du tableau global (§3), oracle 676. Coûts en USD hors taxes par document ; \`missing source\` = non mesuré, jamais estimé. Le rapport F1 / coût est F1 strict divisé par le coût par document. Le rapport F1 / coût API dépend d'une hypothèse non tranchée : la page tarifaire Meta ne dit pas si les jetons de raisonnement Muse sont facturés comme sortie. Hypothèse A (convention du tableau global) : raisonnement non facturé ; hypothèse B : raisonnement facturé en sortie (Muse Ember 1.0 ${EMBER.map((e) => `${e.effort} ${fmtUsd(e.apiR)}`).join(", ")} ; Muse Wonder 1.0 low ${fmtUsd(wonderApiBurnWithReasoning)} ; autres lignes inchangées). ${sameWinner ? `Les deux hypothèses donnent le même gagnant : ${fullName(winA.label)}.` : `Gagnant selon A : ${fullName(winA.label)} ; selon B : ${fullName(winB.label)}.`}`,
    "",
    "| Critère | Modèle complet | Effort | P | R | F1 strict | Équiv. API USD/doc | USD siège/doc | Valeur |",
    "|---|---|---|---|---|---|---|---|---|",
    ...bestRows.map(([crit, row, val]) => `| ${crit} | ${modelOf(row.label)} | ${effortOf(row.label)} | ${cell(row.p)} | ${cell(row.r)} | ${cell(row.f1)} | ${usd(row.api)} | ${usd(row.seat)} | ${val(row)} |`),
    "",
  ].join("\n");
  insertBefore("## 1. Résumé exécutif", bestMd);
  // v10-style charts
  const { chartsV12 } = await import(new URL("./charts-v12.mjs", import.meta.url));
  V12_CHARTS = chartsV12(ALL.map((row) => ({ label: row.label, name: fullName(row.label), accepted: row.accepted, p: row.p, r: row.r,
    f1: row.f1, api: row.api, seat: row.seat, isV12: row.label.startsWith("Muse Ember") })));
  const shortName = (row) => fullName(row.label)?.replace(/\s*\((siège|API|siège AGY|Cloud Code)\)$/, "") ?? row.label;
  const noApi = ALL.filter((row) => !(row.api > 0)).map(shortName);
  const apiOnly = ALL.filter((row) => row.api > 0 && !(row.seat > 0)).map(shortName);
  const ls = md.split("\n");
  const s7 = ls.findIndex((l) => l.startsWith("## 7. Graphiques"));
  const s8 = ls.findIndex((l) => l.startsWith("## 8. Lecture"));
  if (s7 < 0 || s8 < s7) throw new Error("section 7/8 anchors");
  const ck = V12_CHARTS.check;
  ls.splice(s7 + 1, s8 - s7 - 1,
    "",
    "![Précision-rappel nets, style v10 : couleur = fournisseur, forme = modèle, pointillé = progression d'effort ; bras v12 en contour noir](assets/2026-11/benchmark-v12-precision-rappel.svg)",
    "",
    "![F1 strict et coût par document : équivalent API plein, siège creux, même bras relié](assets/2026-11/benchmark-v12-f1-cost.svg)",
    "",
    "![Acceptation sur 100 documents, couleur = fournisseur, forme = modèle](assets/2026-11/benchmark-v12-acceptation.svg)",
    "",
    "![Rappel strict trié décroissant, F1 en point noir](assets/2026-11/benchmark-v12-rappel.svg)",
    "",
    `Graphiques v12 générés en Node par \`tools/bench-v11/charts-v12.mjs\` (règle zéro Python), dans le style du v10 (v101b, Matplotlib) : couleur = fournisseur, forme = modèle, pointillé = progression d'effort d'un même modèle (off → minimal → low → medium → high → xhigh → max), étoile = cascade, libellé posé à côté de chaque point avec des traits de rappel courts, courbes de même F1 en gris clair. Noms complets des modèles avec version ; C2 et C3 sont distingués par leur politique de reprise (2 ou 3 essais Gemini avant le repli Astra). Le graphique F1-coût reprend la lecture v10 : équivalent API en plein, siège en creux, reliés pour un même bras (convention A : raisonnement non facturé). Lignes avec point API seul (siège \`missing source\`, ${apiOnly.length}) : ${apiOnly.join(", ")}. Lignes absentes du graphique F1-coût, faute d'équivalent API publié (${noApi.length}) : ${noApi.join(", ")}. Bras v12 (Muse Ember 1.0 xhigh et max) : contour noir épais et libellé gras « v12 ». Contrôle automatique des libellés : ${ck.prLabelOverlaps} chevauchement(s) sur précision-rappel, ${ck.f1CostLabelOverlaps} sur F1-coût ; rendus vérifiés à l'œil.`,
    "");
  md = ls.join("\n");
}

// ================= Emission =================
await mkdir(ASSETS, { recursive: true });
if (V12) {
  await writeFile(`${ASSETS}/benchmark-v12-precision-rappel.svg`, V12_CHARTS.precisionRecall, "utf8");
  await writeFile(`${ASSETS}/benchmark-v12-f1-cost.svg`, V12_CHARTS.f1Cost, "utf8");
  await writeFile(`${ASSETS}/benchmark-v12-acceptation.svg`, V12_CHARTS.acceptation, "utf8");
  await writeFile(`${ASSETS}/benchmark-v12-rappel.svg`, V12_CHARTS.recall, "utf8");
} else {
  await writeFile(`${ASSETS}/benchmark-v11-precision-rappel.svg`, chartPrecisionRecall(), "utf8");
  await writeFile(`${ASSETS}/benchmark-v11-f1-cost.svg`, chartF1Cost(), "utf8");
  await writeFile(`${ASSETS}/benchmark-v11-acceptation.svg`, chartAcceptation(), "utf8");
  await writeFile(`${ASSETS}/benchmark-v11-rappel.svg`, chartRecall(), "utf8");
}
await writeFile(`${OUT}.md`, md, "utf8");

// HTML: reuse the v10 stylesheet, minimal Markdown conversion for this file.
let css = "";
try {
  const v10html = await readFile("docs/reports/benchmark-v101b-2026-09-17.html", "utf8");
  css = v10html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
} catch { css = "body{font-family:sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px}"; }
const inline = (t) => esc(t)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2"/>');
function mdToHtml(source) {
  const lines = source.split("\n");
  let html = "", inTable = false, wide = false;
  const closeTable = () => { if (inTable) { html += "</tbody></table></section>"; inTable = false; } };
  for (const line of lines) {
    if (line.startsWith("<!-- page:wide")) { wide = true; continue; }
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c.replace(/:/g, "")))) continue;
      if (!inTable) { html += `<section class="page ${wide ? "wide" : "portrait"}"><table><thead><tr>${cells.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`; inTable = true; continue; }
      html += `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      continue;
    }
    closeTable(); if (line.trim() !== "") wide = false;
    if (line.startsWith("# ")) html += `<section class="page portrait"><h1>${inline(line.slice(2))}</h1>`;
    else if (line.startsWith("## ")) html += `</section><section class="page portrait"><h2>${inline(line.slice(3))}</h2>`;
    else if (line.startsWith("### ")) html += `<h3>${inline(line.slice(4))}</h3>`;
    else if (line.startsWith("- ")) html += `<p>- ${inline(line.slice(2))}</p>`;
    else if (line.trim() === "") html += "";
    else html += `<p>${inline(line)}</p>`;
  }
  closeTable();
  return html + "</section>";
}
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Benchmark municipal ${V12 ? "v12" : "v11"} - rapport complet</title><style>${css}</style></head><body>${mdToHtml(md)}</body></html>`;
await writeFile(`${OUT}.html`, html, "utf8");
console.log(JSON.stringify({
  out: OUT, rows: ALL.length, v12: V12, chartCheck: V12_CHARTS?.check ?? null,
  wonder: { accepted: wonderScores.accepted, f1: wonderScores.strict.f1, apiBurn: wonderApiBurn },
  argon: { accepted: argonScores.accepted, f1: argonScores.strict.f1, apiArm: argonApiArm, okDocs: argonOk.length, quota: argonQuota },
}, null, 1));




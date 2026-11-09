// bench-v11: generate the full v11 dossier (Markdown + SVG charts + HTML)
// from frozen published rows (v10/v11alpha, never altered) plus the two new
// seat arms scored in tmp/bench-wonder (Muse Wonder low, Gemini Argon low).
// PDF is produced afterwards with Chromium headless --print-to-pdf.
// Usage (from repo root):
//   node tools/bench-v11/build-v11-report.mjs [benchTmpDir] [outPrefix]
// Defaults: benchTmpDir=tmp/bench-wonder, outPrefix=docs/reports/benchmark-v11-2026-11-09
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const TMP = process.argv[2] ?? "tmp/bench-wonder";
const OUT = process.argv[3] ?? "docs/reports/benchmark-v11-2026-11-09";
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

const wonderRow = {
  label: "Muse Wonder low (siège)", accepted: wonderScores.accepted,
  p: wonderScores.strict.precision, r: wonderScores.strict.recall, f1: wonderScores.strict.f1,
  api: wonderApiBurn, seat: null, flag: "", isNew: true,
};
const argonRow = {
  label: "Gemini Argon low (siège AGY)", accepted: argonScores.accepted,
  p: argonScores.strict.precision, r: argonScores.strict.recall, f1: argonScores.strict.f1,
  api: argonApiArm, seat: null, flag: "", isNew: true,
};
const ALL = [...OLD, wonderRow, argonRow].sort((a, b) => (b.r - a.r) || (b.f1 - a.f1));
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
  s += `<text x="${ml + 8}" y="${mt + ih - 8}" font-size="10.5" fill="#444">Siege = API x facteur fournisseur (v10). Nouveaux bras sans facteur mesure : absents (missing source), jamais estimes.</text>`;
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
  `| **Gemini Argon low** | 100 | ${argonScores.accepted} | ${argonScores.failClasses.J} · ${argonScores.failClasses.V} · ${argonScores.failClasses.Pr} · ${argonScores.failClasses.T} | ${fmt(argonScores.f1n4)} | ${fmt(argonScores.p50s, 1)} ¹ | ${fmt(argonScores.p90s, 1)} ¹ | ${Math.round(argonTok.out ?? 0)} réelle (bras) | ${fmtUsd(argonApiArm)} ³ | missing source |`,
].join("\n");

const wonderBurnRowsMd = [...wonderBurn].sort((a, b) => (a.allowance?.as_of_ms ?? 0) - (b.allowance?.as_of_ms ?? 0))
  .map((u) => `| ${u.model ? "" : ""}${Object.keys(u).length ? "" : ""}${u.terminalChars !== undefined ? "" : ""}${u.inputTokens} | ${u.outputTokens} | ${u.reasoningTokens} | ${u.cachedTokens} | ${u.allowance ? `${u.allowance.weekly?.used_percent} % (reset ${iso(u.allowance.weekly?.resets_at_ms)})` : "N-A"} | ${u.allowance ? iso(u.allowance.as_of_ms) : "N-A"} |`).join("\n");
// Document ids for burn rows, aligned after sort by as_of (keep filename order mapping separately below).
const wonderBurnDocRows = (() => {
  const sorted = [...wonderBurn].sort((a, b) => (a.allowance?.as_of_ms ?? 0) - (b.allowance?.as_of_ms ?? 0));
  return sorted;
})();

const md = `# Quel modèle pour lire les documents municipaux ?

**Benchmark v11 · Rapport complet · 9 novembre 2026**<br>
Rédaction : lane benchmark v11 (conductor i-cond) ; base v10 (v101b, oracle 674) et v11alpha (oracle 676, #725).

## 1. Résumé exécutif

Ce dossier **v11** (sans « alpha ») intègre les lignes v11alpha, le bras **Muse Wonder low** complet et le nouveau bras **Gemini Argon low**, selon strictement la même méthode que v11alpha : mêmes prompts gelés (revérifiés \`count=100, fail=0\`), même validateur v9 gelé + provenance, même scoreur oracle 676 (43 non résolus neutres). Seule différence de protocole, déclarée : **concurrence 10** pour les deux nouveaux bras (amendement owner). Aucune valeur publiée en v10 ou v11alpha n'est altérée ; les nouvelles lignes s'ajoutent.

- **Muse Wonder low** (\`muse-wonder-1.0\`, siège Muse) : ${wonderScores.accepted}/100 acceptés, P ${fmt(wonderScores.strict.precision)}, R ${fmt(wonderScores.strict.recall)}, F1 strict ${fmt(wonderScores.strict.f1)} — rang ${rankByRecall.get("Muse Wonder low (siège)")} au tri par rappel.
- **Gemini Argon low** (\`gemini-4-argon-low\`, siège AGY / Gemini Ultra) : ${argonScores.accepted}/100 acceptés, P ${fmt(argonScores.strict.precision)}, R ${fmt(argonScores.strict.recall)}, F1 strict ${fmt(argonScores.strict.f1)} — rang ${rankByRecall.get("Gemini Argon low (siège AGY)")} au tri par rappel.
- Le **combo CP actuel** reste en tête en F1 (0,507) ; aucun modèle seul ne l'égale. Le tri du tableau global v11 est par **rappel décroissant** (consigne du dossier), le F1 reste affiché.
- Coûts : équivalents API calculés depuis les jetons réels et des tarifs publics sourcés et datés (section 6). Coûts siège des deux nouveaux bras : **\`missing source\`** (compteurs lus quand ils existent, dérivation impossible sans attribution isolable — relevés complets en section 6). Rien n'est estimé à la place.

## 2. Protocole

- Corpus : 100 documents du manifeste v101b (sha256 PDF vérifiés), prompts gelés sha256 identiques au v10, validation profil v9 + provenance, notation oracle v3 stricte sur **oracle 676** (#725, 43 non résolus neutres). Règle « Fair Benchmarking — No Cheating » (\`rules/MASTER.md\`) : métriques gelées avant notation, appliquées à l'identique, aucune fabrication, traçabilité complète.
- **Gemini Argon low** — modèle exact \`gemini-4-argon-low\` (catalogue AGY relevé le 2026-11-09 : \`gemini-4-argon-{low,medium,high}\`, effort encodé dans l'identifiant). Transport siège headless AGY, uniforme sur les 100 documents : \`agy --model gemini-4-argon-low --input-format stream-json --output-format stream-json\`, ligne d'entrée \`{"event":"user","message":{"content":<octets du prompt gelé>}}\`, fichier brut = \`result.response\` de l'événement final. Le canal stdin remplace le canal argv (\`--print=<prompt>\`) qui heurte la limite Linux de 128 Kio par argument (\`spawn E2BIG\`) sur les plus gros prompts gelés : un premier passage argv (53/100 documents, 3 erreurs d'outillage, arrêt E2BIG avant toute validation ni notation) est archivé sous \`arms/gemini-argon-low/pass1-print-raw/\` et n'est **pas** noté. La CLI AGY ajoute son propre contexte d'agent autour du prompt gelé : l'écart avec un appel API brut n'est **pas mesuré** (même réserve que les bras Opus 5.5 \`claude -p\` de v11alpha).
- **Muse Wonder low** — \`muse-wonder-1.0\`, \`muse exec --provider meta --reasoning-effort low --prompt-file <prompt gelé>\`, siège Muse, déjà exécuté (100/100, 0 événement quota). Colonnes complétées ici par capture d'usage \`--json\` sur l'échantillon burn (jetons réels fournisseur).
- Sièges uniquement, aucune clé API. Reprise sur quota de siège : attente 300 s, maximum 12 tentatives, jamais de bascule clé, le quota n'est jamais compté comme un refus. Argon : ${argonQuota} événement(s) quota sur le passage noté ; Wonder : 0.
- **Concurrence 10** (au lieu de 1 en v11alpha) : les latences p50/p90 des deux nouveaux bras sont mesurées sous concurrence 10 et **ne sont pas comparables** aux colonnes de latence v10/v11alpha. P, R, F1 et acceptés ne dépendent pas de la concurrence.
- Incidents d'infrastructure Argon (jamais comptés comme refus ni quota) : erreurs de construction de boîte à outils AGY (\`mcp_h2a_render_BarChart\`, \`$ref\` distant résolu en URL fichier), authentification expirée et flux interrompus. Cause établie par reproduction : en séquentiel, aucune erreur d'outillage ; en rafale de 10 démarrages simultanés, les constructions de boîte à outils entrent en collision. Les échecs ont été repris par relances du runner (seules les sorties non vides sont sautées), les derniers documents en séquentiel avec la même commande et les mêmes octets. Les flux des réponses réussies ne contiennent aucun appel d'outil (étapes \`user_input\` puis \`agent_response\`) : la boîte à outils n'intervient pas dans l'extraction.

## 3. Tableau global — tri par rappel décroissant (oracle 676)

40 lignes : 38 lignes v11alpha recopiées sans rescoring, plus Muse Wonder low et Gemini Argon low. ᵃ = valeur du rapport v10 (oracle 674) telle que publiée en v11alpha. USD hors taxes ; \`missing source\` = jamais estimé.
<!-- page:wide -->
| # (rappel) | Modèle · effort | Acceptés /100 | P | R | F1 strict | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|
${globalRowsMd}

Lecture : le tri par rappel met Astra medium (R 0,534) et CP (R 0,533) en tête ; CP reste premier en F1 (0,507) et en précision (0,484). Gemini Argon low et Muse Wonder low se classent par leur rappel respectif (voir rangs ci-dessus). Les coûts siège historiques valent \`API × facteur fournisseur\` mesuré par burn en v10 (Codex 0,044235 ; Google 0,037931 ; Claude 0,030248) ; les nouveaux bras n'ont pas de facteur mesuré : \`missing source\`.

## 4. Détail des bras siège

J = JSON invalide ; V = profil v9 refusé ; Pr = provenance ; T = transport / réponse vide. Pour les bras v11alpha, la colonne publiée était J · V · T (Pr non séparé : N-A ici, sans rescoring).

| Bras | Tentés | Acceptés | Échecs (J · V · Pr · T) | F1 net 4 doc | p50 s | p90 s | Sortie moy. (jetons) | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|---|---|---|---|---|
${seatDetailMd}

¹ Concurrence 10 : non comparable aux latences v11alpha (concurrence 1). ² Tarif Meta Model API \`muse-wonder-1.0\` 4,00 / 0,20 (cache) / 20,00 USD par million de jetons (entrée / cache / sortie), prix public relevé le 2026-11-03 (voir sources §6) ; formule \`[(I−C)×4 + C×0,20 + O×20]/10⁶\` sur jetons réels du burn (n=${wonderBurn.length}, seau S — voir limites §6). Avec raisonnement facturé en sortie : ${fmtUsd(wonderApiBurnWithReasoning)}. ³ Tarif Gemini Developer API \`Gemini 4 Argon\` 2,00 / 0,10 (cache) / 10,00 USD par million (en vigueur au 2026-11-09, avant le passage à 4/20 le 2026-12-01) ; formule \`[(I−C)×2 + C×0,10 + (O+T)×10]/10⁶\` sur jetons réels du bras complet (n=${argonOk.length}) ; burn (n=${argonBurn.length}) : ${fmtUsd(argonApiBurn)}.

Détail Wonder : ${wonderDetail.tokLine}. Détail Argon : ${argonDetail.tokLine}. Scores secondaires (même scoreur) — Wonder : F1 broad ${fmt(wonderScores.broad.f1)}, stage-tolerant ${fmt(wonderScores.stageTolerant.f1)}, soft ${fmt(wonderScores.soft.f1)} (TP ${wonderScores.strict.tp}, FP ${wonderScores.strict.fp}, FN ${wonderScores.strict.fn}). Argon : F1 broad ${fmt(argonScores.broad.f1)}, stage-tolerant ${fmt(argonScores.stageTolerant.f1)}, soft ${fmt(argonScores.soft.f1)} (TP ${argonScores.strict.tp}, FP ${argonScores.strict.fp}, FN ${argonScores.strict.fn}).

<!-- page:wide -->

## 5. Latences

Les p50/p90 des bras v10/v11alpha (concurrence 1) restent ceux des rapports publiés (tableaux v10 §5 et v11alpha §3, non recopiés ici pour éviter toute altération). Nouveaux bras, concurrence 10 — **non comparables** : Muse Wonder low p50 ${fmt(wonderScores.p50s, 1)} s, p90 ${fmt(wonderScores.p90s, 1)} s ; Gemini Argon low p50 ${fmt(argonScores.p50s, 1)} s, p90 ${fmt(argonScores.p90s, 1)} s (temps mur des seules tentatives réussies distinctes ; Argon mélange le passage principal en concurrence 10 et des reprises séquentielles d'erreurs d'infrastructure, donc doublement non comparable ; événements quota Argon : ${argonQuota}). Sous concurrence 10, ces durées incluent l'attente d'ordonnancement du siège partagé.

## 6. Coûts, sièges et tests de burn

Un accès API facture les jetons ; un siège est un abonnement à quota. Le burn mesure la consommation de quota sur un échantillon fixe (10 documents gelés, les 10 premiers du manifeste), avec relevés avant/après quand le fournisseur expose un compteur. Méthode v10 : \`C_siège = C_API × f\`, \`f = S / É_mois\` extrapolé de la fraction de quota consommée. Sans bascule de compteur attribuable, aucun facteur n'est dérivé : \`missing source\`.

### Tarifs publics utilisés (source et date de relevé)

| Objet | Tarif | Source | Relevé |
|---|---|---|---|
| Meta Model API \`muse-wonder-1.0\` | 4,00 entrée / 0,20 cache / 20,00 sortie USD par M jetons | Page tarifs Meta Model API, via relevés publics concordants (superagnt.com/muse/pricing ; sentisight.ai) | 2026-11-03 |
| Gemini Developer API \`Gemini 4 Argon\` | 2,00 entrée / 0,10 cache / 10,00 sortie USD par M jetons (4/20 à partir du 2026-12-01) | Page tarifs Gemini Developer API, via relevés publics concordants (licenseware.io, source : Gemini Developer API pricing au 2026-11-03) | 2026-11-03 (en vigueur au 2026-11-09) |
| Google AI Ultra (siège) | 99,99 USD/mois (5x) ; 199,99 USD/mois (20x), US | gemini.google/subscriptions, via relevés publics concordants (lilachbullock.com ; whizi.io) | octobre 2026 |
| Muse Code (siège) | Power 50 USD/mois ; Maximum 200 USD/mois (Wonder Full inclus) | Meta Help Center / tarifs Muse, via relevés publics concordants (superagnt.com/muse/pricing) | 2026-11-03 |

Le palier exact détenu par l'owner (Ultra 5x ou 20x « doublé », Muse Power ou Maximum) n'est pas établi par une source lisible dans cette lane : il n'entre dans aucun calcul publié ici.

### Burn Muse Wonder low (siège Muse, compteur exposé)

Échantillon : 10 premiers documents du manifeste, \`muse exec --provider meta --model muse-wonder-1.0 --reasoning-effort low --json\` séquentiel (run-burn-wonder-usage10). Un premier essai Saint-Polycarpe a échoué sur timeout du runtime Muse (exit 1, usage nul) puis a réussi à la reprise ; il n'est pas compté comme un refus. Jetons réels moyens : entrée ${Math.round(mean(wonderBurn, "inputTokens") ?? 0)}/doc, sortie ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)}/doc, raisonnement ${Math.round(mean(wonderBurn, "reasoningTokens") ?? 0)}/doc, cache ${Math.round(mean(wonderBurn, "cachedTokens") ?? 0)}/doc. Ces entrées incluent le contexte propre de la CLI Muse (contexte d'agent autour du prompt gelé) : l'équivalent API surestime donc le coût du seul prompt gelé en API brute — même réserve que les bras \`claude -p\` de v11alpha.

Relevés d'allocation (\`run.usage.allowance\`, source \`stream\`) : hebdomadaire ${wonderAllow.length ? `${wonderAllow[0].allowance.weekly.used_percent} % au ${iso(wonderAllow[0].allowance.as_of_ms)} → ${wonderAllow[wonderAllow.length - 1].allowance.weekly.used_percent} % au ${iso(wonderAllow[wonderAllow.length - 1].allowance.as_of_ms)}` : "N-A"} (réinitialisation ${wonderAllow.length ? iso(wonderAllow[0].allowance.weekly.resets_at_ms) : "N-A"}). La fenêtre courte a basculé entre-temps (réinitialisation intermédiaire) et n'est pas comparable. Le compteur hebdomadaire est partagé avec toutes les sessions du compte, y compris la session conductrice : la bascule observée (+1 point entier, granularité ±1 point) n'est pas attribuable au seul échantillon. **USD siège/doc Muse Wonder low : \`missing source\`** (compteur lu, dérivation non attribuable, palier d'abonnement non établi).

### Burn Gemini Argon low (siège AGY / Gemini Ultra, compteur non exposé)

Échantillon : mêmes 10 documents, \`agy --model gemini-4-argon-low --output-format json\` séquentiel (run-burn-argon). Jetons réels moyens du burn : entrée ${argonBurn.length ? Math.round(mean(argonBurn, "inputTokens") ?? 0) : "N-A"}/doc, sortie ${argonBurn.length ? Math.round(mean(argonBurn, "outputTokens") ?? 0) : "N-A"}/doc, réflexion ${argonBurn.length ? Math.round(mean(argonBurn, "thinkingTokens") ?? 0) : "N-A"}/doc (horodatages par document dans \`burn-argon-usage10/*.usage.json\`). L'enveloppe AGY expose \`usage\` (jetons) mais **aucun compteur d'allocation de siège** (vérifié sur \`--help\`, \`models\` et l'enveloppe JSON le 2026-11-09) : aucun relevé avant/après n'existe. **USD siège/doc Gemini Argon low : \`missing source\`** (prix Ultra sourcés ci-dessus, aucune fraction de quota mesurée). Équivalent API du burn : ${fmtUsd(argonApiBurn)} ; du bras complet (n=${argonOk.length}, jetons réels \`stream-json\`) : ${fmtUsd(argonApiArm)}.

### Synthèse coûts des nouveaux bras

| Bras | Jetons entrée/doc | Jetons sortie/doc | Équiv. API USD/doc | USD siège/doc |
|---|---|---|---|---|
| Muse Wonder low | ${Math.round(mean(wonderBurn, "inputTokens") ?? 0)} (burn n=${wonderBurn.length}, CLI incluse) | ${Math.round(mean(wonderBurn, "outputTokens") ?? 0)} (+ raisonnement ${Math.round(mean(wonderBurn, "reasoningTokens") ?? 0)}) | ${fmtUsd(wonderApiBurn)} | missing source |
| Gemini Argon low | ${Math.round(argonTok.in ?? 0)} (bras n=${argonOk.length}) | ${Math.round(argonTok.out ?? 0)} (+ réflexion ${Math.round(argonTok.think ?? 0)}) | ${fmtUsd(argonApiArm)} | missing source |

## 7. Graphiques

![Précision-rappel nets, nouveaux bras cerclés de noir](assets/2026-11/benchmark-v11-precision-rappel.svg)

![F1 strict et coût siège ; nouveaux bras sans facteur mesuré absents (missing source)](assets/2026-11/benchmark-v11-f1-cost.svg)

![Acceptation sur 100 documents](assets/2026-11/benchmark-v11-acceptation.svg)

![Rappel strict trié décroissant, F1 en point noir](assets/2026-11/benchmark-v11-rappel.svg)

Graphiques régénérés en Node dans le style v101b (fond blanc, grille claire, DejaVu Sans) par \`tools/bench-v11/build-v11-report.mjs\` — les SVG v10 venaient de Matplotlib, non réutilisable sous la règle zéro Python du dépôt. Aucun point nouveau bras n'est placé sur le graphique F1-coût siège, faute de facteur mesuré.

## 8. Lecture

- Aucun modèle seul n'égale le combo CP (F1 0,507). Au tri par rappel, Astra medium et CP dominent ; les deux nouveaux bras se placent dans le peloton des bras siège (F1 Wonder ${fmt(wonderScores.strict.f1)}, Argon ${fmt(argonScores.strict.f1)}).
- Muse Wonder low dépasse tous les bras Muse 1.3 de v11alpha (meilleur : medium 0,262) ; Gemini Argon low est le premier bras Gemini 4 mesuré sur ce banc (à comparer à Gemini 3.8 low 0,368, medium 0,298, high 0,206 — générations différentes, même oracle).
- Les refus des nouveaux bras sont dominés par le profil v9 (V), comme en v11alpha aux efforts bas ; le détail J · V · Pr · T est en section 4.
- Côté coûts, les équivalents API des nouveaux bras (${fmtUsd(wonderApiBurn)} Wonder sur burn, ${fmtUsd(argonApiArm)} Argon sur bras) restent très inférieurs à CP (0,48134), pour une qualité moindre : le compromis publié en v10 n'est pas renversé par ces deux lignes.

## 9. Limites et traçabilité

- Échantillon burn Wonder : 10 documents du seau S (petits) ; les moyennes de jetons ne se extrapolent pas sans réserve aux seaux M/L. Les entrées Muse incluent le contexte CLI (voir §6).
- Compteurs de siège : Muse lu mais non attribuable (sessions partagées, granularité 1 point) ; AGY sans compteur exposé. Les deux USD siège/doc restent \`missing source\` ; les prix d'abonnement sourcés ne suffisent pas sans fraction de quota mesurée.
- Passage Argon argv archivé non noté (voir §2) ; erreurs d'outillage AGY (construction de boîte à outils MCP, \`retryable:false\`) reprises par relance du runner (seules les sorties non vides sont sautées) — jamais comptées comme refus modèle ni quota.
- Harnais versionné : \`tools/bench-v11/\` (scripts, manifeste + \`SHA256SUMS\`, oracle 676, profil gelé ; PDF du corpus exclus). Preuves d'exécution (clone, non versionnées) : \`tmp/bench-wonder/full/arms/{muse-wonder-low,gemini-argon-low}/\`, \`tmp/bench-wonder/full/scores-{wonder,argon}.json\`, \`tmp/bench-wonder/full/burn-{wonder,argon}-usage10/\`, \`tmp/bench-wonder/full/prompts/verify.json\`.
- Rapports v10 (\`benchmark-v101b-2026-09-17.md\`) et v11alpha (\`benchmark-v11alpha-2026-09-29.md\` + complément Wonder) intacts ; ce dossier les prolonge sans les modifier.

### Sources (prix et modèles, relevés publics)

- Meta Model API, tarifs \`muse-wonder-1.0\` (4,00 / 0,20 / 20,00 USD par M) et Muse Power 50 / Maximum 200 USD/mois — relevés concordants du 2026-11-03 (superagnt.com/muse/pricing ; sentisight.ai, « Muse Wonder Token Pricing » ; blog.laozhang.ai). Consultés pour ce dossier le 2026-11-09.
- Gemini Developer API, tarifs \`Gemini 4 Argon\` (2,00 / 0,10 / 10,00 USD par M jusqu'au 2026-11-30, puis 4/20) — relevés concordants du 2026-11-03 (licenseware.io, « Gemini API Cost per Million Tokens (November 2026) », source : Gemini Developer API pricing). Consultés le 2026-11-09.
- Google AI Ultra 99,99 (5x) / 199,99 (20x) USD/mois US — gemini.google/subscriptions via relevés concordants d'octobre 2026 (lilachbullock.com ; whizi.io, lecture du 2026-10-11). Page officielle réouverte le 2026-11-09 (édition Canada, Argon confirmé sur Pro et Ultra).
- Catalogue AGY du siège : \`agy models\` le 2026-11-09 (\`gemini-4-argon-low\` = « Gemini 4 Argon (Low) ») ; CLI \`agy\` headless \`--input-format stream-json\`.
`;

// ================= Emission =================
await mkdir(ASSETS, { recursive: true });
await writeFile(`${ASSETS}/benchmark-v11-precision-rappel.svg`, chartPrecisionRecall(), "utf8");
await writeFile(`${ASSETS}/benchmark-v11-f1-cost.svg`, chartF1Cost(), "utf8");
await writeFile(`${ASSETS}/benchmark-v11-acceptation.svg`, chartAcceptation(), "utf8");
await writeFile(`${ASSETS}/benchmark-v11-rappel.svg`, chartRecall(), "utf8");
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
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Benchmark municipal v11 - rapport complet</title><style>${css}</style></head><body>${mdToHtml(md)}</body></html>`;
await writeFile(`${OUT}.html`, html, "utf8");
console.log(JSON.stringify({
  out: OUT, rows: ALL.length,
  wonder: { accepted: wonderScores.accepted, f1: wonderScores.strict.f1, apiBurn: wonderApiBurn },
  argon: { accepted: argonScores.accepted, f1: argonScores.strict.f1, apiArm: argonApiArm, okDocs: argonOk.length, quota: argonQuota },
}, null, 1));




// bench-v12 charts in the v10 (v101b, Matplotlib) style, generated in Node
// (zero-Python rule): colour = provider, shape = model, dashed line = effort
// progression of one model (off → minimal → low → medium → high → xhigh →
// max), star = cascade, label next to each point with short leader lines,
// light-grey iso-F1 curves, legend below the plot. New v12 arms keep a thick
// black outline and a bold label.
// Exports: chartsV12(rows) -> { precisionRecall, f1Cost, acceptation, recall }
// rows: { label, accepted, p, r, f1, api, seat, isV12 } (USD per document).

const PROVIDER_COLORS = {
  OpenAI: "#1565a7", Google: "#16835f", Anthropic: "#b55b25", Meta: "#9a7400",
  Mistral: "#8652a3", Cascades: "#b82561",
};
const GREY = "#53626c";
const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const FONT = "font-family:'DejaVu Sans','Bitstream Vera Sans',sans-serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (v) => Number(v.toFixed(1));
// v12 marker in a label: inside an existing trailing parenthetical, else appended.
const withV12 = (s) => (/\)$/.test(s) ? s.replace(/\)$/, ", v12)") : `${s} (v12)`);

// ---- model / provider / shape identification (v10 shapes kept) ----
// circle: Astra, Opus 5, Gemini 3.8, Mistral, Muse 1.3
// square: Sol, Sonnet 5, Gemini Argon, Muse Wonder
// triangle: Luna, Sonnet 4.6, Muse Ember
// cross: GPT-4.1, Opus 5.5 ; star: cascades (CP, CP-low, C2, C3)
const MODELS = [
  { re: /^CP\+$/, model: "CP+", provider: "Cascades", shape: "star" },
  { re: /^Astra medium \(rejeu v12\)$/, model: "Astra replay", provider: "OpenAI", shape: "circle" },
  { re: /^CP actuel/, model: "CP", provider: "Cascades", shape: "star" },
  { re: /^CP-low/, model: "CP-low", provider: "Cascades", shape: "star" },
  { re: /^C2$/, model: "C2", tag: "C2 · 2× Gemini → Astra", provider: "Cascades", shape: "star" },
  { re: /^C3$/, model: "C3", tag: "C3 · 3× Gemini → Astra", provider: "Cascades", shape: "star" },
  { re: /^Astra /, model: "Astra", provider: "OpenAI", shape: "circle" },
  { re: /^Sol /, model: "Sol", provider: "OpenAI", shape: "square" },
  { re: /^Luna /, model: "Luna", provider: "OpenAI", shape: "triangle" },
  { re: /^GPT-4\.1 /, model: "GPT-4.1", provider: "OpenAI", shape: "cross" },
  { re: /^Gemini Argon /, model: "Gemini Argon", provider: "Google", shape: "square" },
  { re: /^Gemini /, model: "Gemini", provider: "Google", shape: "circle" },
  { re: /^Opus 5\.5 /, model: "Opus 5.5", provider: "Anthropic", shape: "cross" },
  { re: /^Opus 5 /, model: "Opus 5", provider: "Anthropic", shape: "circle" },
  { re: /^Sonnet 5 /, model: "Sonnet 5", provider: "Anthropic", shape: "square" },
  { re: /^Sonnet 4\.6 /, model: "Sonnet 4.6", provider: "Anthropic", shape: "triangle" },
  { re: /^Muse Ember /, model: "Muse Ember", provider: "Meta", shape: "triangle" },
  { re: /^Muse Wonder /, model: "Muse Wonder", provider: "Meta", shape: "square" },
  { re: /^Muse 1\.3 /, model: "Muse 1.3", provider: "Meta", shape: "circle" },
  { re: /^Mistral /, model: "Mistral Small 4", provider: "Mistral", shape: "circle" },
];
export function identify(label) {
  const m = MODELS.find((x) => x.re.test(label));
  if (!m) throw new Error(`unknown model for label: ${label}`);
  const bare = label.replace(/\s*\(.*\)\s*$/, "");
  const effort = m.provider === "Cascades" ? null : bare.split(" ").at(-1);
  if (effort !== null && !EFFORTS.includes(effort)) throw new Error(`unknown effort in: ${label}`);
  const short = m.provider === "Cascades" ? (m.tag ?? m.model) : `${bare}${/coupé/.test(label) ? " (coupé)" : ""}`;
  return { ...m, effort, short, color: PROVIDER_COLORS[m.provider] };
}

// ---- markers ----
function marker(shape, x, y, size, color, { hollow = false, v12 = false } = {}) {
  const sw = v12 ? 2.4 : 1.3;
  const stroke = v12 ? "#000000" : color;
  const fill = hollow ? "#ffffff" : color;
  const s = size;
  if (shape === "circle") return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(s * 0.55)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  if (shape === "square") return `<rect x="${n1(x - s * 0.55)}" y="${n1(y - s * 0.55)}" width="${n1(s * 1.1)}" height="${n1(s * 1.1)}" fill="${v12 ? color : "#ffffff"}" fill-opacity="${v12 ? 0.35 : 1}" stroke="${v12 ? "#000000" : color}" stroke-width="${v12 ? 2.4 : 1.5}"/>`;
  if (shape === "triangle") {
    const h = s * 0.68;
    return `<path d="M${n1(x)} ${n1(y - h)} L${n1(x + h * 0.95)} ${n1(y + h * 0.65)} L${n1(x - h * 0.95)} ${n1(y + h * 0.65)} Z" fill="${v12 ? color : "#ffffff"}" fill-opacity="${v12 ? 0.35 : 1}" stroke="${v12 ? "#000000" : color}" stroke-width="${v12 ? 2.4 : 1.5}"/>`;
  }
  if (shape === "cross") {
    const h = s * 0.5;
    return `<path d="M${n1(x - h)} ${n1(y - h)} L${n1(x + h)} ${n1(y + h)} M${n1(x - h)} ${n1(y + h)} L${n1(x + h)} ${n1(y - h)}" stroke="${v12 ? "#000000" : color}" stroke-width="${v12 ? 2.6 : 1.8}" fill="none"/>`;
  }
  if (shape === "star") {
    const R = s * 0.75, r = R * 0.45; let d = "";
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? r : R;
      d += `${i ? "L" : "M"}${n1(x + rr * Math.cos(a))} ${n1(y + rr * Math.sin(a))} `;
    }
    return `<path d="${d}Z" fill="${color}" stroke="${v12 ? "#000000" : color}" stroke-width="${v12 ? 2.4 : 0.8}"/>`;
  }
  throw new Error(`shape ${shape}`);
}

// ---- greedy label placement with short leader lines ----
const textWidth = (t, fs, bold) => t.length * fs * (bold ? 0.64 : 0.58);
const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
// Leader end: nearest point of the label box to the marker.
const leaderOf = (p, box) => {
  const tx = Math.min(Math.max(p.x, box.x1), box.x2), ty = Math.min(Math.max(p.y, box.y1 + 2), box.y2 - 2);
  const len = Math.hypot(tx - p.x, ty - p.y);
  if (len <= p.rad + 4) return null;
  return { sx: p.x + ((tx - p.x) / len) * (p.rad + 1.5), sy: p.y + ((ty - p.y) / len) * (p.rad + 1.5), tx, ty, len };
};
const sampleSegment = (x1, y1, x2, y2, step = 5) => {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step)); const out = [];
  for (let k = 0; k <= n; k += 1) { const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n; out.push({ x1: x - 1.5, y1: y - 1.5, x2: x + 1.5, y2: y + 1.5 }); }
  return out;
};
function placeLabels(points, frame, fs, segments = []) {
  // points: { x, y, text, color, bold, rad, prio } ; segments: [[x1,y1,x2,y2]]
  // drawn lines (effort / seat→API) are soft obstacles for label boxes.
  const placed = []; const leaders = [];
  const markers = points.map((p) => ({ x1: p.x - p.rad, y1: p.y - p.rad, x2: p.x + p.rad, y2: p.y + p.rad }));
  const lineDots = segments.flatMap(([a, b, c, d]) => sampleSegment(a, b, c, d));
  const order = points.map((p, i) => i).sort((a, b) => (points[b].prio - points[a].prio)
    || (density(points, b) - density(points, a)));
  const out = new Array(points.length);
  const dirs = [];
  for (const d of [5, 11, 18, 26, 36, 48, 62, 78, 96]) for (let k = 0; k < 24; k += 1) dirs.push({ d, a: (k * Math.PI) / 12 });
  for (const i of order) {
    const p = points[i];
    if (!p.text) { out[i] = { cost: 0, box: { x1: p.x, y1: p.y, x2: p.x, y2: p.y }, d: 0 }; continue; }
    const w = textWidth(p.text, fs, p.bold), h = fs * 1.05;
    let best = null;
    for (const { d, a } of dirs) {
      const dx = Math.cos(a) * (d + p.rad), dy = Math.sin(a) * (d + p.rad);
      const ax = p.x + dx, ay = p.y + dy;
      const cx = Math.abs(Math.cos(a)) < 0.3 ? ax - w / 2 : (Math.cos(a) > 0 ? ax : ax - w);
      const cy = Math.abs(Math.sin(a)) < 0.3 ? ay - h / 2 : (Math.sin(a) > 0 ? ay : ay - h);
      const box = { x1: cx - 1, y1: cy - 1, x2: cx + w + 1, y2: cy + h + 1 };
      let cost = d * 0.9;
      if (box.x1 < frame.x1 || box.x2 > frame.x2 || box.y1 < frame.y1 || box.y2 > frame.y2) cost += 1e6;
      for (const q of placed) cost += overlap(box, q) * 60;
      for (const m of markers) cost += overlap(box, m) * 30;
      // ambiguity: a label touching another point's halo reads as that point's label
      markers.forEach((m, j) => {
        if (j === i || !points[j].text) return;
        cost += overlap(box, { x1: m.x1 - 7, y1: m.y1 - 7, x2: m.x2 + 7, y2: m.y2 + 7 }) * 12;
      });
      for (const q of lineDots) cost += overlap(box, q) * 3;
      for (const q of leaders) cost += overlap(box, q) * 20;
      const L = leaderOf(p, box);
      if (L) {
        for (const dot of sampleSegment(L.sx, L.sy, L.tx, L.ty, 4)) {
          for (const q of placed) cost += overlap(dot, q) * 20;
          markers.forEach((m, j) => { if (j !== i) cost += overlap(dot, m) * 10; });
        }
      }
      if (!best || cost < best.cost) best = { cost, box, d, L };
    }
    placed.push(best.box);
    if (best.L) leaders.push(...sampleSegment(best.L.sx, best.L.sy, best.L.tx, best.L.ty, 4));
    out[i] = best;
  }
  return out.map((b, i) => {
    const p = points[i];
    const { box } = b;
    let s = "";
    if (!p.text) return { svg: "", box, overlapCost: 0 };
    const L = leaderOf(p, box);
    if (L) s += `<path d="M${n1(L.sx)} ${n1(L.sy)} L${n1(L.tx)} ${n1(L.ty)}" stroke="${p.color}" stroke-width="1" fill="none"/>`;
    s += `<text x="${n1(box.x1 + 1)}" y="${n1(box.y2 - 1 - fs * 0.22)}" font-size="${fs}" fill="${p.color}"${p.bold ? ' font-weight="bold"' : ""} style="${FONT}">${esc(p.text)}</text>`;
    return { svg: s, box, overlapCost: b.cost };
  });
}
function density(points, i) {
  const p = points[i]; let n = 0;
  for (const q of points) if (Math.hypot(q.x - p.x, q.y - p.y) < 70) n += 1;
  return n;
}

// ---- shared pieces ----
function head(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>`;
}
function legendBlock(x, y, extraLines) {
  let s = ""; let lx = x;
  for (const [name, c] of Object.entries(PROVIDER_COLORS)) {
    s += `<circle cx="${lx + 5}" cy="${y - 4}" r="4.5" fill="${c}"/><text x="${lx + 16}" y="${y}" font-size="13" style="${FONT}">${esc(name === "Cascades" ? "Cascades" : name)}</text>`;
    lx += 26 + textWidth(name, 13) + 14;
  }
  s += `<text x="${x}" y="${y + 26}" font-size="12.5" style="${FONT}">Couleur = fournisseur · forme = modèle · pointillé = progression d’effort · étoile = cascade</text>`;
  const shapes = [
    [["circle", "GPT-6 Astra / Opus 5 / Gemini 3.8 Flash / Mistral Small 4 / Muse Spark 1.3"], ["square", "GPT-5.6 Sol / Sonnet 5 / Gemini 4 Argon / Muse Wonder 1.0"]],
    [["triangle", "GPT-5.6 Luna / Sonnet 4.6 / Muse Ember 1.0"], ["cross", "GPT-4.1 / Opus 5.5"], ["star", "cascades CP / CP+ / CP-low / C2 / C3"]]];
  let sy = y + 47;
  for (const line of shapes) {
    lx = x;
    for (const [shape, txt] of line) {
      s += marker(shape, lx + 6, sy, 11, GREY, { hollow: false });
      s += `<text x="${lx + 17}" y="${sy + 4}" font-size="11.5" style="${FONT}">${esc(txt)}</text>`;
      lx += 24 + textWidth(txt, 11.5) + 14;
    }
    sy += 20;
  }
  let ly = sy + 8;
  for (const line of extraLines) { s += `<text x="${x}" y="${ly}" font-size="11.5" fill="${line.color ?? "#555555"}" style="${FONT}">${esc(line.text)}</text>`; ly += 18; }
  return s;
}
function effortLines(pts, X, Y) {
  // pts: rows with id ; dashed polyline per model in effort order
  const byModel = new Map();
  for (const r of pts) {
    if (r.id.provider === "Cascades") continue;
    if (!byModel.has(r.id.model)) byModel.set(r.id.model, []);
    byModel.get(r.id.model).push(r);
  }
  let s = ""; const segs = [];
  for (const list of byModel.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => EFFORTS.indexOf(a.id.effort) - EFFORTS.indexOf(b.id.effort));
    const d = list.map((r, i) => `${i ? "L" : "M"}${n1(X(r))} ${n1(Y(r))}`).join(" ");
    for (let i = 1; i < list.length; i += 1) segs.push([X(list[i - 1]), Y(list[i - 1]), X(list[i]), Y(list[i])]);
    s += `<path d="${d}" fill="none" stroke="${list[0].id.color}" stroke-width="1.1" stroke-dasharray="3.7,1.6" stroke-opacity="0.75"/>`;
  }
  return { svg: s, segs };
}
function axes(ml, mt, iw, ih, xTicks, yTicks, xLabel, yLabel) {
  let s = "";
  for (const t of xTicks) s += `<line x1="${n1(t.x)}" y1="${mt}" x2="${n1(t.x)}" y2="${mt + ih}" stroke="#b0b0b0" stroke-opacity="0.2"/><line x1="${n1(t.x)}" y1="${mt + ih}" x2="${n1(t.x)}" y2="${mt + ih + 4}" stroke="#000"/><text x="${n1(t.x)}" y="${mt + ih + 19}" font-size="12.5" text-anchor="middle" style="${FONT}">${esc(t.label)}</text>`;
  for (const t of yTicks) s += `<line x1="${ml}" y1="${n1(t.y)}" x2="${ml + iw}" y2="${n1(t.y)}" stroke="#b0b0b0" stroke-opacity="0.2"/><line x1="${ml - 4}" y1="${n1(t.y)}" x2="${ml}" y2="${n1(t.y)}" stroke="#000"/><text x="${ml - 8}" y="${n1(t.y + 4.5)}" font-size="12.5" text-anchor="end" style="${FONT}">${esc(t.label)}</text>`;
  s += `<path d="M${ml} ${mt} L${ml} ${mt + ih} L${ml + iw} ${mt + ih}" fill="none" stroke="#000" stroke-width="1"/>`;
  s += `<text x="${ml + iw / 2}" y="${mt + ih + 42}" font-size="13.5" text-anchor="middle" style="${FONT}">${esc(xLabel)}</text>`;
  s += `<text x="20" y="${mt + ih / 2}" font-size="13.5" text-anchor="middle" transform="rotate(-90 20 ${mt + ih / 2})" style="${FONT}">${esc(yLabel)}</text>`;
  return s;
}

// ---- 1. Précision-rappel ----
function precisionRecall(rows) {
  const W = 1440, ml = 78, mr = 30, mt = 30, ih = 760, iw = W - ml - mr;
  const H = mt + ih + 215;
  const xmin = -0.02, xmax = 0.62, ymin = -0.02, ymax = 0.66;
  const X = (r) => ml + ((r.r - xmin) / (xmax - xmin)) * iw;
  const Y = (r) => mt + ih - ((r.p - ymin) / (ymax - ymin)) * ih;
  const pts = rows.filter((r) => r.p !== null && r.p !== undefined);
  let s = head(W, H);
  s += axes(ml, mt, iw, ih, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => ({ x: X({ r: v }), label: v.toFixed(1) })),
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => ({ y: Y({ p: v }), label: v.toFixed(1) })),
    "Rappel strict · TP / 676 unités attendues (100 documents, refus comptés en manqués)", "Précision nette · TP / (TP + FP)");
  for (const f of [0.2, 0.3, 0.4, 0.5]) {
    let d = "";
    for (let r = f / 2 + 0.003; r <= xmax; r += 0.002) { const p = (f * r) / (2 * r - f); if (p > ymax || p < 0) continue; d += `${d ? "L" : "M"}${n1(X({ r }))} ${n1(Y({ p }))} `; }
    const pr = (f * 0.6) / (1.2 - f);
    s += `<path d="${d}" fill="none" stroke="#c8c8c8" stroke-width="0.9"/><text x="${n1(X({ r: 0.6 }))}" y="${n1(Y({ p: pr }) - 4)}" font-size="11" fill="#777777" style="${FONT}">F1 ${String(f).replace(".", ",")}</text>`;
  }
  const el = effortLines(pts, X, Y);
  s += el.svg;
  const drawOrder = [...pts].sort((a, b) => (a.id.shape === "star" ? 0 : 1) - (b.id.shape === "star" ? 0 : 1));
  for (const r of drawOrder) s += marker(r.id.shape, X(r), Y(r), r.id.shape === "star" ? 14 : 12, r.id.color, { hollow: false, v12: r.isV12 });
  const labels = placeLabels(pts.map((r) => ({ x: X(r), y: Y(r), text: r.isV12 ? withV12(r.id.short) : r.id.short, color: r.id.color,
    bold: r.isV12, rad: 7, prio: r.isV12 ? 2 : (r.id.provider === "Cascades" ? 1 : 0) })), { x1: ml + 2, y1: mt + 2, x2: ml + iw - 2, y2: mt + ih - 2 }, 12, el.segs);
  s += labels.map((l) => l.svg).join("");
  s += legendBlock(ml, mt + ih + 76, [
    { text: "Contour noir épais et libellé gras « v12 » : nouveaux bras v12. Courbes grises : même F1. Base : oracle 676, 43 non résolus neutres." },
    { text: "Sonnet 4.6 high : aucune précision calculable (0 accepté), non placé.", color: "#555555" },
  ]);
  return { svg: s + "</svg>", labels };
}

// ---- 2. F1-coût (siège creux → API plein, même bras relié) ----
function f1Cost(rows) {
  const W = 1440, ml = 78, mr = 30, mt = 30, ih = 760, iw = W - ml - mr;
  const H = mt + ih + 235;
  const lo = Math.log10(0.0003), hi = Math.log10(2.0);
  const Xv = (v) => ml + ((Math.log10(v) - lo) / (hi - lo)) * iw;
  const Y = (f) => mt + ih - ((f + 0.03) / 0.60) * ih;
  const pts = rows.filter((r) => r.api !== null && r.api !== undefined && r.api > 0);
  let s = head(W, H);
  const xt = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].map((v) => ({ x: Xv(v), label: String(v).replace(".", ",") }));
  s += axes(ml, mt, iw, ih, xt, [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((v) => ({ y: Y(v), label: v.toFixed(1) })),
    "USD par document · échelle logarithmique (plein = équivalent API ; creux = siège)", "F1 strict · 100 documents, refus comptés en manqués");
  // seat → API links
  const seatSegs = [];
  for (const r of pts) if (r.seat) { seatSegs.push([Xv(r.seat), Y(r.f1), Xv(r.api), Y(r.f1)]); s += `<path d="M${n1(Xv(r.seat))} ${n1(Y(r.f1))} L${n1(Xv(r.api))} ${n1(Y(r.f1))}" stroke="${r.id.color}" stroke-width="1" stroke-opacity="0.45" fill="none"/>`; }
  const el = effortLines(pts, (r) => Xv(r.api), (r) => Y(r.f1));
  s += el.svg;
  for (const r of pts) {
    if (r.seat) s += marker(r.id.shape === "star" ? "star" : r.id.shape, Xv(r.seat), Y(r.f1), r.id.shape === "star" ? 15 : 10, r.id.color, { hollow: true, v12: false })
      .replace(`fill="${r.id.color}"`, 'fill="#ffffff"');
    s += marker(r.id.shape, Xv(r.api), Y(r.f1), r.id.shape === "star" ? 17 : 12, r.id.color, { hollow: false, v12: r.isV12 });
  }
  const frame = { x1: ml + 2, y1: mt + 2, x2: ml + iw - 2, y2: mt + ih - 2 };
  const pointsForLabels = pts.map((r) => ({ x: Xv(r.api), y: Y(r.f1), text: r.isV12 ? withV12(r.id.short) : r.id.short, color: r.id.color,
    bold: r.isV12, rad: 7, prio: r.isV12 ? 2 : (r.id.provider === "Cascades" ? 1 : 0) }));
  // seat markers are obstacles (rad only, no text)
  const seatObstacles = pts.filter((r) => r.seat).map((r) => ({ x: Xv(r.seat), y: Y(r.f1), text: "", color: r.id.color, bold: false, rad: 6, prio: -1 }));
  const labels = placeLabels([...pointsForLabels, ...seatObstacles], frame, 12, [...el.segs, ...seatSegs]).slice(0, pointsForLabels.length);
  s += labels.map((l) => l.svg).join("");
  const missing = rows.filter((r) => !(r.api > 0)).map((r) => r.id.short).join(", ");
  s += legendBlock(ml, mt + ih + 76, [
    { text: "Plein = équivalent API (hypothèse A : sortie rapportée, raisonnement probablement inclus) ; creux = siège projeté ou mesuré ; trait fin horizontal = même bras, siège → API. Sans siège attribuable : point API seul." },
    { text: "Contour noir et libellé gras « v12 » : nouveaux bras. CP et CP+ : coûts cumulés de l’extraction et du filtre. Siège non attribuable : missing source." },
    { text: `Sans équivalent API publié, non placés : ${missing}.` },
  ]);
  return { svg: s + "</svg>", labels };
}

// ---- 3/4. Barres (acceptation, rappel) : couleur = fournisseur, forme = modèle ----
function bars(rows, { title, value, max, fmtRight, dot }) {
  const W = 1300, ml = 450, mr = 150, mt = 40, rowH = 17;
  const ih = rows.length * rowH, iw = W - ml - mr, H = mt + ih + 165;
  let s = head(W, H);
  s += `<text x="${W / 2}" y="24" font-size="15" text-anchor="middle" fill="#123d50" style="${FONT}">${esc(title)}</text>`;
  const X = (v) => ml + (v / max) * iw;
  for (const t of [0, 0.25, 0.5, 0.75, 1].map((k) => k * max)) {
    s += `<line x1="${n1(X(t))}" y1="${mt}" x2="${n1(X(t))}" y2="${mt + ih}" stroke="#b0b0b0" stroke-opacity="0.25"/><text x="${n1(X(t))}" y="${mt + ih + 16}" font-size="11.5" text-anchor="middle" style="${FONT}">${max === 100 ? Math.round(t) : t.toFixed(2)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = mt + i * rowH, v = value(r);
    s += `<text x="${ml - 24}" y="${n1(y + rowH * 0.72)}" font-size="11" text-anchor="end" fill="${r.isV12 ? "#000000" : "#222222"}"${r.isV12 ? ' font-weight="bold"' : ""} style="${FONT}">${esc(r.isV12 ? withV12(r.name ?? r.label) : (r.name ?? r.label))}</text>`;
    s += marker(r.id.shape, ml - 12, y + rowH / 2, r.id.shape === "star" ? 12 : 9, r.id.color, { hollow: false, v12: r.isV12 });
    s += `<rect x="${ml}" y="${n1(y + 2)}" width="${n1(Math.max(0, X(v) - ml))}" height="${rowH - 4}" fill="${r.id.color}" fill-opacity="${r.isV12 ? 1 : 0.78}"${r.isV12 ? ' stroke="#000000" stroke-width="1.6"' : ""}/>`;
    if (dot) s += `<circle cx="${n1(X(dot(r)))}" cy="${n1(y + rowH / 2)}" r="3" fill="#111111"/>`;
    s += `<text x="${n1(dot ? ml + iw + 8 : X(v) + 5)}" y="${n1(y + rowH * 0.72)}" font-size="10.5" style="${FONT}">${esc(fmtRight(r))}</text>`;
  });
  s += `<path d="M${ml} ${mt} L${ml} ${mt + ih}" stroke="#000" stroke-width="1"/>`;
  s += legendBlock(40, mt + ih + 44, [{ text: "Barre à contour noir et libellé gras « v12 » : nouveaux bras v12." }])
    .replace(/Couleur = fournisseur · forme = modèle · pointillé = progression d’effort · étoile = cascade/, "Couleur = fournisseur · forme = modèle · étoile = cascade");
  return s + "</svg>";
}

export function chartsV12(rowsIn) {
  const rows = rowsIn.map((r) => {
    const id = identify(r.label);
    // chart text = full versioned model name (r.name), trailing parenthetical
    // dropped except « coupé » ; cascades keep their short tag (CP actuel, C2...).
    if (r.name && id.provider !== "Cascades") id.short = `${r.name.replace(/\s*\(.*\)\s*$/, "")}${/coupé/.test(r.name) ? " (coupé)" : ""}${/rejeu/.test(r.label) ? " · rejeu" : ""}`;
    return { ...r, id };
  });
  const fr = (v) => (v === null || v === undefined ? "N-A" : v.toFixed(3));
  const pr = precisionRecall(rows);
  const fc = f1Cost(rows);
  const acc = bars([...rows].sort((a, b) => b.accepted - a.accepted), {
    title: "Acceptation sur 100 documents - benchmark v12", value: (r) => r.accepted, max: 100, fmtRight: (r) => `${r.accepted}/100`,
  });
  const rec = bars(rows, {
    title: "Rappel strict trié décroissant - benchmark v12 (F1 en point noir)", value: (r) => r.r, max: 0.6,
    fmtRight: (r) => `R ${fr(r.r)} · F1 ${fr(r.f1)}`, dot: (r) => r.f1,
  });
  const overlaps = (labels) => {
    let n = 0;
    for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) if (overlap(labels[i].box, labels[j].box) > 0) n += 1;
    return n;
  };
  return { precisionRecall: pr.svg, f1Cost: fc.svg, acceptation: acc, recall: rec,
    check: { prLabelOverlaps: overlaps(pr.labels), f1CostLabelOverlaps: overlaps(fc.labels) } };
}

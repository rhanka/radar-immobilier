// Accord inter-juges v100 : corrélations de Pearson et Spearman sur l'utilité 1-5,
// kappa de Cohen sur les notes exactes et sur la binarisation « utile >= 4 ».
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const judgeRoot = resolve(resultRoot, "judge");
const map = JSON.parse(readFileSync(resolve(judgeRoot, "blind-map.json"), "utf8"));
const opus = JSON.parse(readFileSync(resolve(judgeRoot, "opus", "verdicts.json"), "utf8"));
const opusByAlias = new Map(opus.verdicts.map((v) => [v.alias, v]));

const openai = [];
for (const file of readdirSync(resolve(judgeRoot, "openai")).sort()) {
  if (!file.endsWith(".verdict.json")) continue;
  openai.push(JSON.parse(readFileSync(resolve(judgeRoot, "openai", file), "utf8")));
}
const openaiByAlias = new Map(openai.map((record) => [record.alias, record]));

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  const num = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da === 0 || db === 0 ? null : num / (da * db);
}
function ranks(values) {
  const order = values.map((value, index) => ({ value, index }))
    .sort((x, y) => x.value - y.value);
  const result = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) result[order[k].index] = rank;
    i = j + 1;
  }
  return result;
}
const spearman = (a, b) => pearson(ranks(a), ranks(b));

function cohenKappa(a, b, categories) {
  const n = a.length;
  let agree = 0;
  const countA = new Map();
  const countB = new Map();
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) agree += 1;
    countA.set(a[i], (countA.get(a[i]) ?? 0) + 1);
    countB.set(b[i], (countB.get(b[i]) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const category of categories) {
    pe += ((countA.get(category) ?? 0) / n) * ((countB.get(category) ?? 0) / n);
  }
  return { observedAgreement: Number(po.toFixed(4)), expectedAgreement: Number(pe.toFixed(4)),
    kappa: pe === 1 ? null : Number(((po - pe) / (1 - pe)).toFixed(4)) };
}

const rows = [];
for (const entry of map.mapping) {
  const gpt = openaiByAlias.get(entry.alias);
  const own = opusByAlias.get(entry.alias);
  if (!gpt || !own) continue;
  const gptVerdict = gpt.verdict ?? {};
  rows.push({
    alias: entry.alias, documentId: entry.documentId, city: entry.city,
    sizeBucket: entry.sizeBucket, accepted: entry.accepted,
    violationCodes: entry.violationCodes,
    openaiUsefulness: gptVerdict.usefulness ?? null,
    openaiSupported: (gptVerdict.supportedUnitIds ?? []).length,
    openaiMissed: (gptVerdict.missedUnitIds ?? []).length,
    openaiUnits: (gptVerdict.units ?? []).length,
    openaiCitationDefects: (gptVerdict.citationDefects ?? []).length,
    openaiUnsupportedClaims: (gptVerdict.unsupportedClaims ?? []).length,
    opusUsefulness: own.usefulness, opusSupported: own.supported,
    opusMissed: own.missed, opusUnits: own.unitsFound,
    opusCitationDefects: own.citationDefects,
    delta: own.usefulness - (gptVerdict.usefulness ?? Number.NaN),
  });
}

const paired = rows.filter((row) => Number.isInteger(row.openaiUsefulness));
const gptScores = paired.map((row) => row.openaiUsefulness);
const opusScores = paired.map((row) => row.opusUsefulness);
const exact = paired.filter((row) => row.delta === 0).length;
const within1 = paired.filter((row) => Math.abs(row.delta) <= 1).length;
const binary = (score) => (score >= 4 ? "utile" : "a-relire");

const coverageRatio = (supported, units) => (units > 0 ? supported / units : null);
const gptCoverage = paired.map((row) => coverageRatio(row.openaiSupported, row.openaiUnits))
  .filter((value) => value !== null);
const opusCoverage = paired.map((row) => coverageRatio(row.opusSupported, row.opusUnits))
  .filter((value) => value !== null);

const byAcceptance = (accepted) => {
  const subset = paired.filter((row) => row.accepted === accepted);
  return { n: subset.length,
    openaiMean: subset.length ? Number(mean(subset.map((r) => r.openaiUsefulness)).toFixed(2)) : null,
    opusMean: subset.length ? Number(mean(subset.map((r) => r.opusUsefulness)).toFixed(2)) : null };
};

const result = {
  campaign: "v100", generatedAt: new Date().toISOString(),
  judges: { openai: openai[0]?.model ?? null, self: opus.judge },
  paired: paired.length,
  usefulness: {
    openaiMean: Number(mean(gptScores).toFixed(2)),
    selfMean: Number(mean(opusScores).toFixed(2)),
    openaiDistribution: gptScores.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {}),
    selfDistribution: opusScores.reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {}),
  },
  agreement: {
    pearson: Number(pearson(gptScores, opusScores).toFixed(4)),
    spearman: Number(spearman(gptScores, opusScores).toFixed(4)),
    exactAgreement: `${exact}/${paired.length}`,
    within1: `${within1}/${paired.length}`,
    meanAbsoluteDifference: Number(mean(paired.map((r) => Math.abs(r.delta))).toFixed(2)),
    meanSignedDifferenceSelfMinusOpenai: Number(mean(paired.map((r) => r.delta)).toFixed(2)),
    kappaExact: cohenKappa(gptScores, opusScores, [1, 2, 3, 4, 5]),
    kappaBinaryUsefulAtLeast4: cohenKappa(gptScores.map(binary), opusScores.map(binary), ["utile", "a-relire"]),
  },
  coverage: {
    openaiMeanSupportedShare: Number(mean(gptCoverage).toFixed(3)),
    selfMeanSupportedShare: Number(mean(opusCoverage).toFixed(3)),
    openaiUnitsTotal: paired.reduce((a, r) => a + r.openaiUnits, 0),
    openaiSupportedTotal: paired.reduce((a, r) => a + r.openaiSupported, 0),
    selfUnitsTotal: paired.reduce((a, r) => a + r.opusUnits, 0),
    selfSupportedTotal: paired.reduce((a, r) => a + r.opusSupported, 0),
  },
  citationDefects: {
    openaiTotal: paired.reduce((a, r) => a + r.openaiCitationDefects, 0),
    selfTotal: paired.reduce((a, r) => a + r.opusCitationDefects, 0),
    openaiDocumentsWithDefect: paired.filter((r) => r.openaiCitationDefects > 0).length,
    selfDocumentsWithDefect: paired.filter((r) => r.opusCitationDefects > 0).length,
  },
  byValidatorOutcome: { accepted: byAcceptance(true), refused: byAcceptance(false) },
  rows,
};
writeFileSync(resolve(judgeRoot, "agreement.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));

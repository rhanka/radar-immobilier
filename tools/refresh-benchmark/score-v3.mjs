import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const normalized = (value) => value.normalize("NFC").toLocaleLowerCase("fr-CA")
  .replace(/\s+/g, " ").trim();
const metric = (numerator, denominator) => denominator ? numerator / denominator : null;

export function classifyReceipt(receipt) {
  if (!receipt) return "not_launched";
  if (receipt.status === "completed" && receipt.extractionAccepted) return "completed_valid";
  if (receipt.actual) return "completed_invalid";
  return "transport_failed";
}

export function scoreValid(output, document, gold) {
  const eligible = output.nodes.filter(({ node_type: type }) =>
    type === "Signal" || type === "DesignationEvent");
  const byId = new Map(eligible.map((node, index) => [node.id, index]));
  const parent = eligible.map((_, index) => index);
  const root = (index) => parent[index] === index ? index : (parent[index] = root(parent[index]));
  for (const edge of output.edges ?? []) {
    if (edge.relation !== "generates" || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    const a = root(byId.get(edge.source));
    const b = root(byId.get(edge.target));
    parent[b] = a;
  }
  const groups = new Map();
  eligible.forEach((node, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  });
  const evidence = new Map((output.evidence ?? []).map((item) => [item.id, item]));
  const matches = [];
  let unmatchedGroups = 0;
  for (const nodes of groups.values()) {
    const stages = new Set(nodes.flatMap((node) => [node.etape, node.stage, node.stade]).filter(Boolean));
    const records = nodes.flatMap((node) => [
      ...(node.citations ?? []),
      ...(node.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean),
    ]).filter((record) => record.source_file === document.originalKey
      && record.rawRef === document.originalKey && record.docSha === document.sha256
      && record.sourceUrl === document.sourceUrl && record.modality === "pdf");
    const groupMatches = gold.filter((unit) => stages.has(unit.stage) && records.some((record) =>
      record.page === unit.page && normalized(record.excerpt).includes(normalized(unit.anchor))));
    if (groupMatches.length === 0) unmatchedGroups += 1;
    matches.push(...groupMatches.map(({ id }) => id));
  }
  const matchedIds = [...new Set(matches)];
  const duplicates = matches.length - matchedIds.length;
  const tp = matchedIds.length;
  const fn = gold.length - tp;
  const partialOracle = document.id === "waterloo-2026-08-18";
  const fp = partialOracle ? null : unmatchedGroups + duplicates;
  return { oracleUnits: gold.length, candidateGroups: groups.size, matchedIds,
    tp, fp, fn, precision: partialOracle ? null : metric(tp, tp + fp), recall: metric(tp, gold.length),
    f1: partialOracle || !(2 * tp + fp + fn) ? null : 2 * tp / (2 * tp + fp + fn),
    partialOracle, unmatchedGroups, duplicateMatches: duplicates };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.env.BENCHMARK_SCORE_OUTPUT) {
  const rootPath = process.env.BENCHMARK_SCORE_ROOT;
  const manifest = await readJson(resolve(rootPath, "manifest.json"));
  const oracle = await readJson(resolve(rootPath, "manual-oracle.json"));
  const cases = [];
  for (const document of manifest.documents) {
    const stem = `${document.id}--sol-normal`;
    let receipt;
    try { receipt = await readJson(resolve(rootPath, "candidates", `${stem}.receipt.json`)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const state = classifyReceipt(receipt);
    let quality = null;
    if (state === "completed_valid") {
      const output = await readJson(resolve(rootPath, "candidates", `${stem}.output.json`));
      quality = scoreValid(output, document, oracle.units.filter((unit) => unit.doc_sha === document.sha256));
    }
    cases.push({ caseId: stem, state, receipt: receipt ? { status: receipt.status,
      extractionAccepted: receipt.extractionAccepted, requested: receipt.requested,
      actual: receipt.actual && { modelId: receipt.actual.modelId, usage: receipt.actual.usage },
      timing: receipt.timing, error: receipt.error } : null, quality });
  }
  const result = { schemaVersion: 1, metric: "exact frozen anchor + exact stage after v3 provenance gates",
    generatedAt: new Date().toISOString(), cases };
  await writeFile(process.env.BENCHMARK_SCORE_OUTPUT, JSON.stringify(result), { flag: "wx" });
  console.log(JSON.stringify(result));
}

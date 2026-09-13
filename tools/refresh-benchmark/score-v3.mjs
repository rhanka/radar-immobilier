import { createHash } from "node:crypto";
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
  const evidence = new Map((output.evidence ?? []).map((item) => [item.id, item]));
  const matches = eligible.map((node) => {
    const properties = node.properties ?? node;
    const stages = new Set([properties.etape, properties.stage, properties.stade].filter(Boolean));
    const records = [
      ...(node.citations ?? []),
      ...(node.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean),
    ].filter((record) => record.source_file === document.originalKey
      && record.rawRef === document.originalKey && record.docSha === document.sha256
      && record.sourceUrl === document.sourceUrl && record.modality === "pdf");
    return gold.filter((unit) => {
      const exactAnchors = [unit.anchor,
        ...(unit.city === "valcourt--le-val-saint-francois"
          ? [unit.anchor.replace(/^\d+(?:\.\d+)?\s+/, "")] : [])];
      return stages.has(unit.stage) && records.some((record) => record.page === unit.page
        && exactAnchors.some((anchor) => normalized(record.excerpt).includes(normalized(anchor))));
    }).map(({ id }) => id);
  });
  const matchedIds = [...new Set(matches.flat())];
  const matchedTypedNodes = matches.filter((ids) => ids.length > 0).length;
  const partialOracle = document.id === "waterloo-2026-08-18";
  const unmatchedTypedNodes = partialOracle ? null : eligible.length - matchedTypedNodes;
  const raisesSignalRelations = (output.edges ?? []).filter(({ relation }) => relation === "raises_signal").length;
  return { oracleUnits: gold.length, typedNodes: eligible.length, matchedTypedNodes,
    unmatchedTypedNodes, nodePrecision: partialOracle ? null : metric(matchedTypedNodes, eligible.length),
    matchedIds, missedIds: gold.filter(({ id }) => !matchedIds.includes(id)).map(({ id }) => id),
    oracleRecall: metric(matchedIds.length, gold.length), partialOracle, raisesSignalRelations };
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
    const receipts = [];
    for (const suffix of ["", ".attempt-2"]) {
      try { receipts.push(await readJson(resolve(rootPath, "candidates", `${stem}${suffix}.receipt.json`))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const receipt = receipts.at(-1);
    const state = classifyReceipt(receipt);
    let quality = null;
    let outputFileSha256 = null;
    if (state === "completed_valid") {
      const suffix = receipt.attemptNumber > 1 ? `.attempt-${receipt.attemptNumber}` : "";
      const outputPath = resolve(rootPath, "candidates", `${stem}${suffix}.output.json`);
      const outputBytes = await readFile(outputPath);
      outputFileSha256 = createHash("sha256").update(outputBytes).digest("hex");
      const output = JSON.parse(outputBytes);
      quality = scoreValid(output, document, oracle.units.filter((unit) => unit.doc_sha === document.sha256));
    }
    cases.push({ caseId: stem, state, attemptCount: receipts.length, receipt: receipt ? { status: receipt.status,
      extractionAccepted: receipt.extractionAccepted, requested: receipt.requested,
      actual: receipt.actual && { modelId: receipt.actual.modelId, usage: receipt.actual.usage },
      wire: receipt.wire, timing: receipt.timing, error: receipt.error } : null,
      responseTextSha256: receipt?.actual?.responseTextSha256 ?? null, outputFileSha256, quality });
  }
  const result = { schemaVersion: 1, metric: "exact frozen anchor + exact stage after v3 provenance gates",
    generatedAt: new Date().toISOString(), cases };
  await writeFile(process.env.BENCHMARK_SCORE_OUTPUT, JSON.stringify(result), { flag: "wx" });
  console.log(JSON.stringify(result));
}

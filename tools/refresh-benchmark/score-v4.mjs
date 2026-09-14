import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { classifyReceipt, scoreValid } from "./score-v3.mjs";

const normalize = (value) => String(value ?? "").normalize("NFC").toLocaleLowerCase("fr-CA")
  .replace(/\s+/g, " ").trim();
const ratio = (a, b) => b ? a / b : null;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function scoreLegacy(findings, document, gold) {
  const matchedIds = [...new Set(gold.filter((unit) => findings.some((finding) =>
    finding.page === unit.page && finding.etape === unit.stage
      && normalize(finding.citation).includes(normalize(unit.anchor)))).map(({ id }) => id))];
  const matchedFindings = findings.filter((finding) => gold.some((unit) =>
    finding.page === unit.page && finding.etape === unit.stage
      && normalize(finding.citation).includes(normalize(unit.anchor)))).length;
  const tp = matchedIds.length;
  const fp = document.id === "waterloo-2026-08-18" ? null : findings.length - matchedFindings;
  return { oracleUnits: gold.length, findings: findings.length, matchedIds, tp, fp,
    fn: gold.length - tp, precision: fp === null ? null : ratio(tp, tp + fp),
    recall: ratio(tp, gold.length), partialOracle: fp === null };
}

export function citationHealth(output, document, pages) {
  const records = [...(output.nodes ?? []), ...(output.edges ?? [])]
    .flatMap(({ citations }) => citations ?? []).concat(output.evidence ?? []);
  const exact = (record) => record.source_file === document.originalKey
    && record.rawRef === document.originalKey && record.docSha === document.sha256
    && record.sourceUrl === document.sourceUrl && record.modality === "pdf";
  const onPage = (record) => Number.isInteger(record.page) && record.page > 0
    && record.page <= document.pageCount;
  return { records: records.length, exactIdentity: records.filter(exact).length,
    physicalPage: records.filter(onPage).length,
    verbatimExcerpt: records.filter((record) => onPage(record) && record.excerpt
      && normalize(pages[record.page - 1]).includes(normalize(record.excerpt))).length };
}

if (process.env.BENCHMARK_SCORE_OUTPUT) {
  const repositoryRoot = process.env.BENCHMARK_REPOSITORY_ROOT;
  const resultRoot = process.env.BENCHMARK_SCORE_ROOT;
  const manifest = await readJson(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v3/manifest.json"));
  const oracle = await readJson(resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v3/manual-oracle.json"));
  const cases = [];
  for (const document of manifest.documents) {
    const gold = oracle.units.filter(({ doc_sha: digest }) => digest === document.sha256);
    const text = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
    const pages = text.split("\f"); if (pages.at(-1) === "") pages.pop();
    const baselinePath = resolve(manifest.sourceRunRoot, "workers", document.city, "findings",
      `${document.sha256}.1.json`);
    const wrapper = await readJson(resolve(manifest.sourceRunRoot, "workers", document.city, "findings",
      `${document.sha256}.wrapper.json`));
    const baselineBytes = await readFile(baselinePath); const baseline = JSON.parse(baselineBytes);
    cases.push({ documentId: document.id, system: "historical-sonnet-4.6", state: "completed_legacy",
      timingMs: wrapper.duration_ms, outputSha256: sha256(baselineBytes),
      usage: { modelUsage: wrapper.modelUsage, totalCostUSD: wrapper.total_cost_usd },
      quality: scoreLegacy(baseline.findings, document, gold),
      citations: { records: baseline.findings.length,
        physicalPage: baseline.findings.filter(({ page }) => Number.isInteger(page)).length,
        verbatimExcerpt: baseline.findings.filter(({ page, citation }) => Number.isInteger(page)
          && normalize(pages[page - 1]).includes(normalize(citation))).length,
        exactIdentity: null } });
    for (const variant of ["luna-low", "gemini-low"]) {
      const stem = `${document.id}--${variant}`;
      const receipt = await readJson(resolve(resultRoot, "candidates", `${stem}.receipt.json`));
      let output; let outputSha256 = null;
      try { const bytes = await readFile(resolve(resultRoot, "candidates", `${stem}.output.json`));
        output = JSON.parse(bytes); outputSha256 = sha256(bytes); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      cases.push({ documentId: document.id, system: variant, state: classifyReceipt(receipt),
        timingMs: receipt.timing.totalMs, requested: receipt.requested, wire: receipt.wire,
        usage: receipt.actual?.usage ?? null, error: receipt.error ?? null, outputSha256,
        quality: output ? scoreValid(output, document, gold) : null,
        citations: output ? citationHealth(output, document, pages) : null });
    }
  }
  const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), cases };
  await writeFile(process.env.BENCHMARK_SCORE_OUTPUT, JSON.stringify(summary), { flag: "wx" });
  console.log(JSON.stringify({ cases: cases.length }));
}

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const root = required("BENCHMARK_REPOSITORY_ROOT");
const casRoot = required("BENCHMARK_CAS_ROOT");
const outputDir = required("BENCHMARK_OUTPUT_DIR");
const campaign = process.env.BENCHMARK_CAMPAIGN ?? "v3";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rows = [
  ["lac-des-seize-iles-2026-09-agenda", "lac-des-seize-iles", "2026-09", "proces-verbaux-lac-des-seize-iles", "6bfd190a0aff3ea2679edf5bdf7e727161d24052ce08c0c385427b0ec3c07a96", "Manual 4-unit future agenda control; agenda is not adoption."],
  ["saint-etienne-de-bolton-2026-08-04", "saint-etienne-de-bolton", "2026-08-04", "proces-verbaux-saint-etienne-de-bolton", "27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d", "Manual 17-unit mixed adoption, PIIA and explicit-refusal control."],
  ["valcourt-2026-06-01-agenda", "valcourt--le-val-saint-francois", "2026-06-01", "proces-verbaux-valcourt--le-val-saint-francois", "31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d", "Manual 6-unit agenda control; planned PIIA is not adoption."],
  ["saint-barthelemy-2026-09-08", "saint-barthelemy", "2026-09-08", "proces-verbaux-saint-barthelemy", "ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845", "Manual 8-unit motion, first-project and property-event control."],
  ["waterloo-2026-08-18", "waterloo", "2026-08-18", "proces-verbaux-waterloo", "c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd", "Manual page-3 adoption control; reject page 1 and invented force or units."],
];
const documents = [];
for (const [id, city, date, sourceId, digest, selectionRationale] of rows) {
  const pdfPath = resolve(casRoot, "workers", city, "corpus", `${digest}.pdf`);
  const pdf = await readFile(pdfPath);
  const meta = JSON.parse(await readFile(`${pdfPath}.meta.json`, "utf8"));
  const runtimeTextRelativePath = `scratchtmp/refresh-benchmark/runtime-text/${digest}.txt`;
  const text = await readFile(resolve(root, runtimeTextRelativePath), "utf8");
  const pages = text.split("\f").map((page) => page.replace(/\r\n/g, "\n"));
  if (pages.at(-1) === "") pages.pop();
  if (sha256(pdf) !== digest || meta.sha256 !== digest) throw new Error(`PDF mismatch: ${id}`);
  documents.push({ id, city, date, sourceId,
    originalKey: `raw/${sourceId}/cas/${digest}.pdf`, runtimeTextRelativePath,
    sourceUrl: meta.sourceUrl, sha256: digest, bytes: pdf.length, pageCount: pages.length,
    textSha256: sha256(text), pageTextSha256: pages.map(sha256), selectionRationale });
}
const manifest = { schemaVersion: 2, campaign, frozenAt: new Date().toISOString(),
  sourceRun: "run-dryrun2-final-20260911T215911Z", sourceRunRoot: casRoot,
  parser: "pdftotext -q -enc UTF-8 <pdf> <text>", documents };
const baselineBytes = await readFile(required("BENCHMARK_BASELINE_GOLD"));
const baseline = JSON.parse(baselineBytes);
const waterloo = JSON.parse(await readFile(resolve(required("BENCHMARK_T1_ROOT"),
  "api/tests/fixtures/refresh-018/oracle.json"), "utf8"));
const gold = baseline.gold.filter(({ city }) => city !== "warden");
gold.push({ city: "waterloo", id: "W001", label: `Adoption ${waterloo.bylawNumber}`,
  stage: waterloo.stage, citation: waterloo.excerpt, anchor: waterloo.excerpt,
  page: waterloo.page, doc_sha: waterloo.docSha, sourceUrl: waterloo.sourceUrl });
const oracle = { schemaVersion: 1, frozenAt: new Date().toISOString(), units: gold,
  lineage: { sourceGoldSha256: sha256(baselineBytes), excludedCity: "warden",
    waterlooDocSha256: waterloo.docSha }, rules: baseline.rules };
if (gold.length !== 36) throw new Error(`Expected 36 manual units, found ${gold.length}`);
await writeFile(resolve(outputDir, "manifest.json"), JSON.stringify(manifest), { flag: "wx" });
await writeFile(resolve(outputDir, "manual-oracle.json"), JSON.stringify(oracle), { flag: "wx" });
console.log(JSON.stringify({ documents: documents.length, manualUnits: gold.length,
  manifestSha256: sha256(JSON.stringify(manifest)), oracleSha256: sha256(JSON.stringify(oracle)) }));

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const t1Root = required("BENCHMARK_T1_ROOT");
const v100Root = resolve(repositoryRoot, "docs/reviews/refresh-benchmark/v100");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(v100Root, "manifest.json"), "utf8"));
const aggregate = JSON.parse(await readFile(resolve(v100Root, "aggregate.json"), "utf8"));
const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(
  resolve(t1Root, "api/src/services/graph/refresh-profile.ts")));
const { materializeRefreshCorpus } = await import(pathToFileURL(
  resolve(t1Root, "api/src/services/graph/refresh-corpus.ts")));
const context = loadRefreshProfileContext({ root: t1Root,
  profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
const evidenceNodeTypes = new Set(context.profile.evidence_policy.node_types);

function discardDirect(extraction, path) {
  let match = /^(nodes|edges|evidence)\[(\d+)]$/.exec(path);
  if (match) {
    const [record] = extraction[match[1]].splice(Number(match[2]), 1);
    return { kind: { nodes: "node", edges: "edge", evidence: "evidence" }[match[1]],
      id: record?.id ?? null };
  }
  match = /^(nodes|edges)\[(\d+)]\.citations\[(\d+)]$/.exec(path);
  if (!match) throw new Error(`C-prime target is not localizable: ${path}`);
  const entity = extraction[match[1]][Number(match[2])];
  if (!entity) throw new Error(`C-prime entity is absent: ${path}`);
  const [record] = entity.citations.splice(Number(match[3]), 1);
  return { kind: "citation", parentKind: match[1].slice(0, -1),
    parentId: entity.id ?? null, excerptSha256: sha256(record?.excerpt ?? "") };
}

function cascade(extraction) {
  const dropped = [];
  for (;;) {
    const evidenceIds = new Set((extraction.evidence ?? []).map(({ id }) => id));
    for (const entity of [...extraction.nodes, ...extraction.edges]) {
      if (Array.isArray(entity.evidence_refs)) {
        entity.evidence_refs = entity.evidence_refs.filter((id) => evidenceIds.has(id));
      }
    }
    const nodeIds = new Set(extraction.nodes.map(({ id }) => id));
    const badNode = extraction.nodes.findIndex((node) => !node.citations?.length
      || (evidenceNodeTypes.has(node.node_type) && !node.evidence_refs?.length));
    if (badNode >= 0) {
      const [record] = extraction.nodes.splice(badNode, 1);
      dropped.push({ kind: "node", id: record.id, cause: "empty-required-support" });
      continue;
    }
    const badEdge = extraction.edges.findIndex((edge) => !edge.citations?.length
      || !edge.evidence_refs?.length || !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
    if (badEdge >= 0) {
      const [record] = extraction.edges.splice(badEdge, 1);
      dropped.push({ kind: "edge", source: record.source, target: record.target,
        relation: record.relation, cause: "empty-or-dangling-support" });
      continue;
    }
    return dropped;
  }
}

async function exactV9Validation(document, extraction) {
  const workerRoot = resolve(manifest.sourceRunRoot, "workers", document.city);
  const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
  const pdf = await readFile(pdfPath);
  const parsedText = await readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8");
  if (sha256(pdf) !== document.sha256 || sha256(parsedText) !== document.textSha256) {
    throw new Error(`Frozen input hash mismatch: ${document.id}`);
  }
  const manifestKey = "refresh-benchmark-input.tsv";
  const tsv = `source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key\n${document.sourceId}\t${
    document.city}\t${document.sha256}\t${document.originalKey}\t${document.originalKey}.meta.json\n`;
  const reader = { async get(key) {
    if (key === manifestKey) return Buffer.from(tsv);
    if (key === document.originalKey) return pdf;
    if (key === `${document.originalKey}.meta.json`) return readFile(`${pdfPath}.meta.json`);
    throw new Error(`Unexpected input key: ${key}`);
  } };
  const corpus = await materializeRefreshCorpus({ citySlug: document.city, manifestKey, reader,
    extractPdf: async () => parsedText });
  const client = { mode: "offline", provider: "recorded", model: "v100-cprime",
    async generateJson(input) {
      const serialized = JSON.stringify(extraction);
      input.validateResponse(serialized);
      await mkdir(dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, serialized, "utf8");
      return { status: "completed", provider: "recorded", mode: "offline",
        outputPath: input.outputPath, audit: { offlineRequalification: true } };
    } };
  await extractRefreshProfile(corpus.chunks, { textClient: client, context,
    maxOutputTokens: 64_000 });
}

const byId = new Map(manifest.documents.map((document) => [document.id, document]));
const results = [];
for (const summary of aggregate.documents.filter(({ accepted }) => !accepted)) {
  const document = byId.get(summary.id);
  const stem = `${summary.id}--gemini-low`;
  const receiptBytes = await readFile(resolve(v100Root, "campaign-gemini", `${stem}.receipt.json`));
  const receipt = JSON.parse(receiptBytes);
  const violations = [...receipt.validation.profileViolations.filter((issue) => issue.severity === "error"),
    ...receipt.validation.provenanceViolations];
  if (violations.length !== 1) {
    results.push({ documentId: summary.id, eligible: false, strictAccepted: false,
      violationCount: violations.length, cPrimeAccepted: false });
    continue;
  }
  const outputBytes = await readFile(resolve(v100Root, "campaign-gemini", `${stem}.output.json`));
  const extraction = structuredClone(JSON.parse(outputBytes));
  const directDropped = discardDirect(extraction, violations[0].path);
  const cascadeDropped = cascade(extraction);
  let cPrimeAccepted = true;
  let validationError = null;
  try { await exactV9Validation(document, extraction); }
  catch (error) { cPrimeAccepted = false; validationError = String(error.message).slice(0, 300); }
  results.push({ documentId: summary.id, eligible: true, strictAccepted: false,
    violation: { code: violations[0].code, path: violations[0].path }, directDropped,
    cascadeDropped, cPrimeAccepted, validationError,
    sourceReceiptSha256: sha256(receiptBytes), sourceOutputSha256: sha256(outputBytes) });
}
const requalified = results.filter(({ cPrimeAccepted }) => cPrimeAccepted).length;
const measured = { schemaVersion: 1, measuredAt: new Date().toISOString(), sourceCampaign: "v100",
  contract: { version: "immo-pv-extraction-v9",
    implementationCommit: "93994e454a91031dcbbd49b8590fdd45b47a6cd4" },
  policy: "discard-one-direct-record-then-referential-cleanup-to-fixed-point-and-full-v9-validation",
  strict: { accepted: aggregate.acceptance.accepted, total: aggregate.corpus.documents },
  cPrime: { accepted: aggregate.acceptance.accepted + requalified,
    total: aggregate.corpus.documents, directCandidates: results.filter(({ eligible }) => eligible).length,
    requalified, stillRejected: results.length - requalified }, results };
await writeFile(resolve(resultRoot, "cprime-baseline.json"), `${JSON.stringify(measured)}\n`,
  { flag: "wx" });
console.log(JSON.stringify({ strict: measured.strict, cPrime: measured.cPrime }));

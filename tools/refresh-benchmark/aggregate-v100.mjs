// Agrégation de la campagne v100 : acceptation, classes de refus avec exemples réels,
// latences, tokens, fins SSE, citations. Lit les reçus requalifiés, n'appelle rien.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`); })();
const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
const resultRoot = required("BENCHMARK_RESULT_ROOT");
const variant = process.env.BENCHMARK_VARIANT ?? "gemini-low";
const manifest = JSON.parse(readFileSync(resolve(resultRoot, "manifest.json"), "utf8"));
const campaignRoot = resolve(resultRoot, "campaign-gemini");

const quantile = (sorted, p) => (sorted.length === 0 ? null
  : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]);
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, mean: null, p50: null, p95: null, max: null, min: null };
  return { n: sorted.length,
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95),
    min: sorted[0], max: sorted.at(-1) };
};

function citationAt(output, path) {
  const entity = path.match(/^(nodes|edges)\[(\d+)\]\.citations\[(\d+)\]$/u);
  if (entity) return output?.[entity[1]]?.[Number(entity[2])]?.citations?.[Number(entity[3])] ?? null;
  const evidence = path.match(/^evidence\[(\d+)\]$/u);
  if (evidence) return output?.evidence?.[Number(evidence[1])] ?? null;
  return null;
}

const documents = [];
const refusalClasses = new Map();
for (const document of manifest.documents) {
  const stem = `${document.id}--${variant}`;
  const receiptPath = resolve(campaignRoot, `${stem}.receipt.json`);
  if (!existsSync(receiptPath)) {
    documents.push({ id: document.id, city: document.city, state: "not_launched" });
    continue;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const outputPath = resolve(campaignRoot, `${stem}.output.json`);
  const output = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : null;
  const validation = receipt.validation ?? {};
  const violations = [
    ...(validation.contractVersionViolations ?? []),
    ...(validation.extractionViolations ?? []),
    ...(validation.profileViolations ?? []),
    ...(validation.provenanceViolations ?? []),
  ];
  const accepted = validation.accepted === true;
  const layerFailed = !receipt.actual ? "transport"
    : validation.jsonValidAfterNormalize === false ? "json"
      : (validation.extractionViolations ?? []).length > 0 ? "extraction"
        : validation.profileValid === false ? "profil"
          : validation.provenanceValid === false ? "provenance" : null;

  const entityCitations = [...(output?.nodes ?? []), ...(output?.edges ?? [])]
    .flatMap((entity) => entity?.citations ?? []);
  for (const violation of violations) {
    const key = violation.code ?? "unknown";
    const bucket = refusalClasses.get(key) ?? { code: key, occurrences: 0, documents: new Set(), examples: [] };
    bucket.occurrences += 1;
    bucket.documents.add(document.id);
    if (bucket.examples.length < 3 && !bucket.examples.some((e) => e.documentId === document.id)) {
      const citation = citationAt(output, violation.path ?? "");
      bucket.examples.push({ documentId: document.id, city: document.city, path: violation.path ?? null,
        page: citation?.page ?? null,
        excerpt: typeof citation?.excerpt === "string" ? citation.excerpt.slice(0, 200) : null,
        normalizedCodePoints: violation.normalizedCodePoints ?? null,
        message: violation.message ?? null });
    }
    refusalClasses.set(key, bucket);
  }

  documents.push({
    id: document.id, city: document.city, date: document.date, sizeBucket: document.sizeBucket,
    pageCount: document.pageCount, approxInputTokens: document.approxInputTokens,
    status: receipt.status, accepted, layerFailed,
    httpStatus: receipt.wire?.httpStatus ?? null,
    finishReason: receipt.actual?.finishReason ?? null,
    sseFinishReason: receipt.wire?.terminalSse?.lastData?.finishReason ?? null,
    sseDataEvents: receipt.wire?.terminalSse?.dataEventCount ?? null,
    inputTokens: receipt.actual?.usage?.inputTokens ?? null,
    outputTokens: receipt.actual?.usage?.outputTokens ?? null,
    totalMs: receipt.timing?.totalMs ?? null, runMs: receipt.timing?.runMs ?? null,
    nodes: output?.nodes?.length ?? null, edges: output?.edges?.length ?? null,
    entityCitations: entityCitations.length,
    evidenceItems: output?.evidence?.length ?? null,
    truncatedEntityCitationExcerpts: validation.truncatedEntityCitationExcerpts ?? null,
    violationCodes: [...new Set(violations.map((v) => v.code))],
    violationCount: violations.length,
    wrapperNormalized: validation.wrapperNormalized ?? null,
    jsonValidRaw: validation.jsonValidRaw ?? null,
  });
}

const launched = documents.filter((d) => d.state !== "not_launched");
const accepted = launched.filter((d) => d.accepted);
const byGroup = (key) => {
  const groups = new Map();
  for (const d of launched) {
    const g = groups.get(d[key]) ?? { total: 0, accepted: 0 };
    g.total += 1;
    if (d.accepted) g.accepted += 1;
    groups.set(d[key], g);
  }
  return Object.fromEntries([...groups.entries()].map(([k, v]) => [k,
    { ...v, rate: Number((v.accepted / v.total).toFixed(3)) }]));
};
const pageBand = (n) => (n <= 3 ? "1-3" : n <= 8 ? "4-8" : n <= 15 ? "9-15" : n <= 25 ? "16-25" : "26+");
for (const d of launched) d.pageBand = pageBand(d.pageCount ?? 0);

const sumOf = (key) => launched.reduce((a, d) => a + (d[key] ?? 0), 0);
const result = {
  campaign: "v100", variant, generatedAt: new Date().toISOString(),
  corpus: { documents: manifest.documents.length,
    cities: new Set(manifest.documents.map((d) => d.city)).size,
    launched: launched.length, notLaunched: manifest.documents.length - launched.length },
  acceptance: { accepted: accepted.length, launched: launched.length,
    rate: Number((accepted.length / launched.length).toFixed(4)) },
  acceptanceBySizeBucket: byGroup("sizeBucket"),
  acceptanceByPageBand: byGroup("pageBand"),
  layers: {
    transportOk: launched.filter((d) => d.httpStatus === 200).length,
    jsonValidRaw: launched.filter((d) => d.jsonValidRaw === true).length,
    wrapperNormalized: launched.filter((d) => d.wrapperNormalized === true).length,
    failedAtLayer: launched.reduce((acc, d) => (d.layerFailed
      ? { ...acc, [d.layerFailed]: (acc[d.layerFailed] ?? 0) + 1 } : acc), {}),
  },
  refusalClasses: [...refusalClasses.values()].map((bucket) => ({
    code: bucket.code, occurrences: bucket.occurrences, documents: bucket.documents.size,
    documentIds: [...bucket.documents], examples: bucket.examples,
  })).sort((a, b) => b.documents - a.documents || b.occurrences - a.occurrences),
  latencyMsTotal: stats(launched.map((d) => d.totalMs).filter((v) => v !== null)),
  latencyMsAccepted: stats(accepted.map((d) => d.totalMs).filter((v) => v !== null)),
  tokens: { inputTotal: sumOf("inputTokens"), outputTotal: sumOf("outputTokens"),
    input: stats(launched.map((d) => d.inputTokens).filter((v) => v !== null)),
    output: stats(launched.map((d) => d.outputTokens).filter((v) => v !== null)) },
  sseFinishReasons: launched.reduce((acc, d) => ({ ...acc,
    [d.sseFinishReason ?? "none"]: (acc[d.sseFinishReason ?? "none"] ?? 0) + 1 }), {}),
  providerFinishReasons: launched.reduce((acc, d) => ({ ...acc,
    [d.finishReason ?? "none"]: (acc[d.finishReason ?? "none"] ?? 0) + 1 }), {}),
  citations: { entityCitationsTotal: sumOf("entityCitations"),
    evidenceItemsTotal: sumOf("evidenceItems"),
    truncatedEntityCitationExcerptsTotal: sumOf("truncatedEntityCitationExcerpts"),
    citationViolationsTotal: launched.reduce((a, d) => a + d.violationCount, 0) },
  graph: { nodesTotal: sumOf("nodes"), edgesTotal: sumOf("edges") },
  documents,
};
const outputPath = resolve(resultRoot, "aggregate.json");
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, documents: undefined,
  refusalClasses: result.refusalClasses.map((r) => ({ code: r.code, documents: r.documents, occurrences: r.occurrences })) }, null, 2));
void repositoryRoot;

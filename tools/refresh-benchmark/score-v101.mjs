import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { arms } from "./v101-arms.mjs";
import { resumeDecision } from "./v101-runner-state.mjs";
import { cascade, discardDirect, normalizeExtraction, parseExtraction,
  provenanceViolations } from "./v101-score-lib.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const CAMPAIGN = process.env.BENCHMARK_CAMPAIGN ?? "v101";
const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();

export async function scoreArm(armName) {
  if (!arms[armName]) throw new Error(`Unknown ${CAMPAIGN} arm: ${armName}`);
  const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
  const resultRoot = required("BENCHMARK_RESULT_ROOT");
  const t1Root = required("BENCHMARK_T1_ROOT");
  const campaignRoot = resolve(resultRoot, "campaign", armName);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
    `docs/reviews/refresh-benchmark/${CAMPAIGN}/manifest.json`), "utf8"));
  const profilePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
  const corpusPath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
  const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(profilePath));
  const { materializeRefreshCorpus } = await import(pathToFileURL(corpusPath));
  const { validateExtraction, validateProfileExtraction } = await import(
    "/workspace/node_modules/@sentropic/graphify/dist/index.js");
  const context = loadRefreshProfileContext({ root: t1Root,
    profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
  const evidenceNodeTypes = new Set(context.profile.evidence_policy.node_types);

  async function documentMaterial(document) {
    const sourceRunRoot = resolve(repositoryRoot, manifest.corpus.sourceRunRelativePath);
    const workerRoot = resolve(sourceRunRoot, "workers", document.city);
    const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
    const [pdf, text] = await Promise.all([readFile(pdfPath),
      readFile(resolve(repositoryRoot, document.runtimeTextRelativePath), "utf8")]);
    if (sha256(pdf) !== document.sha256 || sha256(text) !== document.textSha256) {
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
      extractPdf: async () => text });
    const pages = text.split("\f"); if (pages.at(-1) === "") pages.pop();
    return { corpus, pages };
  }

  async function exactV9(document, extraction, corpus) {
    const client = { mode: "offline", provider: "recorded", model: armName,
      async generateJson(input) {
        const serialized = JSON.stringify(extraction);
        input.validateResponse(serialized);
        await mkdir(dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, serialized);
        return { status: "completed", provider: "recorded", mode: "offline",
          outputPath: input.outputPath, audit: { offlineV101: true } };
      } };
    await extractRefreshProfile(corpus.chunks, { textClient: client, context,
      maxOutputTokens: 32_768 });
  }

  function inspect(extraction, document, pages) {
    const contractViolation = normalizeExtraction(extraction, document);
    const base = validateExtraction(extraction);
    const profile = base.length === 0 ? validateProfileExtraction(extraction,
      { profile: context.profile, registryExtraction: context.registryExtraction }) : null;
    const profileErrors = (profile?.issues ?? []).filter(({ severity }) => severity === "error");
    const provenance = profile?.valid ? provenanceViolations(extraction, document, pages) : [];
    const accepted = !contractViolation && base.length === 0 && Boolean(profile?.valid)
      && provenance.length === 0;
    return { accepted, contractViolation, base, profileErrors, provenance,
      directViolations: [...profileErrors, ...provenance] };
  }

  const documents = [];
  for (const document of manifest.documents) {
    const decision = await resumeDecision(campaignRoot, document.id, armName);
    if (decision.action !== "skip") { documents.push({ documentId: document.id,
      state: "not-terminal", strictAccepted: null, cPrimeAccepted: null }); continue; }
    const receipt = decision.receipt;
    if (!receipt.actual || !receipt.artifacts?.raw) {
      documents.push({ documentId: document.id, state: "transport-failed",
        strictAccepted: false, cPrimeAccepted: false }); continue;
    }
    const raw = await readFile(receipt.artifacts.raw, "utf8");
    let parsed;
    try { parsed = parseExtraction(raw); }
    catch { documents.push({ documentId: document.id, state: "unparsable",
      strictAccepted: false, cPrimeAccepted: false }); continue; }
    const { corpus, pages } = await documentMaterial(document);
    const normalized = structuredClone(parsed);
    const strict = inspect(normalized, document, pages);
    if (strict.accepted !== receipt.validation.accepted) {
      throw new Error(`Offline strict mismatch: ${document.id}`);
    }
    if (strict.accepted) {
      documents.push({ documentId: document.id, state: "accepted", strictAccepted: true,
        cPrimeAccepted: true, sourceReceiptSha256: sha256(await readFile(decision.paths.receipt)) });
      continue;
    }
    if (strict.directViolations.length !== 1 || strict.base.length > 0
      || strict.contractViolation) {
      documents.push({ documentId: document.id, state: "rejected", strictAccepted: false,
        cPrimeAccepted: false, violationCount: strict.directViolations.length }); continue;
    }
    const candidate = structuredClone(normalized);
    let directDropped;
    try { directDropped = discardDirect(candidate, strict.directViolations[0].path); }
    catch { documents.push({ documentId: document.id, state: "not-localizable",
      strictAccepted: false, cPrimeAccepted: false }); continue; }
    const cascadeDropped = cascade(candidate, evidenceNodeTypes);
    let cPrimeAccepted = true; let validationError = null;
    try { await exactV9(document, candidate, corpus); }
    catch (error) { cPrimeAccepted = false; validationError = String(error.message).slice(0, 300); }
    documents.push({ documentId: document.id, state: "c-prime-candidate",
      strictAccepted: false, cPrimeAccepted,
      violation: strict.directViolations[0], directDropped, cascadeDropped, validationError });
  }
  const terminal = documents.filter(({ strictAccepted }) => strictAccepted !== null);
  const result = { schemaVersion: 1, campaign: CAMPAIGN, arm: armName,
    measuredAt: new Date().toISOString(), contract: "immo-pv-extraction-v9",
    policy: "discard-one-direct-record-then-referential-cleanup-to-fixed-point-and-full-v9-validation",
    strict: { accepted: terminal.filter(({ strictAccepted }) => strictAccepted).length,
      total: terminal.length },
    cPrime: { accepted: terminal.filter(({ cPrimeAccepted }) => cPrimeAccepted).length,
      total: terminal.length }, documents };
  const output = resolve(resultRoot, "scores", `${armName}.json`);
  await mkdir(dirname(output), { recursive: true });
  try { await writeFile(output, `${JSON.stringify(result)}\n`, { flag: "wx" }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await scoreArm(process.argv[2]);
  console.log(JSON.stringify({ arm: result.arm, strict: result.strict, cPrime: result.cPrime }));
}

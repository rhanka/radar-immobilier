import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { arms, OUTPUT_CAP, receiptCap, usageCostUsd } from "./v101-arms.mjs";
import { createProvider, ProviderError } from "./v101-provider.mjs";
import { advanceCircuit, artifactPaths, classifyFailure, rateLimitPlan, resetRateLimitState,
  releaseRateLimitIntent, resumeDecision, updateGlobalStatus, writeImmutable,
  writeIntent } from "./v101-runner-state.mjs";
import { sanitize } from "./v101-probe-lib.mjs";

const MAX_REQUESTS = 200;
const TIMEOUT_MS = 480_000;
const CAMPAIGN = process.env.BENCHMARK_CAMPAIGN ?? "v101";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => process.env[name]
  || (() => { throw new Error(`${name} is required`); })();
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function jsonLayer(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  try { JSON.parse(fenced ? fenced[1] : trimmed); return { valid: true, fenced: Boolean(fenced) }; }
  catch { return { valid: false, fenced: Boolean(fenced) }; }
}

function failureDetails(error, wire) {
  const providerError = error instanceof ProviderError ? error : error?.cause instanceof ProviderError
    ? error.cause : null;
  const effectiveWire = providerError?.wire ?? wire ?? null;
  const classified = classifyFailure({ httpStatus: providerError?.httpStatus
    ?? effectiveWire?.httpStatus ?? null, code: providerError?.code ?? error?.code ?? null,
  terminalSse: effectiveWire?.terminalSse ?? null });
  return { wire: effectiveWire, classified,
    error: { category: classified.category,
      code: sanitize(providerError?.code ?? error?.code ?? error?.name ?? "UNKNOWN"),
      httpStatus: providerError?.httpStatus ?? effectiveWire?.httpStatus ?? null } };
}

function actualSummary(actual) {
  return actual ? { responseId: actual.id, modelId: actual.modelId,
    finishReason: actual.finishReason, responseTextSha256: sha256(actual.text ?? ""),
    usage: actual.usage } : null;
}

async function frozenCorpus(document, manifest, repositoryRoot, materializeRefreshCorpus) {
  const sourceRunRoot = resolve(repositoryRoot, manifest.corpus.sourceRunRelativePath);
  const workerRoot = resolve(sourceRunRoot, "workers", document.city);
  const pdfPath = resolve(workerRoot, "corpus", `${document.sha256}.pdf`);
  const parsedPath = resolve(repositoryRoot, document.runtimeTextRelativePath);
  const [pdf, parsedText] = await Promise.all([readFile(pdfPath), readFile(parsedPath, "utf8")]);
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
  if (corpus.chunks.length !== 1) throw new Error("One frozen document must yield one chunk");
  return corpus;
}

async function progressFor(root, manifest, armName) {
  const progress = { total: manifest.documents.length, processed: 0, accepted: 0,
    errors: 0, lastReceipt: null, elapsedMs: 0 };
  for (const document of manifest.documents) {
    const decision = await resumeDecision(root, document.id, armName);
    if (decision.action !== "skip") continue;
    progress.processed += 1;
    progress.accepted += Number(Boolean(decision.receipt.validation?.accepted));
    progress.errors += Number(decision.receipt.status === "failed");
    progress.elapsedMs += decision.receipt.latency?.totalMs ?? 0;
    progress.lastReceipt = decision.paths.receipt;
  }
  return progress;
}

async function lastRateLimitedDocument(executionRoot, lane, armName) {
  try {
    const content = await readFile(resolve(executionRoot, "limits", `${lane}.jsonl`), "utf8");
    const events = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return events.reverse().find((event) => event.arm === armName
      && event.category === "rate-limit")?.documentId ?? null;
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export async function runArm(armName, options = {}) {
  const arm = arms[armName];
  if (!arm) throw new Error(`Unknown ${CAMPAIGN} arm: ${armName ?? "N-A"}`);
  const repositoryRoot = required("BENCHMARK_REPOSITORY_ROOT");
  const resultRoot = required("BENCHMARK_RESULT_ROOT");
  const executionRoot = process.env.BENCHMARK_EXECUTION_ROOT ?? resultRoot;
  const t1Root = required("BENCHMARK_T1_ROOT");
  const campaignRoot = resolve(executionRoot, "campaign", armName);
  const statusPath = resolve(executionRoot, "status.json");
  const logPath = resolve(executionRoot, "logs", `${armName}.log`);
  await Promise.all([mkdir(resolve(executionRoot, "logs"), { recursive: true }),
    mkdir(resolve(executionRoot, "limits"), { recursive: true })]);
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot,
    `docs/reviews/refresh-benchmark/${CAMPAIGN}/manifest.json`), "utf8"));
  if (manifest.contract.version !== "immo-pv-extraction-v9"
    || manifest.contract.mainMergeCommit.slice(0, 8) !== "4e3a4db8"
    || manifest.outputCap.commonMaxOutputTokens !== OUTPUT_CAP) {
    throw new Error("Frozen v101 contract mismatch");
  }
  const profilePath = resolve(t1Root, "api/src/services/graph/refresh-profile.ts");
  const corpusPath = resolve(t1Root, "api/src/services/graph/refresh-corpus.ts");
  if (sha256(await readFile(profilePath)) !== manifest.contract.profileModuleSha256
    || sha256(await readFile(corpusPath)) !== manifest.contract.corpusModuleSha256) {
    throw new Error("Frozen T1 module hash mismatch");
  }
  const { extractRefreshProfile, loadRefreshProfileContext } = await import(pathToFileURL(profilePath));
  const { materializeRefreshCorpus } = await import(pathToFileURL(corpusPath));
  const context = loadRefreshProfileContext({ root: t1Root,
    profilePath: resolve(t1Root, "radar/ontology/ontology-profile.yaml"), unregisteredOnly: true });
  const expectedById = new Map(manifest.promptFreeze.documents.map((item) => [item.id, item]));
  const [from, to] = String(options.slice ?? process.env.BENCHMARK_SLICE ?? `1-${
    manifest.documents.length}`).split("-").map(Number);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > manifest.documents.length
    || from > to) throw new Error("BENCHMARK_SLICE must be a valid one-based range");
  const documents = manifest.documents.slice(from - 1, to);
  const concurrency = Number(options.concurrency ?? process.env.BENCHMARK_CONCURRENCY ?? "1");
  if (![1, 2].includes(concurrency) || (concurrency === 2 && arm.lane !== "codex")) {
    throw new Error("Only the Codex lane may use concurrency 2");
  }
  let requests = 0; let rateLimited = false; let rateLimitConsecutive = 0;
  let resumeAt = null; let armYield = null;
  let circuit = advanceCircuit(undefined, null, 3); let priorArm = {};
  try {
    const priorStatus = JSON.parse(await readFile(statusPath, "utf8"));
    priorArm = priorStatus.arms?.[armName] ?? {};
    requests = Number(priorArm.requests ?? 0);
    rateLimitConsecutive = Number(priorArm.rateLimitConsecutive ?? 0);
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (priorArm.state === "suspended-429") {
    const documentId = await lastRateLimitedDocument(executionRoot, arm.lane, armName);
    if (documentId) await releaseRateLimitIntent(campaignRoot, documentId, armName);
  }
  const progress = await progressFor(campaignRoot, manifest, armName);
  const log = async (event) => {
    const record = { at: new Date().toISOString(), arm: armName, ...event };
    await appendFile(logPath, `${JSON.stringify(record)}\n`);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  };
  const publish = async (state) => updateGlobalStatus(statusPath, armName, () => {
    const remaining = progress.total - progress.processed;
    const meanMs = progress.processed ? progress.elapsedMs / progress.processed : null;
    return { state, total: progress.total, processed: progress.processed,
      accepted: progress.accepted, errors: progress.errors,
      lastReceipt: progress.lastReceipt, requests, rateLimitConsecutive, resumeAt,
      etaSeconds: meanMs === null ? null : Math.ceil(meanMs * remaining / concurrency / 1_000) };
  });
  await publish("running");

  const runDocument = async (document, provider) => {
    let decision = await resumeDecision(campaignRoot, document.id, armName);
    if (decision.action === "skip") return;
    for (;;) {
      const { attempt, previous, paths } = decision;
      const expected = expectedById.get(document.id);
      const started = Date.now();
      let actual = null; let wire = null; let qualityError = null; let accepted = false;
      let attemptRequests = 0; let yieldSignal = null;
      await writeIntent(paths, { schemaVersion: 2, state: "in-flight",
        startedAt: new Date(started).toISOString(), campaign: CAMPAIGN, arm: armName,
        documentId: document.id, attempt,
        requested: { providerId: arm.provider, transportProviderId: arm.transport,
          modelId: arm.model, effort: arm.effort, maxOutputTokens: OUTPUT_CAP } });
      const temporary = await mkdtemp("/tmp/v101-profile-");
      try {
        const corpus = await frozenCorpus(document, manifest, repositoryRoot, materializeRefreshCorpus);
        const textClient = { mode: "benchmark", provider: arm.provider, model: arm.model,
          async generateJson(input) {
            const hashes = { schemaSha256: sha256(input.schema), promptSha256: sha256(input.prompt) };
            if (!expected || hashes.schemaSha256 !== expected.schemaSha256
              || hashes.promptSha256 !== expected.promptSha256) throw new Error("Prompt/schema hash mismatch");
            const messages = [{ role: "system", content: manifest.promptFreeze.systemPrompt },
              { role: "user", content: `Schema: ${input.schema}\n\n${input.prompt}` }];
            for (;;) {
              try {
                attemptRequests += 1;
                actual = await provider.generate(messages, document.id); wire = actual.wire; break;
              }
              catch (error) {
                const details = failureDetails(error, wire);
                if (!details.classified.suspend) throw error;
                rateLimited = true;
                if (details.classified.category === "request-budget") {
                  circuit = { code: "REQUEST_BUDGET_SUSPENDED", consecutive: 3, open: true };
                  yieldSignal = { reason: "request-budget", resumeAt: null, circuitOpen: true };
                  await publish("circuit-open");
                  throw error;
                }
                const plan = rateLimitPlan(error.headers, rateLimitConsecutive);
                rateLimitConsecutive = plan.consecutive; resumeAt = plan.resumeAt;
                await appendFile(resolve(executionRoot, "limits", `${arm.lane}.jsonl`), `${JSON.stringify({
                  at: new Date().toISOString(), arm: armName, documentId: document.id,
                  category: details.classified.category,
                  httpStatus: error.httpStatus ?? null, resetAt: plan.resetAt,
                  resumeAt: plan.resumeAt, suspension: plan.consecutive,
                  action: plan.yieldLane ? "yield-lane" : "wait", headers: error.headers ?? {} })}\n`);
                await publish("suspended-429");
                if (plan.yieldLane) {
                  yieldSignal = { reason: "rate-limit", resumeAt: plan.resumeAt, circuitOpen: false };
                  throw error;
                }
                await wait(plan.waitMs);
              }
            }
            ({ consecutive: rateLimitConsecutive, resumeAt } = resetRateLimitState());
            await publish("running");
            await writeImmutable(paths.raw, actual.text ?? "", true);
            if (wire?.terminalSse?.expected && !wire.terminalSse.terminal) {
              throw new ProviderError("STREAM_WITHOUT_TERMINAL", { httpStatus: wire.httpStatus,
                headers: wire.headers, wire });
            }
            try { input.validateResponse(actual.text ?? ""); }
            catch (error) { qualityError = sanitize(error?.message ?? error); throw error; }
            await writeFile(input.outputPath, actual.text ?? "", "utf8");
            return { status: "completed", provider: arm.provider, mode: "benchmark",
              outputPath: input.outputPath, audit: { campaign: CAMPAIGN, arm: armName } };
          } };
        try {
          const result = await extractRefreshProfile(corpus.chunks, { textClient, context,
            maxOutputTokens: OUTPUT_CAP, outputDir: temporary });
          const extraction = result[0]?.extraction;
          accepted = Boolean(extraction);
          if (extraction) await writeImmutable(paths.output, extraction);
        } catch (error) {
          if (!actual) throw error;
          qualityError ??= sanitize(error?.message ?? error);
        }
        const completed = Date.now();
        const receipt = { schemaVersion: 2, campaign: CAMPAIGN, arm: armName,
          documentId: document.id, attemptNumber: attempt, status: "completed", terminal: true,
          requestCount: attemptRequests,
          requested: { providerId: arm.provider, transportProviderId: arm.transport,
            modelId: arm.model, effort: arm.effort, maxOutputTokens: OUTPUT_CAP,
            transportTimeoutMs: TIMEOUT_MS }, accountPseudonym: provider.accountPseudonym,
          input: { pdfSha256: document.sha256, textSha256: document.textSha256,
            schemaSha256: expected.schemaSha256, promptSha256: expected.promptSha256 },
          wire, terminalSse: wire?.terminalSse ?? null,
          actual: { responseId: actual.id, modelId: actual.modelId,
            finishReason: actual.finishReason, responseTextSha256: sha256(actual.text ?? ""),
            usage: actual.usage, costUsd: usageCostUsd(arm, actual.usage) },
          cap: receiptCap(arm, actual.usage),
          validation: { layers: { transport: { accepted: true },
            terminalStream: { accepted: !wire?.terminalSse?.expected || wire.terminalSse.terminal },
            json: jsonLayer(actual.text), v9: { accepted, error: qualityError } }, accepted },
          latency: { startedAt: new Date(started).toISOString(),
            completedAt: new Date(completed).toISOString(), totalMs: completed - started,
            networkMs: wire?.durationMs ?? null }, retry: { eligible: false, reason: null,
            previousAttempt: previous ? 1 : null }, error: null,
          artifacts: { intent: paths.intent, receipt: paths.receipt, raw: paths.raw,
            output: accepted ? paths.output : null },
          redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
        await writeImmutable(paths.receipt, receipt);
        circuit = advanceCircuit(circuit, null, 3);
        progress.processed += 1; progress.accepted += Number(accepted);
        progress.elapsedMs += receipt.latency.totalMs; progress.lastReceipt = paths.receipt;
        await publish("running"); await log({ event: "receipt", documentId: document.id,
          attempt, accepted, receipt: paths.receipt }); return;
      } catch (error) {
        if (yieldSignal) {
          await rm(paths.intent, { force: true });
          armYield = yieldSignal;
          return { yielded: true };
        }
        const completed = Date.now();
        const details = failureDetails(error, wire);
        circuit = advanceCircuit(circuit, details.error.code, 3);
        const retryEligible = attempt === 1 && details.classified.retry && !circuit.open;
        const receipt = { schemaVersion: 2, campaign: CAMPAIGN, arm: armName,
          documentId: document.id, attemptNumber: attempt, status: "failed", terminal: true,
          requestCount: attemptRequests,
          requested: { providerId: arm.provider, transportProviderId: arm.transport,
            modelId: arm.model, effort: arm.effort, maxOutputTokens: OUTPUT_CAP,
            transportTimeoutMs: TIMEOUT_MS }, accountPseudonym: provider.accountPseudonym,
          wire: details.wire, terminalSse: details.wire?.terminalSse ?? null,
          actual: actualSummary(actual),
          cap: receiptCap(arm, actual?.usage),
          validation: { layers: { transport: { accepted: false },
            terminalStream: { accepted: details.classified.category !== "stream-without-terminal" },
            json: actual ? jsonLayer(actual.text) : null, v9: { accepted: false, error: null } },
            accepted: false },
          latency: { startedAt: new Date(started).toISOString(),
            completedAt: new Date(completed).toISOString(), totalMs: completed - started,
            networkMs: details.wire?.durationMs ?? null },
          retry: { eligible: retryEligible, reason: retryEligible ? details.classified.category : null,
            previousAttempt: previous ? 1 : null }, error: details.error,
          artifacts: { intent: paths.intent, receipt: paths.receipt,
            raw: actual ? paths.raw : null, output: null },
          redaction: { allowlistedFieldsOnly: true, secretsIncluded: false } };
        await writeImmutable(paths.receipt, receipt);
        await log({ event: "receipt", documentId: document.id, attempt,
          status: "failed", retryEligible, circuit, receipt: paths.receipt });
        if (retryEligible) {
          decision = { action: "run", attempt: 2, previous: receipt,
            paths: artifactPaths(campaignRoot, document.id, armName, 2) };
          continue;
        }
        progress.processed += 1; progress.errors += 1;
        progress.elapsedMs += receipt.latency.totalMs; progress.lastReceipt = paths.receipt;
        await publish(circuit.open ? "circuit-open" : "running"); return;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  };

  let cursor = 0;
  const worker = async () => {
    const provider = await createProvider(arm, { timeoutMs: TIMEOUT_MS,
      beforeRequest() {
        if (requests >= MAX_REQUESTS) throw new ProviderError("REQUEST_BUDGET_SUSPENDED");
        requests += 1;
      } });
    for (;;) {
      if (circuit.open || armYield) return;
      const document = documents[cursor++];
      if (!document) return;
      await runDocument(document, provider);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  await publish(circuit.open ? "circuit-open" : armYield ? "suspended-429"
    : progress.processed === progress.total ? "completed" : "running");
  return { arm: armName, requests, rateLimited, processed: progress.processed,
    errors: progress.errors, circuitOpen: circuit.open, circuitCode: circuit.code,
    deferred: armYield?.reason === "rate-limit", resumeAt: armYield?.resumeAt ?? null };
}

if (process.env.BENCHMARK_MODE === "availability") {
  await import("./v101-availability-run.mjs");
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = process.argv[2]?.startsWith("judge-")
    ? await (await import("./v101-judge-run.mjs")).runV101bJudge(process.argv[2])
    : await runArm(process.argv[2]);
  console.log(JSON.stringify(result));
}

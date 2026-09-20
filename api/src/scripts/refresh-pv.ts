/**
 * refresh-pv — RAFRAÎCHISSEMENT des procès-verbaux municipaux → signaux.
 *
 * Usage:
 *   node dist/scripts/refresh-pv.js --all          # toutes les villes configurées
 *   node dist/scripts/refresh-pv.js waterloo       # une seule ville (diagnostic)
 *
 * `--all` est le mode du CronJob, joué QUATRE fois par jour. Il balaie la liste
 * déterministe des villes config-only, reprend au curseur durable du passage
 * précédent, et traite au plus un document par ville et par passage. Le mode
 * mono-ville reste disponible pour un diagnostic ciblé et pour le rejeu d'un PDF
 * figé (REFRESH_SAVED_PDF_PATH).
 *
 * Ce que `--all` traite : ce qui APPARAÎT. La première visite d'une ville amorce
 * son registre de couverture — tout ce que la source offre alors est réputé
 * couvert, sans un seul appel modèle — et les passages suivants ne paient que
 * les documents publiés depuis. Les procès-verbaux déjà projetés par le
 * traitement en masse ne sont pas ré-extraits (décision owner, 2026-09-20).
 * Il n'y a PAS de plafond quotidien de documents : ce qu'un passage ne peut pas
 * traiter reste `pending` dans le registre de sa ville et revient au suivant.
 *
 * Le balayage partage UNE instance de politique de modèle entre toutes les
 * villes : c'est ce qui fait que le circuit de quota, une fois ouvert, épargne
 * aux villes suivantes l'appel primaire voué au 429 et les envoie directement
 * au repli. Et il partage UN `cycleId`, si bien que l'avancement d'un passage se
 * lit d'un seul GROUP BY sur `refresh_document_outcomes`.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { pdfToTextViaPoppler } from "@radar/sources";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { createLogger } from "../logger.js";
import {
  createRefreshMesh, refreshErrorDiagnostic, type RefreshProvider,
} from "../services/graph/refresh-mesh.js";
import { createRefreshModelPolicy, type RefreshModel } from "../services/graph/refresh-model-policy.js";
import { loadRefreshProfileContext } from "../services/graph/refresh-profile.js";
import { runPvRefresh, type RefreshAcquire } from "../services/graph/refresh-run.js";
import { assessRefreshSweepHealth, parseRefreshTarget,
  runRefreshSweep, writeRefreshSweepReport } from "../services/graph/refresh-sweep.js";
import { canonicalHash } from "../services/graph/replay/canonical-json.js";
import { configOnlyCitySlugs } from "../services/sources/live-scrape.js";
import { canonicalGraphKey } from "../storage/object-store.js";
import { getScrapeObjectStore, type S3ObjectStore } from "../storage/s3-object-store.js";

const profilePath = fileURLToPath(new URL("../../../radar/ontology/ontology-profile.yaml", import.meta.url));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positive(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

/** Same, but 0 is a legal value and means "no ceiling". */
function optionalCeiling(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

function rate(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be a rate in (0, 1]`);
  }
  return value;
}


function selectedModel(prefix: string): RefreshModel {
  const provider = required(`${prefix}_PROVIDER`);
  if (provider !== "openai" && provider !== "gemini") throw new Error(`${prefix}_PROVIDER must be openai or gemini`);
  const effort = required(`${prefix}_REASONING_EFFORT`);
  if (!["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error(`${prefix}_REASONING_EFFORT is invalid`);
  }
  return { provider: provider as RefreshProvider, model: required(`${prefix}_MODEL`), effort };
}

async function seedSavedInput(store: S3ObjectStore, city: string): Promise<RefreshAcquire | undefined> {
  const pdfPath = process.env.REFRESH_SAVED_PDF_PATH?.trim();
  if (!pdfPath) return undefined;
  const expectedSha = required("REFRESH_SAVED_PDF_SHA256");
  const sourceUrl = required("REFRESH_SAVED_PDF_URL");
  const bytes = await readFile(pdfPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== expectedSha) throw new Error("Saved PDF checksum does not match REFRESH_SAVED_PDF_SHA256");
  const sourceId = `proces-verbaux-${city}`;
  const key = `raw/${sourceId}/cas/${sha}.pdf`;
  await store.put(key, bytes, "application/pdf");
  await store.put(`${key}.meta.json`, JSON.stringify({ sourceUrl }), "application/json");
  const canonicalKey = canonicalGraphKey(city);
  if ((await store.head(canonicalKey)) === null) {
    const baseline = await readFile(required("REFRESH_SAVED_BASELINE_PATH"));
    JSON.parse(new TextDecoder().decode(baseline));
    await store.putCanonicalGraph(canonicalKey, baseline, "application/json", { ifMatch: null });
  }
  return async () => [{ city, sourceId, status: "seen", casKeys: [key], count: 1 }];
}

async function main(): Promise<void> {
  const target = parseRefreshTarget(process.argv.slice(2));
  const city = target.citySlug;
  if (!target.all && !city) throw new Error("Usage: refresh-pv.ts --all | <city-slug>");
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = getScrapeObjectStore(config);
  const { db, pool } = createDb(config);
  const timeoutMs = positive("REFRESH_TIMEOUT_MS", 900_000, 3_600_000);
  const primary = selectedModel("REFRESH");
  const fallback = selectedModel("REFRESH_FALLBACK");
  const verifyEnabled = process.env.REFRESH_VERIFY_ENABLED ?? "0";
  if (verifyEnabled !== "0" && verifyEnabled !== "1") throw new Error("REFRESH_VERIFY_ENABLED must be 0 or 1");
  const verification = verifyEnabled === "1" ? selectedModel("REFRESH_VERIFY") : undefined;
  // The explicit policy owns bounded quality retries; Graphify gets one route attempt.
  const maximumAttempts = positive("REFRESH_MAXIMUM_ATTEMPTS", 1, 1);
  const primaryQualityAttempts = positive("REFRESH_PRIMARY_QUALITY_ATTEMPTS", 2, 10);
  const profileContext = loadRefreshProfileContext({ root: process.cwd(), profilePath,
    unregisteredOnly: true });
  // A frozen PDF pins ONE city's input, so it is meaningless — and misleading —
  // over the whole list. Refuse rather than silently seed every city with it.
  if (target.all && process.env.REFRESH_SAVED_PDF_PATH?.trim()) {
    throw new Error("REFRESH_SAVED_PDF_PATH is a single-city replay and cannot be combined with --all");
  }
  const acquire = city ? await seedSavedInput(store, city) : undefined;
  const common = {
    routingSubject: { principalRef: required("REFRESH_PRINCIPAL_REF"),
      ownerScopeRef: required("REFRESH_OWNER_SCOPE_REF") },
    configResolver: { async resolveConfig() { return {}; } },
    keyring: new EncryptedFileKeyring(required("SENTROPIC_LLM_MESH_KEYRING_DIR")),
    maximumAttempts,
  };
  // ONE instance for the whole run: the quota circuit it carries is what spares
  // the cities that follow a primary call already known to be refused.
  const documentModels = createRefreshModelPolicy({ primary, fallback, primaryQualityAttempts, timeoutMs,
    ...(city ? { citySlug: city } : {}),
    ...(verification ? { verification } : {}),
    forceFallback: process.env.REFRESH_FORCE_FALLBACK === "1",
    createClient: (model, signal) => createRefreshMesh({ ...common,
      provider: model.provider, model: model.model,
      reasoning: { effort: model.effort as "low" }, signal }).textClient,
  });
  let modelCalls = 0;
  // Calls actually SENT to a seat, refusals included. `modelCalls` counts every
  // receipt, including the verification skipped for want of an act, which costs
  // nothing; a budget must be spent against what was paid.
  let submissions = 0;
  // One cycle id for the whole run: it is the key that makes the progress of a
  // sweep readable as one GROUP BY over refresh_document_outcomes.
  const cycleId = randomUUID();
  const cities = target.all ? configOnlyCitySlugs() : [city!];
  // Read and validate the whole configuration ONCE, before the first city. Read
  // inside the per-city call, a single bad value would be re-thrown 528 times and
  // reported as 528 refused cities instead of one refused startup.
  const runOptions = {
    budgetLimit: positive("REFRESH_BUDGET_LIMIT", 20_000, 1_000_000),
    maxOutputTokens: positive("REFRESH_MAX_OUTPUT_TOKENS", 32_768, 65_536),
    // NEW CAS writes per city and per pass. RECUEIL stops listing as soon as it
    // has written this many, so a value of 1 truncates the candidate list at the
    // first unseen document: on an index page ordered oldest-first, a city would
    // reveal its window one document per pass. Five bounds the per-pass writes
    // while letting a city that published several documents at once be seen in
    // one visit. Documents already collected do not consume it.
    acquisitionLimit: positive("REFRESH_ACQUISITION_LIMIT", 5, 100),
    // The adapter's own six-month default. The one measured whole-list sweep
    // (528 cities, 2026-09-05) ran at this window, so it is the window whose
    // cost is known; narrowing it would be a behaviour change with no measure.
    acquisitionWindowDays: positive("REFRESH_WINDOW_DAYS", 183, 3_650),
  };
  const sweepOptions = {
    // The sweep must stop itself, cursor up to date, before the Job's own
    // activeDeadlineSeconds SIGKILLs the pod. The value belongs to the manifest,
    // which knows the schedule; this default is the Job deadline minus a slot's
    // margin. The only duration figure available for a 528-city acquisition is
    // 2 h 41, measured on `worker-live` — a PROXY for this code path, not a
    // measurement of it (see the status report).
    deadlineMs: positive("REFRESH_SWEEP_DEADLINE_MS", 18_000_000, 86_400_000),
    // NO daily ceiling by default (owner decision, 2026-09-20): the volume is
    // what the municipalities publish. A non-zero value does not END the run —
    // it switches extraction off and keeps visiting, so the documents passed
    // over stay pending and the next pass picks them up.
    maxSubmissions: optionalCeiling("REFRESH_SWEEP_MAX_SUBMISSIONS", 0, 100_000),
    // A city may turn out to owe a document, so the reserve has to cover one
    // model call; 120 s used to guarantee a SIGKILL mid-document instead.
    cityReserveMs: positive("REFRESH_SWEEP_CITY_RESERVE_MS", timeoutMs, 3_600_000),
    maxFailureRate: rate("REFRESH_SWEEP_MAX_FAILURE_RATE", 0.9),
    maxDocumentFailures: positive("REFRESH_MAX_DOCUMENT_FAILURES", 3, 100),
  };
  // The Job is SIGTERMed before it is SIGKILLed, and the sweep's own deadline is
  // a second, independent guard. Without either, the `aborted` branch of the
  // sweep was dead code and the pod died in the middle of a document.
  const controller = new AbortController();
  const stop = (reason: string) => () => {
    if (!controller.signal.aborted) {
      logger.warn({ reason }, "refresh-pv: stopping");
      controller.abort(new Error(`Refresh stopped: ${reason}`));
    }
  };
  process.once("SIGTERM", stop("sigterm"));
  process.once("SIGINT", stop("sigint"));
  const hardStop = setTimeout(stop("deadline"), sweepOptions.deadlineMs);
  hardStop.unref();
  const refreshCity = (citySlug: string, mode: { extract: boolean } = { extract: true }) =>
    runPvRefresh({ cycleId, citySlug, store, db, profileContext,
      documentModels,
      onModelReceipt(docSha, chunkId, receipt) {
        modelCalls += 1;
        if (receipt.modelUsed) submissions += 1;
        logger.info({ citySlug, docSha, chunkId, modelCalls, submissions, ...receipt },
          "refresh-pv: model receipt");
      },
      onNote: (note, detail) => logger.info({ citySlug, ...detail }, `refresh-pv: ${note}`),
      extractPdf: async (bytes, url) => pdfToTextViaPoppler(url)(bytes, 30_000),
      profileHash: profileContext.profile.profile_hash,
      registryHash: canonicalHash(profileContext.registryExtraction), packageVersion: "0.18.0",
      modelPolicy: documentModels.policy,
      maximumAttempts,
      // The whole-list sweep takes a city's existing corpus as covered on its
      // first visit; a targeted single-city run does not, because the operator
      // asked for that city on purpose.
      primeCoverage: target.all,
      maxDocumentFailures: sweepOptions.maxDocumentFailures,
      extract: mode.extract,
      signal: controller.signal,
      ...runOptions,
      ...(acquire ? { acquire } : {}) });

  logger.info({ mode: target.all ? "all" : "city", city, cities: cities.length, cycleId,
    modelPolicy: documentModels.policy, maximumAttempts, primaryQualityAttempts, timeoutMs },
  "refresh-pv: starting");
  const startedAt = new Date().toISOString();
  try {
    if (!target.all) {
      logger.info({ ...await refreshCity(city!), modelCalls, submissions }, "refresh-pv: completed");
      return;
    }
    const report = await runRefreshSweep({
      cities, store,
      async refreshCity(citySlug, mode) {
        try {
          return await refreshCity(citySlug, mode);
        } catch (error) {
          // The sweep keeps only a reason code; the redacted diagnostic is
          // logged here, where the error is still in hand.
          logger.warn({ citySlug, ...refreshErrorDiagnostic(error) }, "refresh-pv: city refused");
          throw error;
        }
      },
      deadlineMs: sweepOptions.deadlineMs,
      maxSubmissions: sweepOptions.maxSubmissions,
      submissions: () => submissions,
      // The primary's quota circuit already spares the following cities a call
      // known to be refused. Nothing covered the FALLBACK: once it too is out of
      // quota, every remaining city would pay a 429 and fail.
      haltExtraction: () => documentModels.fallbackQuotaExhausted() ? "fallback-quota-exhausted" : null,
      cityReserveMs: sweepOptions.cityReserveMs,
      onCity: (entry) => logger.info(entry, "refresh-pv: city"),
      onNote: (note, detail) => logger.warn({ ...detail }, `refresh-pv: ${note}`),
      signal: controller.signal,
    });
    // The per-city entries are already streamed above; the summary stays small
    // enough to read in one log line even with 528 cities.
    const { entries: _entries, ...summary } = report;
    const health = assessRefreshSweepHealth(report, sweepOptions.maxFailureRate);
    logger.info({ cycleId, ...summary, modelCalls, ...health }, "refresh-pv: sweep completed");
    // The pod's logs are collected for a day; the rotation they describe takes
    // longer than that to come round. Persist the report or the question "which
    // cities were visited, and when" has no answer.
    try {
      await writeRefreshSweepReport(store, cycleId,
        { ...report, startedAt, finishedAt: new Date().toISOString() });
    } catch (error) {
      logger.warn(refreshErrorDiagnostic(error), "refresh-pv: sweep report not persisted");
    }
    if (health.exitCode === 1) process.exitCode = 1;
  } finally {
    clearTimeout(hardStop);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("refresh-pv: failed", refreshErrorDiagnostic(error));
  process.exitCode = 1;
});

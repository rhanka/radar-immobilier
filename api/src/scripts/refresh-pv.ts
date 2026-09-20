/**
 * refresh-pv — RAFRAÎCHISSEMENT des procès-verbaux municipaux → signaux.
 *
 * Usage:
 *   node dist/scripts/refresh-pv.js --all          # toutes les villes configurées
 *   node dist/scripts/refresh-pv.js waterloo       # une seule ville (diagnostic)
 *
 * `--all` est le mode du CronJob quotidien. Il balaie la liste déterministe des
 * villes config-only, reprend au curseur durable de la veille, et traite au plus
 * un document par ville et par passage. Le mode mono-ville reste disponible pour
 * un diagnostic ciblé et pour le rejeu d'un PDF figé (REFRESH_SAVED_PDF_PATH).
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
  runRefreshSweep } from "../services/graph/refresh-sweep.js";
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
    acquisitionLimit: positive("REFRESH_ACQUISITION_LIMIT", 1, 100),
    // The adapter's own six-month default. The one measured whole-list sweep
    // (528 cities, 2026-09-05) ran at this window, so it is the window whose
    // cost is known; narrowing it would be a behaviour change with no measure.
    acquisitionWindowDays: positive("REFRESH_WINDOW_DAYS", 183, 3_650),
  };
  const sweepOptions = {
    // 4 h 15, i.e. the measured 2 h 41 of a 528-city acquisition sweep plus the
    // extraction headroom of the document cap below, and fifteen minutes under
    // the Job's own activeDeadlineSeconds so the sweep stops itself first.
    deadlineMs: positive("REFRESH_SWEEP_DEADLINE_MS", 15_300_000, 86_400_000),
    // 17/day keeps a month of sweeps under the measured 532 documents/month
    // ceiling of the dedicated Gemini seat. The expected daily delta is far
    // lower; this is the ceiling, not the target. Raise it deliberately, and
    // watch the seat, to drain a backlog.
    maxDocuments: positive("REFRESH_SWEEP_MAX_DOCUMENTS", 17, 10_000),
    cityReserveMs: positive("REFRESH_SWEEP_CITY_RESERVE_MS", 120_000, 3_600_000),
    maxFailureRate: rate("REFRESH_SWEEP_MAX_FAILURE_RATE", 0.9),
  };
  const refreshCity = (citySlug: string) => runPvRefresh({ cycleId, citySlug, store, db, profileContext,
    documentModels,
    onModelReceipt(docSha, chunkId, receipt) {
      modelCalls += 1;
      logger.info({ citySlug, docSha, chunkId, modelCalls, ...receipt }, "refresh-pv: model receipt");
    },
    extractPdf: async (bytes, url) => pdfToTextViaPoppler(url)(bytes, 30_000),
    profileHash: profileContext.profile.profile_hash,
    registryHash: canonicalHash(profileContext.registryExtraction), packageVersion: "0.18.0",
    modelPolicy: documentModels.policy,
    maximumAttempts,
    ...runOptions,
    ...(acquire ? { acquire } : {}) });

  logger.info({ mode: target.all ? "all" : "city", city, cities: cities.length, cycleId,
    modelPolicy: documentModels.policy, maximumAttempts, primaryQualityAttempts, timeoutMs },
  "refresh-pv: starting");
  try {
    if (!target.all) {
      logger.info({ ...await refreshCity(city!), modelCalls }, "refresh-pv: completed");
      return;
    }
    const report = await runRefreshSweep({
      cities, store,
      async refreshCity(citySlug) {
        try {
          return await refreshCity(citySlug);
        } catch (error) {
          // The sweep keeps only a reason code; the redacted diagnostic is
          // logged here, where the error is still in hand.
          logger.warn({ citySlug, ...refreshErrorDiagnostic(error) }, "refresh-pv: city refused");
          throw error;
        }
      },
      deadlineMs: sweepOptions.deadlineMs,
      maxDocuments: sweepOptions.maxDocuments,
      cityReserveMs: sweepOptions.cityReserveMs,
      onCity: (entry) => logger.info(entry, "refresh-pv: city"),
    });
    // The per-city entries are already streamed above; the summary stays small
    // enough to read in one log line even with 528 cities.
    const { entries: _entries, ...summary } = report;
    const health = assessRefreshSweepHealth(report, sweepOptions.maxFailureRate);
    logger.info({ cycleId, ...summary, modelCalls, ...health }, "refresh-pv: sweep completed");
    if (health.exitCode === 1) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("refresh-pv: failed", refreshErrorDiagnostic(error));
  process.exitCode = 1;
});

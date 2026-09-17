import { createHash } from "node:crypto";
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
import { canonicalHash } from "../services/graph/replay/canonical-json.js";
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
  const city = process.argv[2]?.trim();
  if (!city || process.argv.length !== 3) throw new Error("Usage: refresh-pv.ts <city-slug>");
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const store = getScrapeObjectStore(config);
  const { db, pool } = createDb(config);
  const timeoutMs = positive("REFRESH_TIMEOUT_MS", 900_000, 3_600_000);
  const primary = selectedModel("REFRESH");
  const fallback = selectedModel("REFRESH_FALLBACK");
  // The explicit policy owns bounded quality retries; Graphify gets one route attempt.
  const maximumAttempts = positive("REFRESH_MAXIMUM_ATTEMPTS", 1, 1);
  const primaryQualityAttempts = positive("REFRESH_PRIMARY_QUALITY_ATTEMPTS", 2, 10);
  const profileContext = loadRefreshProfileContext({ root: process.cwd(), profilePath,
    unregisteredOnly: true });
  const acquire = await seedSavedInput(store, city);
  const common = {
    routingSubject: { principalRef: required("REFRESH_PRINCIPAL_REF"),
      ownerScopeRef: required("REFRESH_OWNER_SCOPE_REF") },
    configResolver: { async resolveConfig() { return {}; } },
    keyring: new EncryptedFileKeyring(required("SENTROPIC_LLM_MESH_KEYRING_DIR")),
    maximumAttempts,
  };
  const documentModels = createRefreshModelPolicy({ primary, fallback, primaryQualityAttempts, timeoutMs,
    forceFallback: process.env.REFRESH_FORCE_FALLBACK === "1",
    createClient: (model, signal) => createRefreshMesh({ ...common,
      provider: model.provider, model: model.model,
      reasoning: { effort: model.effort as "low" }, signal }).textClient,
  });
  let modelCalls = 0;
  logger.info({ city, modelPolicy: documentModels.policy, maximumAttempts, primaryQualityAttempts, timeoutMs },
    "refresh-pv: starting");
  try {
    const result = await runPvRefresh({ citySlug: city, store, db, profileContext,
      documentModels,
      onModelReceipt(docSha, chunkId, receipt) {
        modelCalls += 1;
        logger.info({ docSha, chunkId, modelCalls, ...receipt }, "refresh-pv: model receipt");
      },
      extractPdf: async (bytes, url) => pdfToTextViaPoppler(url)(bytes, 30_000),
      profileHash: profileContext.profile.profile_hash,
      registryHash: canonicalHash(profileContext.registryExtraction), packageVersion: "0.18.0",
      modelPolicy: documentModels.policy,
      budgetLimit: positive("REFRESH_BUDGET_LIMIT", 20_000, 1_000_000),
      maximumAttempts,
      maxOutputTokens: positive("REFRESH_MAX_OUTPUT_TOKENS", 32_768, 65_536),
      acquisitionLimit: positive("REFRESH_ACQUISITION_LIMIT", 1, 100),
      ...(acquire ? { acquire } : {}) });
    logger.info({ ...result, modelCalls }, "refresh-pv: completed");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("refresh-pv: failed", refreshErrorDiagnostic(error));
  process.exitCode = 1;
});

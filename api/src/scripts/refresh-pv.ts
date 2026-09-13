import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { pdfToTextViaPoppler } from "@radar/sources";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";

import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { createLogger } from "../logger.js";
import { createRefreshMesh, type RefreshProvider } from "../services/graph/refresh-mesh.js";
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

function provider(): RefreshProvider {
  const value = required("REFRESH_PROVIDER");
  if (value !== "openai" && value !== "gemini") throw new Error("REFRESH_PROVIDER must be openai or gemini");
  return value;
}

function safeErrorDiagnostic(error: unknown): Record<string, string | number | undefined> {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = record["cause"] && typeof record["cause"] === "object"
    ? record["cause"] as Record<string, unknown> : {};
  const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)
    ? value : undefined;
  const status = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : undefined;
  const internalFrame = error instanceof Error ? error.stack?.split("\n").slice(1)
    .map((line) => line.trim()).find((line) => /^at [A-Za-z0-9_.<>]+ \(?node:internal\//.test(line)) : undefined;
  return { errorName: token(record["name"]), errorCode: token(record["code"]),
    statusCode: status(record["statusCode"] ?? record["status"]), requestId: token(record["requestId"]),
    causeName: token(cause["name"]), causeCode: token(cause["code"]),
    causeStatusCode: status(cause["statusCode"] ?? cause["status"]), stackOrigin: internalFrame };
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
  const controller = new AbortController();
  const timeoutMs = positive("REFRESH_TIMEOUT_MS", 900_000, 3_600_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const selectedProvider = provider();
  const model = required("REFRESH_MODEL");
  const effort = required("REFRESH_REASONING_EFFORT");
  if (!["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    throw new Error("REFRESH_REASONING_EFFORT is invalid");
  }
  const profileContext = loadRefreshProfileContext({ root: process.cwd(), profilePath,
    unregisteredOnly: true });
  const acquire = await seedSavedInput(store, city);
  const bundle = createRefreshMesh({
    routingSubject: { principalRef: required("REFRESH_PRINCIPAL_REF"),
      ownerScopeRef: required("REFRESH_OWNER_SCOPE_REF") },
    configResolver: { async resolveConfig() { return {}; } },
    keyring: new EncryptedFileKeyring(required("SENTROPIC_LLM_MESH_KEYRING_DIR")),
    provider: selectedProvider, model, reasoning: { effort: effort as "medium" }, signal: controller.signal,
  });
  let modelCalls = 0;
  const measuredTextClient = { ...bundle.textClient,
    async generateJson(input: Parameters<typeof bundle.textClient.generateJson>[0]) {
      modelCalls += 1;
      const startedAt = Date.now();
      const schemaSha256 = createHash("sha256").update(input.schema).digest("hex");
      const promptSha256 = createHash("sha256").update(input.prompt).digest("hex");
      const receipt = { modelCalls, provider: selectedProvider, model, effort, schemaSha256, promptSha256 };
      try {
        const result = await bundle.textClient.generateJson(input);
        logger.info({ ...receipt, latencyMs: Date.now() - startedAt,
          status: "completed" }, "refresh-pv: model call completed");
        return result;
      } catch (error) {
        logger.warn({ ...receipt, latencyMs: Date.now() - startedAt, status: "failed",
          aborted: controller.signal.aborted, ...safeErrorDiagnostic(error) }, "refresh-pv: model call failed");
        throw error;
      }
    } };
  logger.info({ city, provider: selectedProvider, model, effort, timeoutMs }, "refresh-pv: starting");
  try {
    const result = await runPvRefresh({ citySlug: city, store, db, profileContext,
      textClient: measuredTextClient, extractPdf: async (bytes, url) => pdfToTextViaPoppler(url)(bytes, 30_000),
      profileHash: profileContext.profile.profile_hash,
      registryHash: canonicalHash(profileContext.registryExtraction), packageVersion: "0.18.0",
      modelPolicy: `${selectedProvider}/${model}/${effort}`,
      budgetLimit: positive("REFRESH_BUDGET_LIMIT", 20_000, 1_000_000),
      maximumAttempts: positive("REFRESH_MAXIMUM_ATTEMPTS", 2, 10),
      maxOutputTokens: positive("REFRESH_MAX_OUTPUT_TOKENS", 4_096, 65_536),
      acquisitionLimit: positive("REFRESH_ACQUISITION_LIMIT", 1, 100), signal: controller.signal,
      ...(acquire ? { acquire } : {}) });
    logger.info({ ...result, modelCalls }, "refresh-pv: completed");
  } finally {
    clearTimeout(timeout);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

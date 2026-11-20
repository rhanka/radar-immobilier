import { randomUUID } from "node:crypto";
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { createRefreshMesh, refreshErrorDiagnostic } from "../services/graph/refresh-mesh.js";
import { createRefreshModelPolicy } from "../services/graph/refresh-model-policy.js";
import { createReannotationRepository } from "../services/graph/reannotate-repository.js";
import {
  createReannotationClassifier,
  parseReannotationArgs,
  parseReannotationPipelineRunId,
  parseReannotationSinceDays,
  runReannotation,
} from "../services/graph/reannotate-signals.js";
import { loadSinglePassPrompt } from "../services/graph/refresh-single-pass.js";
import { refreshClassifyConfig } from "../services/graph/refresh-classify-config.js";
import { parsePurgeAiAnnotationsArgs, purgeAiAnnotations } from "../services/graph/purge-ai-annotations.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv[2] === "--purge-ai-annotations") {
    const options = parsePurgeAiAnnotationsArgs(process.argv.slice(3));
    const { db, pool } = createDb(loadConfig());
    try { console.log(JSON.stringify(await purgeAiAnnotations(db, options))); }
    finally { await pool.end(); }
    return;
  }
  const { apply } = parseReannotationArgs(process.argv.slice(2));
  const sinceDays = parseReannotationSinceDays();
  const pipelineRunId = parseReannotationPipelineRunId() ?? randomUUID();
  const { primary, fallback, concurrency } = refreshClassifyConfig();
  const timeoutMs = Number(process.env.REFRESH_TIMEOUT_MS ?? 900_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new Error("REFRESH_TIMEOUT_MS must be an integer from 1 to 3600000");
  }
  const runTimeoutMs = Number(process.env.REFRESH_SWEEP_DEADLINE_MS ?? 18_900_000);
  if (!Number.isInteger(runTimeoutMs) || runTimeoutMs < 1 || runTimeoutMs > 86_400_000) {
    throw new Error("REFRESH_SWEEP_DEADLINE_MS must be an integer from 1 to 86400000");
  }
  const prompt = await loadSinglePassPrompt();
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Reannotation interrupted"));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const common = { routingSubject: { principalRef: required("REFRESH_PRINCIPAL_REF"),
    ownerScopeRef: required("REFRESH_OWNER_SCOPE_REF") },
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring(required("SENTROPIC_LLM_MESH_KEYRING_DIR")), maximumAttempts: 1 };
  const models = createRefreshModelPolicy({ primary, fallback, timeoutMs, primaryQualityAttempts: 1,
    signal: controller.signal, forceFallback: process.env.REFRESH_FORCE_FALLBACK === "1",
    createClient: (model, signal) => createRefreshMesh({ ...common,
      provider: model.provider, model: model.model,
      reasoning: { effort: model.effort as "low" }, signal }).textClient });
  const { db, pool } = createDb(loadConfig());
  try {
    const report = await runReannotation({ repository: createReannotationRepository(db),
      primary, fallback, concurrency, prompt, apply, sinceDays, actTimeoutMs: timeoutMs, runTimeoutMs,
      now: new Date(), pipelineRunId,
      classify: createReannotationClassifier(models, prompt), signal: controller.signal });
    console.log(JSON.stringify({ kind: "signal-reannotation", ...report }));
    if (report.failures.length) process.exitCode = 1;
  } finally {
    await pool.end();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

main().catch((error: unknown) => {
  console.error("reannotate-signals: failed", refreshErrorDiagnostic(error));
  process.exitCode = 1;
});

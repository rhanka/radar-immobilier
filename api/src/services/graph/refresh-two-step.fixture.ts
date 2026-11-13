import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadOntologyProfile, registryRecordsToExtraction, type TextJsonGenerationInput } from "@sentropic/engram";
import type { Database } from "../../db/client.js";
import { FakeGraphStore } from "./canonical-graph-store.fixture.js";
import { refreshClassifyConfig } from "./refresh-classify-config.js";
import { createRefreshModelPolicy, type RefreshModel } from "./refresh-model-policy.js";
import { runPvRefresh, type RunPvRefreshOptions } from "./refresh-run.js";
import { loadSinglePassPrompt } from "./refresh-single-pass.js";
import { REFRESH_VERIFICATION_PROMPT } from "./refresh-verification-prompt.js";

export async function twoStepFixture(db: Database, mode: "off" | "two-step", failClassification = false) {
  const oracle = JSON.parse(await readFile(new URL("../../../tests/fixtures/refresh-018/oracle.json", import.meta.url), "utf8"));
  const bytes = new TextEncoder().encode("synthetic exact PDF bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `raw/proces-verbaux-waterloo/cas/${sha}.pdf`;
  const store = new FakeGraphStore();
  store.seed("graph/waterloo/latest.json", JSON.stringify({ nodes: [
    { id: "baseline-only", type: "Signal", label: "Old act" },
  ], edges: [] }));
  store.seed(key, bytes);
  store.seed(`${key}.meta.json`, JSON.stringify({ sourceUrl: oracle.sourceUrl, publishedAt: oracle.meetingDate }));
  const profile = loadOntologyProfile(fileURLToPath(new URL("../../../../radar/ontology/ontology-profile.yaml", import.meta.url)));
  const registries = Object.fromEntries(Object.keys(profile.registries).map((id) => [id, []]));
  const body = { nodes: ["Signal", "DesignationEvent"].map((type) => ({
    id: `new-${type}`, node_type: type, label: `Adoption ${oracle.bylawNumber}`,
    file_type: "document", source_file: key, status: "candidate", etape: oracle.stage,
    etape_date: oracle.meetingDate, resolution: oracle.resolution, reglement_number: oracle.bylawNumber,
    citations: [{ page: 1, excerpt: oracle.excerpt }],
  })), edges: [], input_tokens: 10, output_tokens: 20 };
  const detectionRequests: Array<{ model: RefreshModel; prompt: string; schema: string }> = [];
  const classificationRequests: TextJsonGenerationInput[] = [];
  const primary: RefreshModel = { provider: "openai", model: "gpt-6-astra", effort: "medium" };
  const fallback: RefreshModel = { provider: "gemini", model: "gemini-3.8-flash", effort: "low" };
  const documentModels = createRefreshModelPolicy({ primary, fallback, verification: fallback,
    forceFallback: false, primaryQualityAttempts: 2, timeoutMs: 1000,
    createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
      async generateJson(request) {
        detectionRequests.push({ model, prompt: request.prompt, schema: request.schema });
        const verify = request.prompt.startsWith(REFRESH_VERIFICATION_PROMPT);
        await request.validateResponse?.(JSON.stringify(verify ? { decisions: [] } : body));
        return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
      } }),
  });
  const config = refreshClassifyConfig({});
  const prompt = await loadSinglePassPrompt();
  const models = createRefreshModelPolicy({ ...config, primaryQualityAttempts: 1, forceFallback: false, timeoutMs: 1000,
    createClient: (model) => ({ mode: "mesh", provider: model.provider, model: model.model,
      async generateJson(request) {
        classificationRequests.push(request);
        if (failClassification) throw new Error("classification service unavailable");
        await request.validateResponse?.(JSON.stringify({ classe: "a_surveiller", reason: "Residential impact uncertain",
          reasonCode: "S-PORTEE-FLOUE", ambiguous: true }));
        return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
      } }),
  });
  const notes: Array<{ note: string; detail?: Record<string, unknown> }> = [];
  const options: RunPvRefreshOptions = {
    citySlug: "waterloo", cycleId: "00000000-0000-4000-8000-000000000001", db,
    // The canonical fixture implements the byte operations; put's return value is unused here.
    store: store as unknown as RunPvRefreshOptions["store"],
    profileContext: { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) },
    documentModels, profileHash: "profile", registryHash: "registry", packageVersion: "0.18.0",
    modelPolicy: documentModels.policy, budgetLimit: 100, maximumAttempts: 1, maxOutputTokens: 2048,
    now: () => new Date("2026-11-13T17:00:00.000Z"),
    extractPdf: async () => oracle.excerpt,
    acquire: async () => [{ city: "waterloo", sourceId: "proces-verbaux-waterloo", status: "new", casKeys: [key], count: 1 }],
    onNote: (note, detail) => { notes.push({ note, ...(detail ? { detail } : {}) }); },
    ...(mode === "two-step" ? { classification: { ...config, prompt, models } } : {}),
  };
  return { run: () => runPvRefresh(options), store, options, detectionRequests, classificationRequests, notes, prompt };
}

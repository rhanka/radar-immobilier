import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOntologyProfile, registryRecordsToExtraction,
  type Extraction, type TextJsonGenerationClient } from "@sentropic/graphify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb, type Database } from "../../src/db/client.js";
import { graphEdges, graphNodes, refreshDocumentOutcomes } from "../../src/db/schema.js";
import { subgraphForCity, upsertGraphAtomic } from "../../src/services/graph/graph-store.js";
import type { RefreshProfileContext } from "../../src/services/graph/refresh-profile.js";
import { createRefreshModelPolicy } from "../../src/services/graph/refresh-model-policy.js";
import { runPvRefresh, type RunPvRefreshOptions } from "../../src/services/graph/refresh-run.js";
import { canonicalGraphKey } from "../../src/storage/object-store.js";
import { getScrapeObjectStore, type S3ObjectStore } from "../../src/storage/s3-object-store.js";
import { eq, inArray, or } from "drizzle-orm";

const profilePath = fileURLToPath(new URL("../../../radar/ontology/ontology-profile.yaml", import.meta.url));
let db: Database;
let pool: ReturnType<typeof createDb>["pool"];
let store: S3ObjectStore;
let context: RefreshProfileContext;

beforeAll(async () => {
  ({ db, pool } = createDb(loadConfig()));
  store = getScrapeObjectStore(loadConfig());
  await store.ensureBucket();
  const profile = loadOntologyProfile(profilePath);
  const registries = Object.fromEntries(Object.keys(profile.registries).map((id) => [id, []]));
  context = { profile, registries, registryExtraction: registryRecordsToExtraction(registries, profile) };
});
afterAll(async () => { await pool.end(); });

async function clean(city: string) {
  const ids = (await db.select({ id: graphNodes.id }).from(graphNodes)
    .where(eq(graphNodes.citySlug, city))).map((row) => row.id);
  if (ids.length) await db.delete(graphEdges).where(or(inArray(graphEdges.srcId, ids), inArray(graphEdges.dstId, ids)));
  await db.delete(graphNodes).where(eq(graphNodes.citySlug, city));
}

async function fixture(city: string, afterGeneration?: () => Promise<void>, withEvent = false) {
  const sourceId = `proces-verbaux-${city}`;
  const bytes = new TextEncoder().encode(`%PDF refresh ${city}`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `raw/${sourceId}/cas/${sha}.pdf`;
  const url = `https://example.test/${city}.pdf`;
  await store.put(key, bytes, "application/pdf");
  await store.put(`${key}.meta.json`, JSON.stringify({ sourceUrl: url }), "application/json");
  await store.putCanonicalGraph(canonicalGraphKey(city), JSON.stringify({ nodes: [], edges: [] }),
    "application/json", { ifMatch: null });
  const extraction: Extraction = { nodes: [{ id: `${city}:signal`, label: "Adoption du règlement 26-956-2",
    file_type: "document", source_file: key, node_type: "Signal", status: "candidate",
    resolution: "26.08.22.1", etape: "adoption", etape_date: "2026-08-18",
    reglement_number: "26-956-2", citations: [{ source_file: key, rawRef: key, sourceUrl: url,
      docSha: sha, modality: "pdf", page: 3, excerpt: "adopte le règlement 26-956-2" }] }],
    edges: [], input_tokens: 10, output_tokens: 10 };
  if (withEvent) {
    const signal = extraction.nodes[0]!;
    extraction.nodes.push({ ...signal, id: `${city}:event`, node_type: "DesignationEvent" });
    extraction.evidence = [{ id: "ev-1", source_file: key, rawRef: key, sourceUrl: url,
      docSha: sha, modality: "pdf", page: 3, excerpt: "adopte le règlement 26-956-2" }];
    extraction.edges.push({ source: `${city}:event`, target: signal.id, relation: "raises_signal",
      confidence: "EXTRACTED", source_file: key, citations: signal.citations!, evidence_refs: ["ev-1"] });
  }
  let calls = 0;
  const textClient = { mode: "mesh", provider: "test", model: "test",
    async generateJson(input) {
      calls += 1;
      const body = JSON.stringify(extraction);
      await input.validateResponse?.(body);
      if (input.outputPath) {
        await mkdir(dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, body);
      }
      await afterGeneration?.();
      return { status: "completed", provider: "test", mode: "mesh", outputPath: input.outputPath!, audit: {} } as const;
    } } satisfies TextJsonGenerationClient;
  const acquire: NonNullable<RunPvRefreshOptions["acquire"]> = async () => [{
    city, sourceId, status: "seen", casKeys: [key], count: 1,
  }];
  return { sha, textClient, acquire, calls: () => calls };
}

function options(city: string, fx: Awaited<ReturnType<typeof fixture>>, targetDb: Database): RunPvRefreshOptions {
  return { citySlug: city, store, db: targetDb, profileContext: context, textClient: fx.textClient,
    extractPdf: async () => `first\fsecond\fadopte le règlement 26-956-2\f`,
    profileHash: "sha256:profile", registryHash: "sha256:registry", packageVersion: "0.18.0",
    modelPolicy: "test", budgetLimit: 100, maximumAttempts: 2, maxOutputTokens: 512,
    acquire: fx.acquire };
}

describe("refresh 0.18 real storage integration", () => {
  it.each(["accepted", "quality", "quota"] as const)(
    "should append one metadata outcome per submitted document, including refusal (%s)", async (outcome) => {
      const city = `refresh-outcome-${randomUUID()}`;
      const fx = await fixture(city);
      const cycleId = randomUUID();
      const sensitive = "private-document-content-and-upstream-secret";
      const policy = () => createRefreshModelPolicy({
        primary: { provider: "openai", model: "gpt-6-astra", effort: "medium" },
        fallback: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
        timeoutMs: 1000, forceFallback: false, primaryQualityAttempts: 2,
        createClient(model) {
          return { ...fx.textClient, async generateJson(input) {
            if (outcome === "quota") throw Object.assign(new Error(sensitive), { status: 429 });
            if (outcome === "quality") await input.validateResponse?.(JSON.stringify({ text: sensitive }));
            return { ...await fx.textClient.generateJson(input), provider: model.provider, model: model.model };
          } };
        },
      });
      const configured = { ...options(city, fx, db), cycleId, maximumAttempts: 1 };
      const run = () => runPvRefresh({ ...configured, documentModels: policy() });
      try {
        if (outcome === "accepted") await run();
        else await expect(run()).rejects.toThrow();
        const rows = await db.select().from(refreshDocumentOutcomes).where(eq(refreshDocumentOutcomes.cycleId, cycleId));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ cycleId, documentSha: fx.sha, citySlug: city, pageCount: 3,
          status: outcome === "accepted" ? "accepted" : "refused",
          failureReason: outcome === "accepted" ? null : outcome,
          provider: outcome === "accepted" ? "openai" : "gemini",
          model: outcome === "accepted" ? "gpt-6-astra" : "gemini-3.8-flash",
          transition: outcome === "accepted" ? "primary" : "fallback",
          attempts: outcome === "accepted" ? 1 : outcome === "quality" ? 3 : 2,
          unknownIds: 0, keptNoValidDecision: 0, supportedUngrounded: 0,
          actsJudged: 0, actsRemoved: 0, skippedFallback: 0 });
        expect(rows[0]!.createdAt).toBeInstanceOf(Date);
        expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
        expect(JSON.stringify(rows)).not.toContain(sensitive);
        expect(JSON.stringify(rows)).not.toContain("adopte le règlement");
        // Cached success is not resubmitted; an explicit retry of a refusal appends a new row.
        if (outcome === "accepted") await run();
        else await expect(run()).rejects.toThrow();
        const repeated = await db.select().from(refreshDocumentOutcomes).where(eq(refreshDocumentOutcomes.cycleId, cycleId));
        expect(repeated).toHaveLength(outcome === "accepted" ? 1 : 2);
        expect(repeated.find(({ id }) => id === rows[0]!.id)).toEqual(rows[0]);
        if (outcome !== "accepted") expect(repeated.find(({ id }) => id !== rows[0]!.id)?.attempts).toBe(1);
      } finally { await clean(city); }
    }, 60_000);

  it.each([false, true])("persists verification and resumes the filtered chunk without another call (failure=%s)", async (fail) => {
    const city = `refresh-verify-${randomUUID()}`;
    const fx = await fixture(city, undefined, true);
    let verifyCalls = 0;
    const documentModels = createRefreshModelPolicy({
      primary: { provider: "openai", model: "gpt-6-astra", effort: "medium" },
      fallback: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
      verification: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
      timeoutMs: 1000, forceFallback: false, primaryQualityAttempts: 2,
      createClient(model) {
        return { ...fx.textClient, async generateJson(input) {
          if (model.provider === "openai") {
            return { ...await fx.textClient.generateJson(input), provider: model.provider, model: model.model };
          }
          verifyCalls++;
          await input.validateResponse?.(fail ? "not JSON" : JSON.stringify({ decisions: [
            { act: "A01", verdict: "non_soutenu", reason: "Historical reference only", excerpt: "" },
          ] }));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        } };
      },
    });
    const configured = { ...options(city, fx, db), maximumAttempts: 1, budgetLimit: 4, documentModels };
    try {
      await expect(runPvRefresh({ ...configured, budgetLimit: 3, profileHash: "sha256:budget-test" }))
        .rejects.toThrow("Refresh call budget exhausted");
      expect(fx.calls()).toBe(0);
      const result = await runPvRefresh(configured);
      const state = JSON.parse(new TextDecoder().decode(await store.get(result.stateKey)));
      expect(state.reservedCalls).toBe(4);
      expect(state.documentModels[fx.sha]).toMatchObject([
        { transition: "primary", attempt: 1 },
        { transition: "verification", attempt: 2, status: fail ? "failed" : "completed" },
      ]);
      const completed = Object.values(state.completedChunks)[0] as { key: string };
      const output = JSON.parse(new TextDecoder().decode(await store.get(completed.key)));
      expect(output.extraction.nodes).toHaveLength(fail ? 2 : 0);
      expect(output.extraction.edges).toHaveLength(fail ? 1 : 0);
      const outcomes = await db.select().from(refreshDocumentOutcomes).where(eq(refreshDocumentOutcomes.citySlug, city));
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ status: "accepted", pageCount: 3, attempts: 2,
        model: "gpt-6-astra", transition: "primary", failureReason: fail ? "quality" : null,
        actsJudged: fail ? 0 : 1, actsRemoved: fail ? 0 : 1 });
      expect((await subgraphForCity(db, city)).nodes).toHaveLength(fail ? 2 : 0);
      await runPvRefresh(configured);
      expect(fx.calls()).toBe(1);
      expect(verifyCalls).toBe(1);
    } finally { await clean(city); }
  }, 60_000);

  it("restores Astra for an incomplete multichunk document after a process restart", async () => {
    const city = `refresh-resume-${randomUUID()}`;
    const fx = await fixture(city);
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const policy = () => createRefreshModelPolicy({
      primary: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
      fallback: { provider: "openai", model: "gpt-6-astra", effort: "low" },
      timeoutMs: 1000, forceFallback: false, primaryQualityAttempts: 2,
      createClient(model) {
        return { mode: "mesh", provider: model.provider, model: model.model, async generateJson(input) {
          if (model.provider === "gemini") {
            primaryCalls++;
            throw Object.assign(new Error("quota"), { status: 429 });
          }
          if (++fallbackCalls === 2) throw new Error("injected interruption");
          await input.validateResponse?.(JSON.stringify({ nodes: [], edges: [], input_tokens: 1, output_tokens: 1 }));
          return { status: "completed", mode: "mesh", provider: model.provider, model: model.model, audit: {} };
        } };
      },
    });
    const configured = { ...options(city, fx, db), maximumAttempts: 1,
      extractPdf: async () => `${"a".repeat(110_000)}\f${"b".repeat(110_000)}` };
    try {
      await expect(runPvRefresh({ ...configured, documentModels: policy() })).rejects.toThrow("injected interruption");
      const result = await runPvRefresh({ ...configured, documentModels: policy() });
      const state = JSON.parse(new TextDecoder().decode(await store.get(result.stateKey)));
      expect(Object.keys(state.completedChunks)).toHaveLength(2);
      expect(state.reservedCalls).toBe(9);
      expect(primaryCalls).toBe(1);
      expect(fallbackCalls).toBe(3);
      const outcomes = await db.select().from(refreshDocumentOutcomes).where(eq(refreshDocumentOutcomes.citySlug, city));
      expect(outcomes).toHaveLength(2);
      expect(outcomes.find(({ status }) => status === "refused")).toMatchObject({
        pageCount: 2, attempts: 3, failureReason: "transport", skippedFallback: 1 });
      expect(outcomes.find(({ status }) => status === "accepted")).toMatchObject({
        pageCount: 2, attempts: 1, failureReason: null, skippedFallback: 1 });
      expect(state.documentModels[fx.sha].at(-1)).toMatchObject({
        modelUsed: { model: "gpt-6-astra" }, status: "completed", fallbackReason: "quota",
      });
    } finally { await clean(city); }
  }, 60_000);

  it("persists fallback model receipts and budget before resuming without generation", async () => {
    const city = `refresh-astra-${randomUUID()}`;
    const fx = await fixture(city);
    let primaryCalls = 0;
    const documentModels = createRefreshModelPolicy({
      primary: { provider: "gemini", model: "gemini-3.8-flash", effort: "low" },
      fallback: { provider: "openai", model: "gpt-6-astra", effort: "low" },
      timeoutMs: 1000, forceFallback: false, primaryQualityAttempts: 2,
      createClient(model) {
        if (model.provider === "openai") return { ...fx.textClient, async generateJson(input) {
          return { ...await fx.textClient.generateJson(input), provider: model.provider, model: model.model };
        } };
        return { ...fx.textClient, async generateJson() {
          primaryCalls++;
          throw Object.assign(new Error("quota"), { status: 429 });
        } };
      },
    });
    const configured = { ...options(city, fx, db), maximumAttempts: 1, documentModels };
    try {
      const result = await runPvRefresh(configured);
      const state = JSON.parse(new TextDecoder().decode(await store.get(result.stateKey)));
      expect(state.reservedCalls).toBe(3);
      expect(state.identity.modelPolicy).toBe(documentModels.policy);
      expect(state.documentModels[fx.sha]).toMatchObject([
        { modelUsed: { model: "gemini-3.8-flash", effort: "low" }, status: "failed", failureReason: "quota" },
        { modelUsed: { model: "gpt-6-astra", effort: "low" }, status: "completed", fallbackReason: "quota" },
      ]);
      await runPvRefresh(configured);
      expect(primaryCalls).toBe(1);
      expect(fx.calls()).toBe(1);
    } finally { await clean(city); }
  }, 60_000);

  it("resumes PG after S3 publication without a second model call", async () => {
    const city = `refresh-018-${randomUUID()}`;
    const fx = await fixture(city);
    const failingDb = { insert: db.insert.bind(db),
      select() { throw new Error("injected PG failure"); } } as unknown as Database;
    try {
      await expect(runPvRefresh(options(city, fx, failingDb))).rejects.toThrow("injected PG failure");
      expect(await store.head(canonicalGraphKey(city))).not.toBeNull();
      expect(fx.calls()).toBe(1);
      await expect(runPvRefresh(options(city, fx, db))).resolves.toMatchObject({ citySlug: city });
      expect(fx.calls()).toBe(1);
      const nodes = (await subgraphForCity(db, city)).nodes;
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.props).toMatchObject({ properties: { status: "candidate",
        resolution: "26.08.22.1", etape: "adoption", etape_date: "2026-08-18",
        reglement_number: "26-956-2" } });
    } finally { await clean(city); }
  }, 60_000);

  it("enforces the canonical guard and rejects a concurrent publisher", async () => {
    const city = `refresh-018-${randomUUID()}`;
    const key = canonicalGraphKey(city);
    const fx = await fixture(city, async () => {
      const current = await store.head(key);
      await store.putCanonicalGraph(key, JSON.stringify({ nodes: [{ id: `${city}:rival`,
        type: "Signal", label: "Concurrent signal" }], edges: [] }), "application/json",
      { ifMatch: current!.etag! });
    });
    await expect(store.put(key, "unguarded", "application/json"))
      .rejects.toThrow("refusing unguarded write");
    await expect(runPvRefresh(options(city, fx, db)))
      .rejects.toThrow("changed since it was read");
  }, 60_000);

  it("keeps the PG signal when its original PDF provenance would regress", async () => {
    const city = `refresh-018-${randomUUID()}`;
    const fx = await fixture(city);
    const oldSha = "f".repeat(64);
    await upsertGraphAtomic(db, city, { nodes: [{ id: `${city}:signal`, type: "Signal",
      label: "Existing complete signal", refs: [{ docSha: oldSha, rawRef: `raw/old/cas/${oldSha}.pdf`,
        excerpt: "existing proof", page: 1 }] }] });
    try {
      await expect(runPvRefresh(options(city, fx, db)))
        .rejects.toThrow("Postgres projection refused");
      const saved = (await subgraphForCity(db, city)).nodes[0]?.props as { refs?: { docSha?: string }[] };
      expect(saved.refs?.[0]?.docSha).toBe(oldSha);
    } finally { await clean(city); }
  }, 60_000);

  it("advances to the next pending document instead of re-selecting the first row of the index",
    async () => {
      // The bug this branch fixes: a city whose index page lists several minutes
      // stayed pinned on ONE of them, reported itself up to date, and never
      // extracted a newly published procès-verbal. Here the city offers two PDFs;
      // three consecutive cycles must take the newest, then the older, then stop.
      const city = `refresh-advance-${randomUUID()}`;
      const sourceId = `proces-verbaux-${city}`;
      const documents = [
        { label: "older", publishedAt: "2026-04-14" },
        { label: "newer", publishedAt: "2026-09-15" },
      ].map(({ label, publishedAt }) => {
        const bytes = new TextEncoder().encode(`%PDF refresh ${city} ${label}`);
        const sha = createHash("sha256").update(bytes).digest("hex");
        return { label, publishedAt, bytes, sha, key: `raw/${sourceId}/cas/${sha}.pdf`,
          url: `https://example.test/${city}-${label}.pdf` };
      });
      for (const document of documents) {
        await store.put(document.key, document.bytes, "application/pdf");
        await store.put(`${document.key}.meta.json`, JSON.stringify({ sourceUrl: document.url }),
          "application/json");
      }
      await store.putCanonicalGraph(canonicalGraphKey(city), JSON.stringify({ nodes: [], edges: [] }),
        "application/json", { ifMatch: null });

      const extracted: string[] = [];
      const textClient = { mode: "mesh", provider: "test", model: "test",
        async generateJson(input: Parameters<TextJsonGenerationClient["generateJson"]>[0]) {
          // The prompt carries the document text, which is how the test knows
          // WHICH document the cycle actually paid a model call for.
          const document = documents.find(({ label }) => JSON.stringify(input).includes(label))!;
          extracted.push(document.label);
          const extraction: Extraction = { nodes: [], edges: [], input_tokens: 1, output_tokens: 1 };
          const body = JSON.stringify(extraction);
          await input.validateResponse?.(body);
          if (input.outputPath) {
            await mkdir(dirname(input.outputPath), { recursive: true });
            await writeFile(input.outputPath, body);
          }
          return { status: "completed", provider: "test", mode: "mesh",
            outputPath: input.outputPath!, audit: {} } as const;
        } } satisfies TextJsonGenerationClient;

      // The index page lists its minutes OLDEST first — the order that made the
      // previous positional selection pick the wrong document every time.
      const configured: RunPvRefreshOptions = { citySlug: city, store, db, profileContext: context,
        textClient, extractPdf: async (bytes) => `${new TextDecoder().decode(bytes)}\f`,
        profileHash: "sha256:profile", registryHash: "sha256:registry", packageVersion: "0.18.0",
        modelPolicy: "test", budgetLimit: 100, maximumAttempts: 2, maxOutputTokens: 512,
        acquire: async () => [{ city, sourceId, status: "seen", count: documents.length,
          casKeys: documents.map(({ key }) => key),
          documents: documents.map(({ key, sha, publishedAt }) => ({
            casKey: key, sha256: sha, status: "seen" as const, publishedAt })) }] };

      try {
        const first = await runPvRefresh(configured);
        expect(first).toMatchObject({ status: "published", candidates: 2,
          documentSha: documents.find(({ label }) => label === "newer")!.sha });

        const second = await runPvRefresh(configured);
        expect(second).toMatchObject({ status: "published", candidates: 2,
          documentSha: documents.find(({ label }) => label === "older")!.sha });

        // Both documents are projected: the city settles instead of oscillating.
        const third = await runPvRefresh(configured);
        expect(third).toMatchObject({ status: "up-to-date", candidates: 2 });
        expect(extracted).toEqual(["newer", "older"]);

        const outcomes = await db.select().from(refreshDocumentOutcomes)
          .where(eq(refreshDocumentOutcomes.citySlug, city));
        expect(outcomes).toHaveLength(2);
        expect(outcomes.map(({ status }) => status)).toEqual(["accepted", "accepted"]);
      } finally { await clean(city); }
    }, 120_000);

  it("treats a skipped selected city as failure before model execution", async () => {
    const city = `refresh-018-${randomUUID()}`;
    const fx = await fixture(city);
    const skipped = { ...options(city, fx, db), acquire: async () => [] };
    await expect(runPvRefresh(skipped)).rejects.toThrow("Selected city acquisition failed");
    expect(fx.calls()).toBe(0);
  });
});

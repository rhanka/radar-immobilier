import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOntologyProfile, registryRecordsToExtraction,
  type Extraction, type TextJsonGenerationClient } from "@sentropic/graphify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb, type Database } from "../../src/db/client.js";
import { graphEdges, graphNodes } from "../../src/db/schema.js";
import { subgraphForCity } from "../../src/services/graph/graph-store.js";
import type { RefreshProfileContext } from "../../src/services/graph/refresh-profile.js";
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

async function fixture(city: string) {
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
      docSha: sha, modality: "pdf", page: 3, quote: "adopte le règlement 26-956-2" }] }],
    edges: [], input_tokens: 10, output_tokens: 10 };
  let calls = 0;
  const textClient = { mode: "mesh", provider: "test", model: "test",
    async generateJson(input) {
      calls += 1;
      const body = JSON.stringify(extraction);
      await input.validateResponse?.(body);
      await mkdir(dirname(input.outputPath!), { recursive: true });
      await writeFile(input.outputPath!, body);
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
  it("resumes PG after S3 publication without a second model call", async () => {
    const city = `refresh-018-${randomUUID()}`;
    const fx = await fixture(city);
    const failingDb = { select() { throw new Error("injected PG failure"); } } as unknown as Database;
    try {
      await expect(runPvRefresh(options(city, fx, failingDb))).rejects.toThrow("injected PG failure");
      expect(await store.head(canonicalGraphKey(city))).not.toBeNull();
      expect(fx.calls()).toBe(1);
      await expect(runPvRefresh(options(city, fx, db))).resolves.toMatchObject({ citySlug: city });
      expect(fx.calls()).toBe(1);
      expect((await subgraphForCity(db, city)).nodes).toHaveLength(1);
    } finally { await clean(city); }
  }, 60_000);
});

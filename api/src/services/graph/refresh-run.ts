import { createHash } from "node:crypto";

import { mergeExtractions, type TextJsonGenerationClient } from "@sentropic/graphify";

import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import {
  runLiveScrape,
  type LiveScrapeCityRecap,
  type RunLiveScrapeOptions,
} from "../sources/live-scrape.js";
import { readCanonicalCityGraph } from "./canonical-graph-writer.js";
import { graphifyGraphSchema, upsertGraphAtomic } from "./graph-store.js";
import { enrichGraphify34Snapshot } from "./graphify-34-enrichment.js";
import { applyGraphify34Snapshots, applyPlanKey, buildGraphify34Manifest,
  type Graphify34SnapshotStore } from "./graphify-34-snapshot.js";
import { materializeRefreshCorpus } from "./refresh-corpus.js";
import { extractRefreshProfile, type RefreshProfileChunk,
  type RefreshProfileContext } from "./refresh-profile.js";
import { canonicalHash } from "./replay/canonical-json.js";
import { extractionToV23Graph } from "./refresh-v23.js";
import { completeRefreshChunk, openRefreshState, readCompletedRefreshChunk,
  reserveRefreshChunk, writeRefreshCandidate, writeRefreshStageReceipt,
  type RefreshStage } from "./refresh-state.js";

export type RefreshAcquire = (
  cities: readonly string[] | undefined,
  options: RunLiveScrapeOptions,
) => Promise<LiveScrapeCityRecap[]>;

export interface AcquireRefreshPdfOptions {
  readonly citySlug: string;
  readonly store: ObjectStore;
  readonly signal?: AbortSignal;
  readonly limit?: number;
  readonly acquire?: RefreshAcquire;
}

export interface RefreshPdfSelection {
  readonly manifestKey: string;
  readonly recap: LiveScrapeCityRecap;
}

const MANIFEST_HEADER = "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key";
const SHA256 = /^[0-9a-f]{64}$/;

/** Convert one successful existing RECUEIL result into C04's immutable PDF selection. */
export async function acquireRefreshPdfManifest(
  options: AcquireRefreshPdfOptions,
): Promise<RefreshPdfSelection> {
  const acquire = options.acquire ?? runLiveScrape;
  const recaps = await acquire([options.citySlug], {
    store: options.store,
    exploit: false,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  if (options.signal?.aborted) throw new Error("Refresh aborted after acquisition");
  const recap = recaps[0];
  if (recaps.length !== 1 || !recap || recap.city !== options.citySlug
    || recap.status === "error" || recap.count < 1 || recap.casKeys.length !== recap.count) {
    throw new Error(`Selected city acquisition failed: ${options.citySlug}`);
  }
  if (!recap.sourceId || /[\t\n]/.test(recap.sourceId)) {
    throw new Error(`Invalid selected source id: ${options.citySlug}`);
  }
  const prefix = `raw/${recap.sourceId}/cas/`;
  const rows = [...recap.casKeys].sort().map((key) => {
    const sha = key.startsWith(prefix) && key.endsWith(".pdf")
      ? key.slice(prefix.length, -4)
      : "";
    if (!SHA256.test(sha)) throw new Error(`Selected city input is not an exact PDF: ${key}`);
    return `${recap.sourceId}\t${recap.city}\t${sha}\t${key}\t${key}.meta.json`;
  });
  const body = `${MANIFEST_HEADER}\n${rows.join("\n")}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const manifestKey = `refresh/018/${options.citySlug}/inputs/${digest}.tsv`;
  await options.store.put(manifestKey, body, "text/tab-separated-values");
  return { manifestKey, recap };
}

export interface RunPvRefreshOptions {
  readonly citySlug: string;
  readonly store: Graphify34SnapshotStore & ObjectStore;
  readonly db: Database;
  readonly profileContext: RefreshProfileContext;
  readonly textClient: TextJsonGenerationClient;
  readonly extractPdf: (bytes: Uint8Array, sourceUrl: string) => Promise<string>;
  readonly profileHash: string;
  readonly registryHash: string;
  readonly packageVersion: string;
  readonly modelPolicy: string;
  readonly budgetLimit: number;
  readonly maximumAttempts: number;
  readonly maxOutputTokens: number;
  readonly acquisitionLimit?: number;
  readonly excludedNodeIds?: readonly string[];
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly acquire?: RefreshAcquire;
}

async function completeStage(store: ObjectStore, handle: Awaited<ReturnType<typeof openRefreshState>>,
  stage: RefreshStage, artifactHash: string, now: () => Date) {
  return writeRefreshStageReceipt(store, handle, {
    stage, status: "completed", artifactHash, recordedAt: now().toISOString(),
  });
}

function requireRunning(signal: AbortSignal | undefined, where: string): void {
  if (signal?.aborted) throw new Error(`Refresh aborted ${where}`);
}

/** One selected city: RECUEIL -> exact PDF -> profiled v2.3 -> 3.4 -> guarded S3 -> atomic PG. */
export async function runPvRefresh(options: RunPvRefreshOptions) {
  const now = options.now ?? (() => new Date());
  requireRunning(options.signal, "before acquisition");
  const selected = await acquireRefreshPdfManifest({ citySlug: options.citySlug,
    store: options.store, ...(options.signal ? { signal: options.signal } : {}),
    ...(options.acquire ? { acquire: options.acquire } : {}),
    ...(options.acquisitionLimit ? { limit: options.acquisitionLimit } : {}) });
  const corpus = await materializeRefreshCorpus({ citySlug: options.citySlug,
    manifestKey: selected.manifestKey, reader: options.store, extractPdf: options.extractPdf });
  const read = await readCanonicalCityGraph(options.store, options.citySlug, now);
  if (!read) throw new Error(`Missing canonical baseline for ${options.citySlug}`);
  const baseline = graphifyGraphSchema.parse(JSON.parse(new TextDecoder().decode(read.body)));
  let handle = await openRefreshState(options.store, {
    citySlug: options.citySlug, inputHash: `sha256:${corpus.inputHash}`,
    baselineHash: canonicalHash(baseline), profileHash: options.profileHash,
    registryHash: options.registryHash, packageVersion: options.packageVersion,
    modelPolicy: options.modelPolicy, exclusions: options.excludedNodeIds ?? [],
  }, options.budgetLimit, now);
  handle = await completeStage(options.store, handle, "corpus", `sha256:${corpus.inputHash}`, now);
  const profiled: RefreshProfileChunk[] = [];
  for (const chunk of corpus.chunks) {
    const reserved = await reserveRefreshChunk(options.store, handle, chunk.id, options.maximumAttempts);
    handle = reserved;
    if (!reserved.shouldCall) {
      profiled.push(await readCompletedRefreshChunk(options.store, handle, chunk.id));
      continue;
    }
    const result = (await extractRefreshProfile([chunk], { textClient: options.textClient,
      context: options.profileContext, maxOutputTokens: options.maxOutputTokens }))[0]!;
    handle = await completeRefreshChunk(options.store, handle, chunk.id, result);
    profiled.push(result);
  }
  const extraction = profiled.map((item) => item.extraction).reduce(mergeExtractions);
  handle = await completeStage(options.store, handle, "profile", canonicalHash(extraction), now);
  const candidate = extractionToV23Graph(extraction, { municipality: options.citySlug,
    generatedAt: handle.state.createdAt, documents: corpus.documents, baseline,
    excludedNodeIds: new Set(options.excludedNodeIds ?? []) });
  handle = await writeRefreshCandidate(options.store, handle, candidate);
  handle = await completeStage(options.store, handle, "candidate", canonicalHash(candidate), now);
  const { snapshot } = enrichGraphify34Snapshot(candidate, options.citySlug);
  const snapshotHash = canonicalHash(snapshot);
  handle = await completeStage(options.store, handle, "enriched", snapshotHash, now);
  const backupId = `refresh-018-${handle.state.identityHash.slice(7)}`;
  requireRunning(options.signal, "before publication");
  const resume = await options.store.head(applyPlanKey(backupId)) !== null;
  await applyGraphify34Snapshots(options.store, [{ municipality: options.citySlug, snapshot,
    manifest: buildGraphify34Manifest(options.citySlug, snapshot), readAnchor: read.anchor }],
  backupId, async (target) => {
    handle = await completeStage(options.store, handle, "published", snapshotHash, now);
    const failProjection = async (reason: string, message: string): Promise<never> => {
      handle = await writeRefreshStageReceipt(options.store, handle, { stage: "projected",
        status: "failed", reason, recordedAt: now().toISOString() });
      throw new Error(message);
    };
    if (options.signal?.aborted) await failProjection("aborted-before-projection",
      "Refresh aborted before projection");
    let projected;
    try { projected = await upsertGraphAtomic(options.db, options.citySlug, target.snapshot); }
    catch (error) {
      handle = await writeRefreshStageReceipt(options.store, handle, { stage: "projected",
        status: "failed", reason: "postgres-write-failed", recordedAt: now().toISOString() });
      throw error;
    }
    if (projected.aborted) await failProjection("postgres-regression-refused",
      `Postgres projection refused: ${projected.reason ?? "regression"}`);
    if (options.signal?.aborted) await failProjection("aborted-after-projection",
      "Refresh aborted after projection");
    handle = await completeStage(options.store, handle, "projected", snapshotHash, now);
  }, { resume, now });
  return { citySlug: options.citySlug, inputHash: corpus.inputHash,
    candidateHash: snapshotHash, stateKey: handle.key };
}

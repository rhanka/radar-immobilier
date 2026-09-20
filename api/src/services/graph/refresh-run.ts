import { createHash, randomUUID } from "node:crypto";

import { mergeExtractions, type TextJsonGenerationClient } from "@sentropic/graphify";

import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import {
  runLiveScrape,
  type LiveScrapeCityRecap,
  type RunLiveScrapeOptions,
} from "../sources/live-scrape.js";
import { readCanonicalCityGraph, type CanonicalReadAnchor } from "./canonical-graph-writer.js";
import { graphifyGraphSchema, upsertGraphAtomic } from "./graph-store.js";
import { enrichGraphify34Snapshot, type Graphify34Snapshot } from "./graphify-34-enrichment.js";
import { applyGraphify34Snapshots, applyPlanKey, buildGraphify34Manifest,
  type Graphify34SnapshotStore } from "./graphify-34-snapshot.js";
import { materializeRefreshCorpus } from "./refresh-corpus.js";
import { appendRefreshDocumentOutcome } from "./refresh-document-outcomes.js";
import type { RefreshDocumentModels, RefreshModelReceipt } from "./refresh-model-policy.js";
import { extractRefreshProfile, type RefreshProfileChunk,
  type RefreshProfileContext } from "./refresh-profile.js";
import { canonicalHash } from "./replay/canonical-json.js";
import { extractionToV23Graph } from "./refresh-v23.js";
import { completeRefreshChunk, findPublishedRefreshState, openRefreshState, readCompletedRefreshChunk,
  recordRefreshModel, reserveRefreshChunk, writeRefreshCandidate, writeRefreshStageReceipt,
  type RefreshStage, type RefreshStateHandle } from "./refresh-state.js";

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

/** Default two-second source pacing with the project-required ±300 ms jitter. */
export function refreshSourceDelayMs(random = Math.random): number {
  return 1_700 + Math.floor(random() * 601);
}

/**
 * Convert one existing RECUEIL result into C04's immutable PDF selection, or
 * report that the city has nothing new.
 *
 * THE DAILY CYCLE ONLY DOWNLOADS THE DIFFERENTIAL (owner, 2026-09-20: « on ne
 * telechaege que le differentiel sinon c pas un job d update »). The city's
 * index is read on every run — that is the check — and
 * `skipAlreadyCollectedUrls` keeps the run from fetching a document an earlier
 * run already stored. `radar-refresh-pv` is the only SCHEDULED cycle, so this is
 * where that rule has to hold; before, it re-downloaded the city's whole window
 * every night.
 *
 * `null` MEANS "UP TO DATE", AND THAT IS A SUCCESS. This function used to demand
 * `count >= 1` and throw otherwise, which encoded the idea that a run must
 * always come back with a document. For an update job that idea is simply false:
 * a night on which the municipality published nothing collects nothing, and
 * failing the Job for it would make the normal case an error. An index that
 * could NOT be read is a different thing, and still throws.
 */
export async function acquireRefreshPdfManifest(
  options: AcquireRefreshPdfOptions,
): Promise<RefreshPdfSelection | null> {
  const acquire = options.acquire ?? runLiveScrape;
  const recaps = await acquire([options.citySlug], {
    store: options.store,
    exploit: false,
    skipAlreadyCollectedUrls: true,
    acceptRef: (ref) => ref.contentType?.toLowerCase().startsWith("application/pdf") === true
      || /\.pdf(?:[?#]|$)/i.test(ref.url),
    beforeFetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, refreshSourceDelayMs()));
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  if (options.signal?.aborted) throw new Error("Refresh aborted after acquisition");
  const recap = recaps[0];
  // A genuine failure: no recap, the wrong city, an index that did not answer,
  // or a recap whose own invariant (`casKeys.length === count`) is broken.
  if (recaps.length !== 1 || !recap || recap.city !== options.citySlug
    || recap.status === "error" || recap.casKeys.length !== recap.count) {
    throw new Error(`Selected city acquisition failed: ${options.citySlug}`);
  }
  // The index answered and there was nothing to download. Up to date.
  if (recap.count === 0) return null;
  if (!recap.sourceId || /[\t\n]/.test(recap.sourceId)) {
    throw new Error(`Invalid selected source id: ${options.citySlug}`);
  }
  const prefix = `raw/${recap.sourceId}/cas/`;
  const acquired = recap.casKeys.map((key) => {
    const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : "";
    const match = suffix.match(/^([0-9a-f]{64})\.(pdf|html|txt)$/);
    if (!match || !SHA256.test(match[1]!)) {
      throw new Error(`Selected city input is not an exact CAS representation: ${key}`);
    }
    return { key, sha: match[1]!, extension: match[2]! };
  });
  const selectedPdf = acquired.find((entry) => entry.extension === "pdf");
  if (!selectedPdf) {
    throw new Error(`Selected city acquisition produced no exact PDF: ${options.citySlug}`);
  }
  const rows = [`${recap.sourceId}\t${recap.city}\t${selectedPdf.sha}\t${selectedPdf.key}`
    + `\t${selectedPdf.key}.meta.json`];
  const body = `${MANIFEST_HEADER}\n${rows.join("\n")}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const manifestKey = `refresh/018/${options.citySlug}/inputs/${digest}.tsv`;
  await options.store.put(manifestKey, body, "text/tab-separated-values");
  return { manifestKey, recap };
}

export interface RunPvRefreshOptions {
  readonly cycleId?: string;
  readonly citySlug: string;
  readonly store: Graphify34SnapshotStore & ObjectStore;
  readonly db: Database;
  readonly profileContext: RefreshProfileContext;
  readonly textClient?: TextJsonGenerationClient;
  readonly documentModels?: RefreshDocumentModels;
  readonly onModelReceipt?: (docSha: string, chunkId: string, receipt: RefreshModelReceipt) => void;
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

async function completeStage(store: ObjectStore, handle: RefreshStateHandle,
  stage: RefreshStage, artifactHash: string, now: () => Date) {
  return writeRefreshStageReceipt(store, handle, {
    stage, status: "completed", artifactHash, recordedAt: now().toISOString(),
  });
}

function requireRunning(signal: AbortSignal | undefined, where: string): void {
  if (signal?.aborted) throw new Error(`Refresh aborted ${where}`);
}

async function publishSnapshot(options: RunPvRefreshOptions, initial: RefreshStateHandle,
  snapshot: Graphify34Snapshot, readAnchor: CanonicalReadAnchor, now: () => Date) {
  let handle = initial;
  const snapshotHash = canonicalHash(snapshot);
  const backupId = `refresh-018-${handle.state.identityHash.slice(7)}`;
  requireRunning(options.signal, "before publication");
  const resume = await options.store.head(applyPlanKey(backupId)) !== null;
  await applyGraphify34Snapshots(options.store, [{ municipality: options.citySlug, snapshot,
    manifest: buildGraphify34Manifest(options.citySlug, snapshot), readAnchor }], backupId,
  async (target) => {
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
  return { citySlug: options.citySlug, candidateHash: snapshotHash, stateKey: handle.key };
}

/** One selected city: RECUEIL -> exact PDF -> profiled v2.3 -> 3.4 -> guarded S3 -> atomic PG. */
export async function runPvRefresh(options: RunPvRefreshOptions) {
  const now = options.now ?? (() => new Date());
  const cycleId = options.cycleId ?? randomUUID();
  requireRunning(options.signal, "before acquisition");
  const selected = await acquireRefreshPdfManifest({ citySlug: options.citySlug,
    store: options.store, ...(options.signal ? { signal: options.signal } : {}),
    ...(options.acquire ? { acquire: options.acquire } : {}),
    ...(options.acquisitionLimit ? { limit: options.acquisitionLimit } : {}) });
  // UP TO DATE: the index answered and published nothing this city does not
  // already have. There is no corpus to materialise, no model to call, no
  // snapshot to publish and no projection to make — the graph on file already
  // describes every document in storage. Returning here is the cheap, expected
  // path of an update cycle, and it costs exactly one index request.
  if (!selected) {
    return { cycleId, citySlug: options.citySlug, upToDate: true as const };
  }
  const corpus = await materializeRefreshCorpus({ citySlug: options.citySlug,
    manifestKey: selected.manifestKey, reader: options.store, extractPdf: options.extractPdf });
  const read = await readCanonicalCityGraph(options.store, options.citySlug, now);
  if (!read) throw new Error(`Missing canonical baseline for ${options.citySlug}`);
  const baselineJson: unknown = JSON.parse(new TextDecoder().decode(read.body));
  const baseline = graphifyGraphSchema.parse(baselineJson);
  const baselineHash = canonicalHash(baseline);
  const scope = {
    citySlug: options.citySlug, inputHash: `sha256:${corpus.inputHash}`,
    profileHash: options.profileHash, registryHash: options.registryHash, packageVersion: options.packageVersion,
    modelPolicy: options.documentModels?.policy ?? options.modelPolicy, exclusions: options.excludedNodeIds ?? [],
  };
  const prior = await findPublishedRefreshState(options.store, { ...scope, publishedHash: baselineHash });
  if (prior?.state.receipts.projected?.status === "completed") {
    return { cycleId, citySlug: options.citySlug, inputHash: corpus.inputHash,
      candidateHash: baselineHash, stateKey: prior.key };
  }
  if (prior) {
    const resumed = baselineJson as Graphify34Snapshot;
    if (canonicalHash(resumed) !== baselineHash) throw new Error("Published refresh state no longer matches canonical bytes");
    return { ...await publishSnapshot(options, prior, resumed, read.anchor, now), cycleId, inputHash: corpus.inputHash };
  }
  let handle = await openRefreshState(options.store, { ...scope, baselineHash }, options.budgetLimit, now);
  handle = await completeStage(options.store, handle, "corpus", `sha256:${corpus.inputHash}`, now);
  for (const [docSha, receipts] of Object.entries(handle.state.documentModels ?? {})) {
    options.documentModels?.restoreDocument(docSha, receipts);
  }
  const profiled: RefreshProfileChunk[] = [];
  for (const document of corpus.documents) {
    const receipts: RefreshModelReceipt[] = [];
    let submittedAt: Date | undefined;
    let attempts = 0;
    let accepted = false;
    let failure: unknown;
    try {
      for (const chunk of document.chunks) {
        const reserved = await reserveRefreshChunk(options.store, handle, chunk.id,
          options.maximumAttempts * (options.documentModels?.maximumAttempts ?? 1));
        handle = reserved;
        if (!reserved.shouldCall) {
          profiled.push(await readCompletedRefreshChunk(options.store, handle, chunk.id));
          continue;
        }
        const record = async (receipt: RefreshModelReceipt) => {
          receipts.push(receipt);
          handle = await recordRefreshModel(options.store, handle, chunk.docSha, chunk.id, receipt);
          options.onModelReceipt?.(chunk.docSha, chunk.id, receipt);
        };
        const client = options.documentModels?.forDocument(chunk.docSha, record) ?? options.textClient;
        if (!client) throw new Error("Refresh requires a text client or document model policy");
        const textClient: TextJsonGenerationClient = { ...client, generateJson(input) {
          submittedAt ??= now();
          attempts++;
          return client.generateJson(input);
        } };
        const extracted = (await extractRefreshProfile([chunk], { textClient,
          context: options.profileContext, maxOutputTokens: options.maxOutputTokens }))[0]!;
        const result = await options.documentModels?.verify(extracted, options.maxOutputTokens, record) ?? extracted;
        handle = await completeRefreshChunk(options.store, handle, chunk.id, result);
        profiled.push(result);
      }
      options.documentModels?.completeDocument(document.sha256);
      accepted = true;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // Cache-only resumes are not submissions. One INSERT covers all new chunks/retries,
      // including a refused document; receipts from earlier cycles are never counted again.
      if (submittedAt) await appendRefreshDocumentOutcome(options.db, {
        cycleId, document, createdAt: submittedAt, latencyMs: Math.max(0, now().getTime() - submittedAt.getTime()),
        receipts, attempts, accepted, error: failure,
      });
    }
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
  return { ...await publishSnapshot(options, handle, snapshot, read.anchor, now),
    cycleId, inputHash: corpus.inputHash };
}

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
import { materializeRefreshCorpus, refreshCorpusInputHash } from "./refresh-corpus.js";
import { appendRefreshDocumentOutcome } from "./refresh-document-outcomes.js";
import type { RefreshDocumentModels, RefreshModelReceipt } from "./refresh-model-policy.js";
import { extractRefreshProfile, type RefreshProfileChunk,
  type RefreshProfileContext } from "./refresh-profile.js";
import { canonicalHash } from "./replay/canonical-json.js";
import { extractionToV23Graph } from "./refresh-v23.js";
import { completeRefreshChunk, matchProjectedRefreshState, matchPublishedRefreshState, openRefreshState,
  readCompletedRefreshChunk, readRefreshStates, recordRefreshModel, reserveRefreshChunk, writeRefreshCandidate,
  writeRefreshStageReceipt, type RefreshStage, type RefreshStateHandle } from "./refresh-state.js";

export type RefreshAcquire = (
  cities: readonly string[] | undefined,
  options: RunLiveScrapeOptions,
) => Promise<LiveScrapeCityRecap[]>;

export interface AcquireRefreshPdfOptions {
  readonly citySlug: string;
  readonly store: ObjectStore;
  readonly signal?: AbortSignal;
  readonly limit?: number;
  /**
   * Source look-back, in days. It is the dominant cost of a whole-list sweep:
   * RECUEIL fetches EVERY document inside the window on every run — an existing
   * one is HEAD-skipped, but only after its bytes have been downloaded and its
   * two-second pacing paid. A daily refresh only needs a window wide enough to
   * cover the delay between a council session and the publication of its
   * minutes; the adapter's own six-month default is sized for a bulk backfill.
   */
  readonly windowDays?: number;
  readonly acquire?: RefreshAcquire;
}

/** One exact-PDF representation a city offers this cycle, before any choice is made. */
export interface RefreshPdfCandidate {
  readonly sourceId: string;
  readonly citySlug: string;
  readonly sha: string;
  readonly representationKey: string;
  readonly sidecarKey: string;
  /** Source publication date, when the index exposes one. */
  readonly publishedAt?: string;
  /** Identity of the one-document input set this candidate would form. */
  readonly inputHash: string;
}

const MANIFEST_HEADER = "source_id\tcity_slug\tsha\trepresentation_key\tsidecar_key";
const SHA256 = /^[0-9a-f]{64}$/;

/** Attach a stable reason code without changing the message an existing test asserts. */
function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Default two-second source pacing with the project-required ±300 ms jitter. */
export function refreshSourceDelayMs(random = Math.random): number {
  return 1_700 + Math.floor(random() * 601);
}

/**
 * Every exact-PDF representation this city offers, in the order the cycle should
 * try them: most recently published first, then the source's own index order for
 * the documents it dates identically or not at all.
 *
 * The cycle processes ONE document, so the order IS the product behaviour. The
 * previous code took `casKeys[0]`, which is the first row of the index page and
 * never moves: a city whose index lists six months of minutes kept re-selecting
 * the same already-published document on every run, so a freshly published
 * procès-verbal was never extracted. Sorting by publication date makes the newest
 * document win regardless of how a given municipality orders its page, and the
 * caller skips the ones already published so the run always advances.
 */
export function orderRefreshPdfCandidates(recap: LiveScrapeCityRecap): RefreshPdfCandidate[] {
  const prefix = `raw/${recap.sourceId}/cas/`;
  const dated = new Map(
    (recap.documents ?? []).map((document) => [document.casKey, document.publishedAt]),
  );
  const candidates = recap.casKeys.map((key) => {
    const suffix = key.startsWith(prefix) ? key.slice(prefix.length) : "";
    const match = suffix.match(/^([0-9a-f]{64})\.(pdf|html|txt)$/);
    if (!match || !SHA256.test(match[1]!)) {
      throw new Error(`Selected city input is not an exact CAS representation: ${key}`);
    }
    const publishedAt = dated.get(key);
    const candidate = {
      sourceId: recap.sourceId, citySlug: recap.city, sha: match[1]!,
      representationKey: key, sidecarKey: `${key}.meta.json`,
      ...(typeof publishedAt === "string" ? { publishedAt } : {}),
    };
    return { extension: match[2]!, candidate: { ...candidate,
      inputHash: refreshCorpusInputHash([{ ...candidate, sha256: candidate.sha }]) } };
  }).filter((entry) => entry.extension === "pdf").map((entry) => entry.candidate);
  // Array.prototype.sort is stable, so undated documents keep the index order.
  return candidates.sort((a, b) => {
    if (a.publishedAt === b.publishedAt) return 0;
    if (a.publishedAt === undefined) return 1;
    if (b.publishedAt === undefined) return -1;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

/** RECUEIL for one city, validated, with its exact-PDF candidates in selection order. */
export async function acquireRefreshPdfCandidates(
  options: AcquireRefreshPdfOptions,
): Promise<{ recap: LiveScrapeCityRecap; candidates: RefreshPdfCandidate[] }> {
  const acquire = options.acquire ?? runLiveScrape;
  const recaps = await acquire([options.citySlug], {
    store: options.store,
    exploit: false,
    acceptRef: (ref) => ref.contentType?.toLowerCase().startsWith("application/pdf") === true
      || /\.pdf(?:[?#]|$)/i.test(ref.url),
    beforeFetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, refreshSourceDelayMs()));
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.windowDays !== undefined ? { windowDays: options.windowDays } : {}),
  });
  if (options.signal?.aborted) throw new Error("Refresh aborted after acquisition");
  const recap = recaps[0];
  if (recaps.length !== 1 || !recap || recap.city !== options.citySlug
    || recap.status === "error" || recap.count < 1 || recap.casKeys.length !== recap.count) {
    throw coded(`Selected city acquisition failed: ${options.citySlug}`, "REFRESH_NO_ACQUISITION");
  }
  if (!recap.sourceId || /[\t\n]/.test(recap.sourceId)) {
    throw new Error(`Invalid selected source id: ${options.citySlug}`);
  }
  const candidates = orderRefreshPdfCandidates(recap);
  if (candidates.length === 0) {
    throw coded(`Selected city acquisition produced no exact PDF: ${options.citySlug}`, "REFRESH_NO_PDF");
  }
  return { recap, candidates };
}

/** Freeze one chosen candidate into C04's immutable, content-addressed input manifest. */
export async function writeRefreshPdfManifest(
  store: ObjectStore,
  candidate: RefreshPdfCandidate,
): Promise<string> {
  const rows = [`${candidate.sourceId}\t${candidate.citySlug}\t${candidate.sha}`
    + `\t${candidate.representationKey}\t${candidate.sidecarKey}`];
  const body = `${MANIFEST_HEADER}\n${rows.join("\n")}\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  const manifestKey = `refresh/018/${candidate.citySlug}/inputs/${digest}.tsv`;
  await store.put(manifestKey, body, "text/tab-separated-values");
  return manifestKey;
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
  /** Source look-back in days; see {@link AcquireRefreshPdfOptions.windowDays}. */
  readonly acquisitionWindowDays?: number;
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
  const { candidates } = await acquireRefreshPdfCandidates({ citySlug: options.citySlug,
    store: options.store, ...(options.signal ? { signal: options.signal } : {}),
    ...(options.acquire ? { acquire: options.acquire } : {}),
    ...(options.acquisitionLimit ? { limit: options.acquisitionLimit } : {}),
    ...(options.acquisitionWindowDays ? { windowDays: options.acquisitionWindowDays } : {}) });

  // The baseline is read BEFORE any extraction: it is half of the run identity,
  // so knowing it is what lets the cycle recognise an already-published document
  // and move on to the next one without paying for poppler or for a model call.
  const read = await readCanonicalCityGraph(options.store, options.citySlug, now);
  if (!read) throw coded(`Missing canonical baseline for ${options.citySlug}`, "REFRESH_NO_BASELINE");
  const baselineJson: unknown = JSON.parse(new TextDecoder().decode(read.body));
  const baseline = graphifyGraphSchema.parse(baselineJson);
  const baselineHash = canonicalHash(baseline);
  const scopeOf = (inputHash: string) => ({
    citySlug: options.citySlug, inputHash: `sha256:${inputHash}`,
    profileHash: options.profileHash, registryHash: options.registryHash, packageVersion: options.packageVersion,
    modelPolicy: options.documentModels?.policy ?? options.modelPolicy, exclusions: options.excludedNodeIds ?? [],
  });

  // Walk the candidates newest-first and stop on the first one whose signals have
  // not already reached Postgres. Everything skipped is the city's memory of what
  // does not need doing again; the first survivor is the one document this cycle
  // pays for. This is what makes a run ADVANCE: the previous code re-selected the
  // same first row of the index page on every run, so a city with a freshly
  // published procès-verbal reported itself up to date and produced nothing.
  const states = await readRefreshStates(options.store, options.citySlug);
  const examined = candidates.map((candidate) => ({ candidate,
    projected: matchProjectedRefreshState(states, scopeOf(candidate.inputHash)) }));
  const pending = examined.find((entry) => entry.projected === null);
  if (!pending) {
    const newest = examined[0]!;
    return { cycleId, citySlug: options.citySlug, inputHash: newest.candidate.inputHash,
      documentSha: newest.candidate.sha, candidates: candidates.length, status: "up-to-date" as const,
      candidateHash: baselineHash, stateKey: newest.projected!.key };
  }
  const selected = pending.candidate;
  const scope = scopeOf(selected.inputHash);
  // A run may have published its bytes and then failed to project them. When the
  // published bytes are still the canonical ones, finish the projection instead
  // of paying for the extraction a second time.
  const prior = matchPublishedRefreshState(states, { ...scope, publishedHash: baselineHash });
  const manifestKey = await writeRefreshPdfManifest(options.store, selected);
  if (prior) {
    const resumed = baselineJson as Graphify34Snapshot;
    if (canonicalHash(resumed) !== baselineHash) throw new Error("Published refresh state no longer matches canonical bytes");
    return { ...await publishSnapshot(options, prior, resumed, read.anchor, now), cycleId,
      inputHash: selected.inputHash, documentSha: selected.sha, candidates: candidates.length,
      status: "published" as const };
  }
  const corpus = await materializeRefreshCorpus({ citySlug: options.citySlug,
    manifestKey, reader: options.store, extractPdf: options.extractPdf });
  if (corpus.inputHash !== selected.inputHash) {
    throw new Error(`Refresh input identity diverged for ${options.citySlug}`);
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
        const result = await options.documentModels?.verify(extracted, options.maxOutputTokens, record,
          options.citySlug) ?? extracted;
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
    cycleId, inputHash: corpus.inputHash, documentSha: selected.sha,
    candidates: candidates.length, status: "published" as const };
}

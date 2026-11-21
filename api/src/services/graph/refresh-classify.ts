import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import type { RefreshDocumentModels, RefreshModel, RefreshModelReceipt } from "./refresh-model-policy.js";
import type { RefreshRunBudget } from "./refresh-run-budget.js";
import { buildNodeRow, graphifyGraphSchema, type GraphifyGraph } from "./graph-store.js";
import { applyPlanKey } from "./graphify-34-snapshot.js";
import { withinReannotationDeadline } from "./reannotate-deadline.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { createReannotationRepository, createUnclassifiedCityRepository } from "./reannotate-repository.js";
import { createReannotationClassifier, reannotationInputSha256, runReannotation } from "./reannotate-signals.js";
import { DEFAULT_REFRESH_CLASSIFY_RETRY_LIMIT, DEFAULT_REFRESH_CLASSIFY_RETRY_WINDOW_DAYS } from "./refresh-classify-config.js";
import type { SinglePassPrompt } from "./refresh-single-pass.js";
import { readCompletedRefreshChunk, type RefreshStateHandle } from "./refresh-state.js";
import { canonicalHash } from "./replay/canonical-json.js";

export interface RefreshClassification {
  prompt: SinglePassPrompt;
  models: RefreshDocumentModels;
  primary: RefreshModel;
  fallback: RefreshModel;
  concurrency: number;
  retryLimit?: number;
  retryWindowDays?: number;
  actTimeoutMs?: number;
  runTimeoutMs?: number;
  budget?: RefreshRunBudget;
  onReceipt?: (receipt: RefreshModelReceipt) => void;
}

/** Called only after durable publication/projection; never changes detection state or bytes. */
export async function classifyPublishedRefresh(options: {
  classification: RefreshClassification;
  db: Database; store: ObjectStore; handle: RefreshStateHandle;
  snapshot: GraphifyGraph;
  citySlug: string; pipelineRunId: string; now: Date; signal?: AbortSignal;
  attemptedNodeIds?: Set<string>;
  onNote?: (note: string, detail?: Record<string, unknown>) => void;
}): Promise<void> {
  // Include selection, evidence reads and cancellation in the isolation boundary.
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(options.classification.runTimeoutMs ?? 300_000),
      ...(options.signal ? [options.signal] : [])]);
    signal.throwIfAborted();
    // The immutable pre-publication archive also survives a projection resume.
    const backupId = `refresh-018-${options.handle.state.identityHash.slice(7)}`;
    const baseline = graphifyGraphSchema.parse(JSON.parse(new TextDecoder().decode(
      await withinReannotationDeadline(options.store.get(applyPlanKey(backupId)
        .replace("_apply-plan.json", `graph/${options.citySlug}/latest.json`)), signal))));
    if (canonicalHash(baseline) !== options.handle.state.identity.baselineHash) {
      throw new Error("Classification baseline hash mismatch");
    }
    const inputHash = (node: GraphifyGraph["nodes"][number]) => {
      const { id, type, label, props, sourceRef } = buildNodeRow(node, options.citySlug);
      return reannotationInputSha256({ citySlug: options.citySlug, id, type, label, props, sourceRef });
    };
    const before = new Map(baseline.nodes.map((node) => [node.id, inputHash(node)]));
    const changed = new Set(options.snapshot.nodes.filter((node) => before.get(node.id) !== inputHash(node))
      .map((node) => node.id));
    const nodeIds = new Set<string>();
    for (const id of Object.keys(options.handle.state.completedChunks)) {
      const chunk = await withinReannotationDeadline(
        readCompletedRefreshChunk<RefreshProfileChunk>(options.store, options.handle, id), signal);
      signal.throwIfAborted();
      for (const node of chunk.extraction.nodes) {
        if (changed.has(node.id) && (node.node_type === "Signal" || node.node_type === "DesignationEvent")) nodeIds.add(node.id);
      }
    }
    if (options.attemptedNodeIds) for (const id of nodeIds) options.attemptedNodeIds.add(id);
    const { prompt, models, primary, fallback, concurrency, actTimeoutMs, runTimeoutMs } = options.classification;
    const report = await runReannotation({ repository: createReannotationRepository(options.db,
      { citySlug: options.citySlug, nodeIds: [...nodeIds] }),
    prompt, primary, fallback, concurrency, changedInputOnly: true, apply: true,
    pipelineRunId: options.pipelineRunId, now: options.now,
    classify: createReannotationClassifier(models, prompt, options.classification.onReceipt),
    shouldStop: () => options.classification.budget?.haltedBy !== undefined,
    signal, ...(actTimeoutMs ? { actTimeoutMs } : {}), ...(runTimeoutMs ? { runTimeoutMs } : {}) });
    options.onNote?.("classification-completed", { ...report, failed: report.failures.length,
      ...(options.classification.budget?.haltedBy ? { haltedBy: options.classification.budget.haltedBy } : {}) });
  } catch {
    options.onNote?.("classification-failed", { failed: 1, pipelineRunId: options.pipelineRunId });
  }
}

/**
 * Retry Signals and DesignationEvents of one city in the current documentary-date window
 * that remain without a valid AI class (e.g. after quota, empty response or timeout).
 * Bounded per city and per pass; never rewrites manual or valid AI classes; never throws.
 */
export async function retryUnclassifiedRefreshSignals(options: {
  classification: RefreshClassification;
  db: Database;
  citySlug: string;
  pipelineRunId: string;
  now: Date;
  excludeNodeIds?: ReadonlySet<string>;
  signal?: AbortSignal;
  onNote?: (note: string, detail?: Record<string, unknown>) => void;
}): Promise<void> {
  const retryLimit = options.classification.retryLimit ?? DEFAULT_REFRESH_CLASSIFY_RETRY_LIMIT;
  const retryWindowDays = options.classification.retryWindowDays ?? DEFAULT_REFRESH_CLASSIFY_RETRY_WINDOW_DAYS;
  if (retryLimit <= 0) return;
  if (options.classification.budget?.haltedBy !== undefined
    || options.classification.models.fallbackQuotaExhausted()
    || options.classification.models.fallbackUnroutable()) {
    return;
  }
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(options.classification.runTimeoutMs ?? 300_000),
      ...(options.signal ? [options.signal] : [])]);
    signal.throwIfAborted();
    const windowFrom = new Date(options.now.getTime() - retryWindowDays * 86_400_000).toISOString().slice(0, 10);
    const { prompt, models, primary, fallback, concurrency, actTimeoutMs, runTimeoutMs } = options.classification;
    const report = await runReannotation({
      repository: createUnclassifiedCityRepository(options.db, {
        citySlug: options.citySlug,
        windowFrom,
        limit: retryLimit,
        ...(options.excludeNodeIds?.size ? { excludeNodeIds: [...options.excludeNodeIds] } : {}),
      }),
      prompt, primary, fallback, concurrency, missingOnly: true, apply: true,
      pipelineRunId: options.pipelineRunId, now: options.now,
      classify: createReannotationClassifier(models, prompt, options.classification.onReceipt),
      shouldStop: () => options.classification.budget?.haltedBy !== undefined
        || models.fallbackQuotaExhausted()
        || models.fallbackUnroutable(),
      signal, ...(actTimeoutMs ? { actTimeoutMs } : {}), ...(runTimeoutMs ? { runTimeoutMs } : {}),
    });
    if (report.candidates > 0 || report.failures.length > 0) {
      options.onNote?.("classification-retry-completed", {
        ...report,
        failed: report.failures.length,
        retryLimit,
        retryWindowDays,
        windowFrom,
        ...(options.classification.budget?.haltedBy ? { haltedBy: options.classification.budget.haltedBy } : {}),
      });
    }
  } catch {
    options.onNote?.("classification-retry-failed", { failed: 1, pipelineRunId: options.pipelineRunId });
  }
}

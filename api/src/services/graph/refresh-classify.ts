import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import type { RefreshDocumentModels, RefreshModel, RefreshModelReceipt } from "./refresh-model-policy.js";
import type { RefreshRunBudget } from "./refresh-run-budget.js";
import { buildNodeRow, graphifyGraphSchema, type GraphifyGraph } from "./graph-store.js";
import { applyPlanKey } from "./graphify-34-snapshot.js";
import { withinReannotationDeadline } from "./reannotate-deadline.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { createReannotationRepository } from "./reannotate-repository.js";
import { createReannotationClassifier, reannotationInputSha256, runReannotation } from "./reannotate-signals.js";
import type { SinglePassPrompt } from "./refresh-single-pass.js";
import { readCompletedRefreshChunk, type RefreshStateHandle } from "./refresh-state.js";
import { canonicalHash } from "./replay/canonical-json.js";

export interface RefreshClassification {
  prompt: SinglePassPrompt;
  models: RefreshDocumentModels;
  primary: RefreshModel;
  fallback: RefreshModel;
  concurrency: number;
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

import type { Database } from "../../db/client.js";
import type { ObjectStore } from "../../storage/object-store.js";
import type { RefreshDocumentModels, RefreshModel } from "./refresh-model-policy.js";
import type { RefreshProfileChunk } from "./refresh-profile.js";
import { createReannotationRepository } from "./reannotate-repository.js";
import { createReannotationClassifier, runReannotation } from "./reannotate-signals.js";
import type { SinglePassPrompt } from "./refresh-single-pass.js";
import { readCompletedRefreshChunk, type RefreshStateHandle } from "./refresh-state.js";

export interface RefreshClassification {
  prompt: SinglePassPrompt;
  models: RefreshDocumentModels;
  primary: RefreshModel;
  fallback: RefreshModel;
  concurrency: number;
}

/** Called only after durable publication/projection; never changes detection state or bytes. */
export async function classifyPublishedRefresh(options: {
  classification: RefreshClassification;
  db: Database; store: ObjectStore; handle: RefreshStateHandle;
  citySlug: string; pipelineRunId: string; now: Date; signal?: AbortSignal;
  onNote?: (note: string, detail?: Record<string, unknown>) => void;
}): Promise<void> {
  // Include selection, evidence reads and cancellation in the isolation boundary.
  try {
    const nodeIds = new Set<string>();
    for (const id of Object.keys(options.handle.state.completedChunks)) {
      const chunk = await readCompletedRefreshChunk<RefreshProfileChunk>(options.store, options.handle, id);
      for (const node of chunk.extraction.nodes) {
        if (node.node_type === "Signal" || node.node_type === "DesignationEvent") nodeIds.add(node.id);
      }
    }
    const { prompt, models, primary, fallback, concurrency } = options.classification;
    const report = await runReannotation({ repository: createReannotationRepository(options.db,
      { citySlug: options.citySlug, nodeIds: [...nodeIds] }),
    prompt, primary, fallback, concurrency, changedInputOnly: true, apply: true,
    pipelineRunId: options.pipelineRunId, now: options.now,
    classify: createReannotationClassifier(models, prompt),
    ...(options.signal ? { signal: options.signal } : {}) });
    options.onNote?.("classification-completed", { ...report, failed: report.failures.length });
  } catch {
    options.onNote?.("classification-failed", { failed: 1, pipelineRunId: options.pipelineRunId });
  }
}

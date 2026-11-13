import { fetchJsonWithTimeout, readJsonErrorCode, DEFAULT_REQUEST_TIMEOUT_MS } from "$lib/net/fetch-with-timeout.js";
import { GraphSignalsHttpError, scopedSignalFacetsPath, type GraphSignalNode, type SignalScope } from "./graph-signal-detail-client.js";
import type { ClassementEntry, SignalClass } from "./signal-classement.js";

export interface FeedbackChoice { verdict: "up" | "down"; nextClass?: SignalClass; reasonCode?: string; comment?: string }

export async function postClassFeedback(scope: SignalScope, node: GraphSignalNode, current: ClassementEntry, choice: FeedbackChoice) {
  const ai = node.classAnnotation;
  if (!ai || ai.source !== "ai" || !ai.updatedAt || !node.citySlug || !node.facetFingerprint) {
    throw new Error("annotation_unavailable");
  }
  const result = await fetchJsonWithTimeout(scopedSignalFacetsPath(scope, "class-feedback"), {
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    init: { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ target: { citySlug: node.citySlug, type: node.type, id: node.id },
        displayedFingerprint: node.facetFingerprint, scope: "personal", ...choice,
        annotation: { source: "ai", model: ai.model, promptSha256: ai.promptSha256,
          pipelineRunId: ai.pipelineRunId, classe: ai.classe, updatedAt: ai.updatedAt },
        selectionHeads: { pertinent: current.pertinentExpectedHeadId ?? current.pertinentHeadId,
          a_surveiller: current.aSurveillerExpectedHeadId ?? current.aSurveillerHeadId },
        archives: { personal: current.archiveRestores.find((head) => head.scope === "personal")?.id ?? null,
          workspace: current.archiveRestores.find((head) => head.scope === "workspace")?.id ?? null },
      }) },
  });
  if (!result.ok) throw new GraphSignalsHttpError(`class feedback: ${result.status}`, result.status, readJsonErrorCode(result.json));
}

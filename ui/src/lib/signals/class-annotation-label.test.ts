import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import { classAnnotationLabel } from "./class-annotation-label.js";
import { withAiClassement, EMPTY_CLASSEMENT_ENTRY } from "./signal-classement.js";

const node: GraphSignalNode = { id: "one", type: "Signal", citySlug: "city", label: "Housing",
  sourceRef: null, createdAt: null, props: {}, classAnnotation: { source: "ai", classe: "pertinent",
    reason: "More housing", model: "gpt-6-astra", effort: "medium", promptId: "v1",
    promptSha256: "a".repeat(64), pipelineRunId: "run" } };

describe("class annotation provenance", () => {
  it("should identify the exact AI and prompt while prioritizing manual changes", () => {
    expect(classAnnotationLabel(node)).toBe("IA · GPT-6 Astra medium · prompt v1");
    expect(classAnnotationLabel(node, true)).toBe("Manuel");
    expect(classAnnotationLabel({ ...node, classAnnotation: undefined })).toBe("Manuel");
  });
  it("should apply the AI class only without human stream history", () => {
    expect(withAiClassement(new Map(), [node]).get("city:Signal:one")?.classe).toBe("pertinent");
    const human = { ...EMPTY_CLASSEMENT_ENTRY, classe: "non_classe" as const, pertinentExpectedHeadId: "manual" };
    expect(withAiClassement(new Map([["city:Signal:one", human]]), [node]).get("city:Signal:one")).toBe(human);
  });
});

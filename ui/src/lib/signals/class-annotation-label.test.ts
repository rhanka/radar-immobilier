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
    expect(classAnnotationLabel(node)).toBe("IA · gpt-6-astra medium · prompt v1");
    expect(classAnnotationLabel(node, true)).toBe("Manuel");
    expect(classAnnotationLabel({ ...node, classAnnotation: undefined })).toBe("Manuel");
  });
  it.each(["gemini-3.8-flash", "gemini-2.5-pro", "custom-model", null, ""])(
    "should show the exact model identifier or a generic unknown label for %s", (model) => {
      const label = classAnnotationLabel({ ...node, classAnnotation: { ...node.classAnnotation!, model } });
      expect(label).toBe(`IA · ${model || "modèle inconnu"} medium · prompt v1`);
    },
  );
  it("should apply the AI class only without human stream history", () => {
    expect(withAiClassement(new Map(), [node]).get("city:Signal:one")?.classe).toBe("pertinent");
    const human = { ...EMPTY_CLASSEMENT_ENTRY, classe: "non_classe" as const, pertinentExpectedHeadId: "manual" };
    expect(withAiClassement(new Map([["city:Signal:one", human]]), [node]).get("city:Signal:one")).toBe(human);
  });
});

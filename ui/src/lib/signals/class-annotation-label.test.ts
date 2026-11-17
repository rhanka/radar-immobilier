import { describe, expect, it } from "vitest";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import { classAnnotationLabel } from "./class-annotation-label.js";
import { withAiClassement, EMPTY_CLASSEMENT_ENTRY } from "./signal-classement.js";

const node: GraphSignalNode = { id: "one", type: "Signal", citySlug: "city", label: "Housing",
  sourceRef: null, createdAt: null, props: {}, classAnnotation: { source: "ai", classe: "pertinent",
    reason: "More housing", model: "gpt-6-astra", effort: "medium", promptId: "v1",
    promptSha256: "a".repeat(64), pipelineRunId: "run" } };

describe("class annotation provenance", () => {
  it("should display the update date and private human validation", () => {
    expect(classAnnotationLabel({ ...node, classAnnotation: { ...node.classAnnotation!, updatedAt: "2026-11-13T17:00:00Z" } })).toContain("2026-11-13");
    expect(classAnnotationLabel({ ...node, classFeedback: { verdict: "up", createdAt: "2026-11-13", reason: "validé", eventId: "event" } })).toBe("Validé par un humain");
    expect(classAnnotationLabel({ ...node, classFeedback: { verdict: "down", createdAt: "2026-11-13", reason: "N-NON-RES", eventId: "event" } })).toBe("Reclassé par un humain");
  });
  it("should show ambiguity only for the effective AI annotation", () => {
    const ambiguous = { ...node, classAnnotation: { ...node.classAnnotation!, ambiguous: true } };
    expect(classAnnotationLabel(ambiguous)).toBe("IA · ambigu · gpt-6-astra medium · prompt v1");
    expect(classAnnotationLabel(ambiguous, true)).toBe("Manuel");
    expect(classAnnotationLabel({ ...node, classAnnotation: { ...node.classAnnotation!, ambiguous: false } })).not.toContain("ambigu");
    expect(withAiClassement(new Map(), [{ ...node, classAnnotation: undefined }]).size).toBe(0);
  });
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

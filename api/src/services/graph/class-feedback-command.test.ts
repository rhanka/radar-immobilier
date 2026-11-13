import { describe, expect, it } from "vitest";
import { classFeedbackCommand } from "./class-feedback-command.js";

export const feedbackInput = {
  target: { citySlug: "synthetic-city", type: "Signal" as const, id: "signal" },
  displayedFingerprint: "a".repeat(64), scope: "personal" as const, verdict: "up" as "up" | "down",
  annotation: { source: "ai" as const, model: "gpt-6-astra", promptSha256: "a".repeat(64),
    pipelineRunId: "run-1", classe: "pertinent" as const, updatedAt: "2026-11-13T12:00:00Z" },
  selectionHeads: { pertinent: null, a_surveiller: null }, archives: { personal: null, workspace: null },
};
describe("class feedback validation", () => {
  it("should require another actionable class and reason for negative feedback", () => {
    for (const extra of [{}, { nextClass: "pertinent", reasonCode: "P-01" },
      { nextClass: "non_classe", reasonCode: "P-01" }, { nextClass: "ecarte" }]) {
      expect(classFeedbackCommand.safeParse({ ...feedbackInput, verdict: "down", ...extra }).success).toBe(false);
    }
    expect(classFeedbackCommand.safeParse({ ...feedbackInput, verdict: "down", nextClass: "ecarte", reasonCode: "N-01" }).success).toBe(true);
  });
  it("should validate positives without allowing a replacement class", () => {
    expect(classFeedbackCommand.safeParse(feedbackInput).success).toBe(true);
    expect(classFeedbackCommand.safeParse({ ...feedbackInput, nextClass: "ecarte" }).success).toBe(false);
  });
});

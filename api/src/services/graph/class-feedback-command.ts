import { z } from "zod";

const classe = z.enum(["pertinent", "a_surveiller", "ecarte", "non_classe"]);
const head = z.string().guid().nullable();
export const classFeedbackCommand = z.object({
  target: z.object({ citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
    type: z.enum(["Signal", "DesignationEvent"]), id: z.string().min(1).max(512) }).strict(),
  displayedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.enum(["personal", "workspace"]),
  verdict: z.enum(["up", "down"]),
  annotation: z.object({ source: z.literal("ai"), model: z.string().min(1),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/), pipelineRunId: z.string().min(1),
    classe, updatedAt: z.string().min(1) }).strict(),
  nextClass: classe.optional(), reasonCode: z.string().min(1).max(128).optional(),
  comment: z.string().trim().max(2000).optional(),
  selectionHeads: z.object({ pertinent: head, a_surveiller: head }).strict(),
  archives: z.object({ personal: head, workspace: head }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "down" && (!value.nextClass || value.nextClass === "non_classe"
    || value.nextClass === value.annotation.classe || !value.reasonCode)) {
    ctx.addIssue({ code: "custom", message: "reclassification_required" });
  }
  if (value.verdict === "up" && (value.nextClass !== undefined || value.reasonCode !== undefined)) {
    ctx.addIssue({ code: "custom", message: "invalid_positive_feedback" });
  }
  if (value.scope === "workspace" && (value.nextClass ?? value.annotation.classe) !== "ecarte") {
    ctx.addIssue({ code: "custom", message: "workspace_archive_only" });
  }
});
export type ClassFeedbackCommand = z.infer<typeof classFeedbackCommand> & { commandKey: string };

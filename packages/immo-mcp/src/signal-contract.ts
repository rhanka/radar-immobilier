import { z } from "zod";
import type { ToolDefinition } from "./tool-definitions.js";

export const SIGNAL_WRITE_SCOPE = "immo:signals:write";
export const signalRef = z.object({ workspaceId: z.string().guid(), scope: z.enum(["personal", "workspace"]),
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]), id: z.string().min(1).max(512) }).strict();
const classe = z.enum(["pertinent", "a_surveiller", "ecarte", "non_classe"]);
const model = z.string().trim().min(1).max(256);
const reason = z.string().trim().min(1).max(2000);
const reasonCode = z.string().min(1).max(128);
export const signalSchemas = {
  list_class_reasons: z.object({}).strict(),
  get_signal_classification: z.object({ signalRef }).strict(),
  classify_signal: z.object({ signalRef, classe, reasonCode, reason, model,
    humanConfirmed: z.boolean().optional() }).strict(),
  confirm_classification: z.object({ signalRef, verdict: z.enum(["up", "down"]), model,
    newClasse: classe.optional(), reasonCode: reasonCode.optional(), reason: reason.optional() }).strict(),
  annotate_signal: z.object({ signalRef, text: z.string().min(1).max(2000), model,
    humanConfirmed: z.boolean().optional() }).strict(),
};
export type SignalTool = keyof typeof signalSchemas;
export const isSignalWrite = (name: string) => ["classify_signal", "confirm_classification", "annotate_signal"].includes(name);
export const SIGNAL_TOOL_DEFINITIONS: readonly ToolDefinition[] = Object.entries(signalSchemas).map(([name, schema]) => ({
  name, title: name.replaceAll("_", " "),
  description: name === "classify_signal" ? "Classify a scoped signal. Human validation requires accepted MCP elicitation; the boolean only requests it. A registry reason and declared model are required."
    : name === "confirm_classification" ? "Confirm or reject the displayed class through human elicitation. Down requires a different class, registry code and reason."
      : name === "annotate_signal" ? "Append a scoped plain-text note (2000 characters max) with declared model and MCP provenance."
        : name === "list_class_reasons" ? "List four signal classes and all 28 registry reason codes with definitions."
          : "Read the effective scoped signal class, provenance, ambiguity, history, feedback and notes.",
  inputSchema: schema.shape, scope: isSignalWrite(name) ? SIGNAL_WRITE_SCOPE : "immo:read",
}));
export const SIGNAL_WRITE_ANNOTATIONS = Object.freeze({ readOnlyHint: false, destructiveHint: false,
  openWorldHint: false, idempotentHint: false });

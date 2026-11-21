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
  description: name === "classify_signal" ? "Classify a scoped signal. Without accepted elicitation, records automatic validation (mcp / auto). With accepted elicitation (humanConfirmed=true), records human validation with source tag mcp+elicitation and full elicitation trace. A registry reason and declared model are required. In scope \"workspace\", only classe \"ecarte\" is accepted (requires moderateArchive); classe \"non_classe\" requires human confirmation."
    : name === "confirm_classification" ? "Confirm or reclassify a signal through MCP elicitation. Accepted elicitation records human validation with source tag mcp+elicitation; declined or unsupported elicitation is refused. Down requires a different class, registry code and reason."
      : name === "annotate_signal" ? "Append a scoped plain-text note (2000 characters max) with declared model and MCP provenance."
        : name === "list_class_reasons" ? "List four signal classes and all 28 registry reason codes with definitions."
          : "Read the effective scoped signal class, provenance, ambiguity, feedback, notes, global AI history (history), and scoped MCP/manual journal (mcpHistory).",
  inputSchema: schema.shape, scope: isSignalWrite(name) ? SIGNAL_WRITE_SCOPE : "immo:read",
}));
export const SIGNAL_WRITE_ANNOTATIONS = Object.freeze({ readOnlyHint: false, destructiveHint: false,
  openWorldHint: false, idempotentHint: false });

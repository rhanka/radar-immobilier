/** Successor-only contracts; the exposed baseline definitions remain unchanged. */
import { z } from "zod";
import { ALL_TOOL_DEFINITIONS } from "../tool-definitions.js";
import { ARTIFACT_TOOL_NAMES } from "../registry/artifact-profile.js";
import { STATUS_TOOL_NAMES } from "./command-contracts.js";
import { FingerprintSchema, WorkspaceIdSchema } from "./wire-schemas.js";
import { SUCCESSOR_SEARCH_ENDPOINT } from "./successor-contract.js";

const baselineSearch = ALL_TOOL_DEFINITIONS.find((tool) => tool.name === "search_signals")!;
export const SuccessorSearchSignalsInputSchema = z.object({
  ...baselineSearch.inputSchema, workspaceId: WorkspaceIdSchema.optional(),
}).strict();
export const SUCCESSOR_SEARCH_RECEIVER = {
  ...SUCCESSOR_SEARCH_ENDPOINT, inputContract: "search_signals.status-v1",
  parameters: SuccessorSearchSignalsInputSchema,
  authorityBeforeRevealOrEmpty: true, arbitrary404IsEmpty: false,
} as const;
export const SUCCESSOR_TOOL_NAMES = [
  ...ALL_TOOL_DEFINITIONS.map((tool) => tool.name), ...ARTIFACT_TOOL_NAMES, ...STATUS_TOOL_NAMES,
] as const;
const checkpoint = (count: number) => z.object({
  toolCount: z.literal(count), digest: FingerprintSchema,
}).strict();
export const SuccessorManifestSchema = z.object({
  version: z.string().min(1), baseline: checkpoint(12), h4: checkpoint(16),
  successor: z.object({ toolCount: z.literal(22), digest: FingerprintSchema,
    definitionsVersion: z.string().min(1), capabilitiesVersion: z.string().min(1),
    handlersVersion: z.string().min(1), schemasVersion: z.string().min(1),
    searchSignalsContract: z.literal("search_signals.status-v1"),
    tools: z.array(z.object({ name: z.string().min(1), schemaDigest: FingerprintSchema,
      handlerDigest: FingerprintSchema, capabilities: z.array(z.string().min(1)).min(1),
    }).strict()).length(22),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const names = value.successor.tools.map((tool) => tool.name);
  if (new Set(names).size !== 22 || SUCCESSOR_TOOL_NAMES.some((name) => !names.includes(name))) {
    ctx.addIssue({ code: "custom", message: "Successor must preserve baseline, H4 and six status tools" });
  }
});

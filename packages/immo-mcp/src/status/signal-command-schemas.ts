import { z } from "zod";
import {
  BasketSchema, FingerprintSchema, HeadIdSchema, ReasonSchema, ScopeSchema,
  SignalTargetSchema, WorkspaceIdSchema,
} from "./wire-schemas.js";

const observed = { target: SignalTargetSchema, expectedHeadId: HeadIdSchema,
  displayedFingerprint: FingerprintSchema };
export const SignalCommandBodySchemas = {
  select: z.object({ ...observed, basket: BasketSchema, reasonCode: ReasonSchema.optional() }).strict(),
  deselect: z.object({ ...observed, basket: BasketSchema }).strict(),
  discard: z.object({ ...observed, reasonCode: ReasonSchema,
    deselect: z.array(BasketSchema).max(2).optional(),
    expectedSelectionHeads: z.object({ pertinent: HeadIdSchema.optional(),
      a_surveiller: HeadIdSchema.optional() }).strict().optional(),
  }).strict().superRefine((body, ctx) => {
    const removals = body.deselect ?? [];
    if (removals.length === 0) {
      if (body.expectedSelectionHeads !== undefined) {
        ctx.addIssue({ code: "custom", message: "Orphan selection expectations without removals" });
      }
      return;
    }
    const heads = Object.keys(body.expectedSelectionHeads ?? {});
    if (new Set(removals).size !== removals.length || removals.length !== heads.length
      || removals.some((key) => !heads.includes(key))) {
      ctx.addIssue({ code: "custom", message: "Every removed selection requires its observed head" });
    }
  }),
  restore: z.object(observed).strict(),
} as const;
const envelope = { workspaceId: WorkspaceIdSchema, scope: ScopeSchema,
  commandKey: z.string().guid() };
export const CommandSignalFacetInputSchema = z.union([
  z.object({ ...envelope, action: z.literal("select"), body: SignalCommandBodySchemas.select }).strict(),
  z.object({ ...envelope, action: z.literal("deselect"), body: SignalCommandBodySchemas.deselect }).strict(),
  z.object({ ...envelope, action: z.literal("discard"), body: SignalCommandBodySchemas.discard }).strict(),
  z.object({ ...envelope, action: z.literal("restore"), body: SignalCommandBodySchemas.restore }).strict(),
]).superRefine((input, ctx) => {
  if (input.scope === "common" && ["select", "deselect"].includes(input.action)) {
    ctx.addIssue({ code: "custom", message: "Common signal selections do not exist" });
  }
  if (input.scope === "common" && input.action === "discard"
    && (input.body.deselect !== undefined || input.body.expectedSelectionHeads !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Common signal discard cannot remove personal selections" });
  }
});
export type CommandSignalFacetInput = z.infer<typeof CommandSignalFacetInputSchema>;

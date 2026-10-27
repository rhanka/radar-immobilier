import { z } from "zod";
import { CitySchema, LotTargetSchema, ModeSchema, SignalTargetSchema,
  WorkspaceIdSchema } from "./wire-schemas.js";

export const GetFacetContextInputSchema = z.object({
  workspaceId: WorkspaceIdSchema.optional(),
}).strict();
const page = { workspaceId: WorkspaceIdSchema, city: CitySchema,
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(4096).optional(), reveal: z.boolean().optional() };
const SignalReadShape = z.object({ ...page,
  targets: z.array(SignalTargetSchema).min(1).max(100).optional() }).strict();
const LotReadShape = z.object({ ...page, mode: ModeSchema,
  targets: z.array(LotTargetSchema).min(1).max(100).optional() }).strict();

/** An explicit selection cannot be silently truncated or mixed with continuation. */
function selectionIssues(input: { city: string; cursor?: string | undefined;
  limit?: number | undefined; targets?: readonly { citySlug: string }[] | undefined }, ctx: z.RefinementCtx) {
  if (!input.targets) return;
  if (input.cursor || input.targets.length > (input.limit ?? 100)
    || input.targets.some((target) => target.citySlug !== input.city)
    || new Set(input.targets.map((target) => JSON.stringify(target))).size !== input.targets.length) {
    ctx.addIssue({ code: "custom", message: "Incompatible explicit target selection" });
  }
}
export const GetSignalFacetsInputSchema = SignalReadShape.superRefine(selectionIssues);
export const GetLotFacetsInputSchema = LotReadShape.superRefine(selectionIssues);
export type GetFacetContextInput = z.infer<typeof GetFacetContextInputSchema>;
export type GetSignalFacetsInput = z.infer<typeof GetSignalFacetsInputSchema>;
export type GetLotFacetsInput = z.infer<typeof GetLotFacetsInputSchema>;

/** Opaque cursor validation must bind these server-resolved values, including revocation. */
export const ContinuationContextSchema = z.object({
  accountId: z.string().guid(), workspaceId: WorkspaceIdSchema,
  authorityRevision: z.number().int().nonnegative(), city: CitySchema,
  kind: z.enum(["signal", "lot"]), mode: ModeSchema.nullable(), reveal: z.boolean(),
  limit: z.number().int().min(1).max(100), filterDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export function continuationContextKey(input: z.infer<typeof ContinuationContextSchema>): string {
  const value = ContinuationContextSchema.parse(input);
  return JSON.stringify([value.accountId, value.workspaceId, value.authorityRevision,
    value.city, value.kind, value.mode, value.reveal, value.limit, value.filterDigest]);
}

/** Existing lot DTOs, frozen without importing or wiring the API implementation. */
import { z } from "zod";
import {
  AskingPriceSchema, DisplayedLotVersionSchema, HeadIdSchema, ListingUrlSchema,
  LotTargetSchema, ModeSchema, ReasonSchema, ScopeSchema, WorkspaceIdSchema,
} from "./wire-schemas.js";

/** Parity with scoped-lot-facets-common: basket 256, deselect 8. */
const basket = z.string().min(1).max(256);
const removal = z.object({ basket_id: basket, expected_head_id: HeadIdSchema }).strict();
export const LotMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), basket_id: basket }).strict(),
  z.object({ action: z.literal("deselect"), basket_id: basket }).strict(),
  z.object({ action: z.literal("discard"), reasonCode: ReasonSchema.optional(),
    deselect: z.array(removal).max(8).optional() }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
  z.object({ action: z.literal("set_pipeline"),
    status: z.enum(["sollicite", "lettre_envoyee"]) }).strict(),
  z.object({ action: z.literal("clear_pipeline") }).strict(),
  z.object({ action: z.literal("set_market"), status: z.literal("en_vente"),
    asking_price: AskingPriceSchema, listing_url: ListingUrlSchema }).strict(),
  z.object({ action: z.literal("clear_market") }).strict(),
]);
export const LotCommandItemSchema = z.object({
  target: LotTargetSchema, displayed_version: DisplayedLotVersionSchema,
  expected_head_id: HeadIdSchema, mutation: LotMutationSchema,
}).strict().superRefine((item, ctx) => {
  if (item.mutation.action !== "discard") return;
  const removals = item.mutation.deselect ?? [];
  if (new Set(removals.map((entry) => entry.basket_id)).size !== removals.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate selection removal" });
  }
});
const envelope = { workspaceId: WorkspaceIdSchema, scope: ScopeSchema,
  commandKey: z.string().guid(), mode: ModeSchema };
export const CommandLotFacetInputSchema = z.object({
  ...envelope, body: LotCommandItemSchema,
}).strict().superRefine((input, ctx) => {
  if (input.scope === "personal" && (!personalMutation(input.body.mutation))) {
    ctx.addIssue({ code: "custom", message: "Personal lots only support discard and restore" });
  }
});
export const BatchLotFacetCommandsInputSchema = z.object({
  ...envelope, items: z.array(LotCommandItemSchema).min(1).max(500),
}).strict().superRefine((batch, ctx) => {
  if (batch.scope === "personal" && batch.items.some((item) => !personalMutation(item.mutation))) {
    ctx.addIssue({ code: "custom", message: "Personal lots only support discard and restore" });
  }
  const keys = batch.items.map(({ target }) => JSON.stringify([target.citySlug, target.canonicalId]));
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate batch target" });
  }
});
function personalMutation(mutation: z.infer<typeof LotMutationSchema>): boolean {
  return mutation.action === "restore" || (mutation.action === "discard" && mutation.deselect === undefined);
}
export type LotCommandBody = z.infer<typeof LotCommandItemSchema>;
export type CommandLotFacetInput = z.infer<typeof CommandLotFacetInputSchema>;
export type BatchLotFacetCommandsInput = z.infer<typeof BatchLotFacetCommandsInputSchema>;

/** Idempotency binds current authorization to historical receipt identity. */
export const IDEMPOTENCY_CONTRACT = {
  keyHeader: "Idempotency-Key", receiptIdentity: ["authenticatedAccount", "commandKey"],
  digestFields: ["workspace", "scope", "mode", "contractVersion", "commandFamily",
    "sourceVersion", "expectations", "payload"],
  expectationsBeforeNoop: true, authorizeAndOpenBeforeReplay: true,
  changedPayloadConflicts: true, replayIsCurrentRead: false, batchAtomic: true,
} as const;

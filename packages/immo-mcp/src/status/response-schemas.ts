import { z } from "zod";
import {
  AskingPriceSchema, CitySchema, DisplayedLotVersionSchema, FingerprintSchema,
  ListingUrlSchema, LotTargetSchema, ModeSchema, OperationSchema, RightsSchema,
  SemanticProfileSchema, SignalTargetSchema, WorkspaceIdSchema,
} from "./wire-schemas.js";

const commonEvent = {
  id: z.string().uuid(), facet: z.enum(["selection", "archive", "pipeline", "market"]),
  basket: z.string().nullable(), state: z.enum(["active", "inactive"]),
  reasonCode: z.string().nullable(), verdict: z.string().nullable(), createdAt: z.string().datetime(),
};
export const SignalEventSchema = z.object({ ...commonEvent, target: SignalTargetSchema }).strict();
export const LotEventSchema = z.object({ ...commonEvent, target: LotTargetSchema, mode: ModeSchema,
  pipelineStatus: z.enum(["sollicite", "lettre_envoyee"]).nullable(),
  askingPrice: AskingPriceSchema, listingUrl: ListingUrlSchema,
  displayedVersion: DisplayedLotVersionSchema,
  source: z.object({ importRunId: z.string().uuid(), sourceRowId: z.string().nullable(),
    sourceChainId: z.string().nullable() }).strict().nullable(),
}).strict();
const WorkspaceContextSchema = z.object({
  workspaceId: WorkspaceIdSchema, label: z.string().min(1),
  capabilities: RightsSchema, selectionBasket: z.string().min(1),
  reasonCatalog: z.array(z.object({ code: z.string().min(1), label: z.string().min(1) }).strict()),
  semanticProfile: SemanticProfileSchema, operations: z.array(OperationSchema),
  activation: z.enum(["open", "closed", "unavailable"]),
}).strict();
export const GetFacetContextOutputSchema = z.object({
  workspaces: z.array(z.object({ workspaceId: WorkspaceIdSchema, label: z.string() }).strict()),
  selectedWorkspace: WorkspaceContextSchema.nullable(),
}).strict();

const hidden = { personalHidden: z.boolean(), commonHidden: z.boolean(), effectiveHidden: z.boolean() };
const signalReady = z.object({ readiness: z.literal("ready"), target: SignalTargetSchema,
  displayedContent: z.string(), displayedFingerprint: FingerprintSchema,
  personalHeads: z.array(SignalEventSchema), commonHeads: z.array(SignalEventSchema),
  ...hidden, operations: z.array(OperationSchema),
}).strict();
const lotReady = z.object({ readiness: z.literal("ready"), target: LotTargetSchema,
  displayed_version: DisplayedLotVersionSchema,
  personalHeads: z.array(LotEventSchema), commonHeads: z.array(LotEventSchema),
  ...hidden, operations: z.array(OperationSchema),
}).strict();
const unavailable = z.enum(["missing_state", "source_unavailable", "projection_unavailable"]);
const signalItem = z.union([signalReady,
  z.object({ target: SignalTargetSchema, readiness: unavailable }).strict()]);
const lotItem = z.union([lotReady,
  z.object({ target: LotTargetSchema, readiness: unavailable }).strict()]);
const page = { workspaceId: WorkspaceIdSchema, city: CitySchema,
  nextCursor: z.string().min(1).nullable(), truncated: z.boolean() };
function pageIssues(value: { nextCursor: string | null; truncated: boolean;
  items: readonly { readiness: string; personalHidden?: boolean; commonHidden?: boolean;
    effectiveHidden?: boolean }[] }, ctx: z.RefinementCtx) {
  if (value.truncated !== (value.nextCursor !== null)) {
    ctx.addIssue({ code: "custom", message: "Explicit continuation required" });
  }
  for (const item of value.items) {
    if (item.readiness === "ready" && item.effectiveHidden !== (item.personalHidden || item.commonHidden)) {
      ctx.addIssue({ code: "custom", message: "Effective hiding must include both scopes" });
    }
  }
}
export const GetSignalFacetsOutputSchema = z.object({ ...page,
  items: z.array(signalItem).max(100) }).strict().superRefine(pageIssues);
export const GetLotFacetsOutputSchema = z.object({ ...page, mode: ModeSchema,
  items: z.array(lotItem).max(100) }).strict().superRefine(pageIssues);

/** A receipt is a historical command snapshot; a separate read refreshes current state. */
const receipt = { commandKey: z.string().uuid(), replayed: z.boolean(),
  stateKind: z.literal("command_snapshot") };
export const CommandSignalFacetOutputSchema = z.object({ ...receipt,
  event: SignalEventSchema.nullable() }).strict();
export const CommandLotFacetOutputSchema = z.object({ ...receipt,
  events: z.array(LotEventSchema), heads: z.array(LotEventSchema), appended: z.boolean(),
}).strict();
export const BatchLotFacetCommandsOutputSchema = z.object({ ...receipt,
  targets: z.number().int().min(1).max(500), changed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(), eventsAppended: z.number().int().nonnegative(),
  items: z.array(z.object({ target: LotTargetSchema, mode: ModeSchema,
    events: z.array(LotEventSchema), heads: z.array(LotEventSchema), appended: z.boolean(),
  }).strict()).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if (value.targets !== value.items.length || value.changed + value.unchanged !== value.targets
    || value.items.filter((item) => item.appended).length !== value.changed
    || value.items.reduce((total, item) => total + item.events.length, 0) !== value.eventsAppended
    || new Set(value.items.map(({ target }) => JSON.stringify(target))).size !== value.targets
    || new Set(value.items.map(({ mode }) => mode)).size !== 1) {
    ctx.addIssue({ code: "custom", message: "Atomic batch summary mismatch" });
  }
});

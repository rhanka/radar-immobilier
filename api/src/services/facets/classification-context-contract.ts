import { z } from "zod";
import { Basket, Hash, Verdict, WorkspaceId } from "./classification-query.js";

export const Unavailable = z.discriminatedUnion("state", [
  z.object({ state: z.literal("closed"), reason: z.enum(["not_activated", "maintenance", "not_configured", "transport_closed"]) }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["unresolved_history", "dependency_unavailable", "catalog_unavailable"]) }).strict(),
]);
export const Availability = z.union([z.object({ state: z.literal("open") }).strict(), Unavailable]);
export const ReasonCatalog = z.union([
  z.object({ availability: z.object({ state: z.literal("open") }).strict(), profileId: z.string().min(1), digest: Hash,
    entries: z.array(z.object({ code: z.string().min(1), verdict: Verdict, label: z.string().nullable() }).strict()) }).strict(),
  z.object({ availability: Unavailable, profileId: z.null(), digest: z.null(), entries: z.null() }).strict(),
]);
export type Catalog = z.infer<typeof ReasonCatalog>;
export const WorkspaceFacetContext = z.object({
  contractVersion: z.literal("facet-context-v2"), workspaceId: WorkspaceId,
  semanticProfile: z.object({ lotReason: z.literal("required"), correspondence: z.literal("sent"),
    signalClassification: z.literal("separate_action"), semanticContractVersion: z.literal("base-classification-v1") }).strict(),
  signals: z.object({ availability: Availability,
    baskets: z.array(z.object({ id: Basket, scope: z.literal("personal") }).strict()),
    canSelectPersonally: z.boolean(), canDiscardPersonally: z.boolean(), canModerateArchive: z.boolean(),
    queryProfile: z.literal("signal-query-basic-v1") }).strict(),
  lots: z.object({ availability: Availability, selectionBasket: z.string().nullable(),
    modes: z.array(z.enum(["real", "simulation"])), canSelect: z.boolean(), canChangePipeline: z.boolean(),
    canChangeMarket: z.boolean(), canDiscardPersonally: z.boolean(), canModerateArchive: z.boolean() }).strict(),
  reasonCatalog: ReasonCatalog,
}).strict();
export const FacetContextResponse = z.object({ ok: z.literal(true), context: WorkspaceFacetContext }).strict();

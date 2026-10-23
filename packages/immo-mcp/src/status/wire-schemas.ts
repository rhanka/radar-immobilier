/** Closed, inert S0 wire primitives; never imported by the live registrar. */
import { z } from "zod";

export const WorkspaceIdSchema = z.string().uuid();
export const HeadIdSchema = z.string().uuid().nullable();
export const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const CitySchema = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);
export const ScopeSchema = z.enum(["personal", "common"]);
export const ModeSchema = z.enum(["real", "simulation"]);
export const BasketSchema = z.enum(["pertinent", "a_surveiller"]);
export const ReasonSchema = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
export const SignalTargetSchema = z.object({
  citySlug: CitySchema, type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(512),
}).strict();
export const LotTargetSchema = z.object({
  type: z.literal("Lot"), authority: z.literal("lot_versions"),
  citySlug: CitySchema, canonicalId: z.string().min(1).max(512),
}).strict();
export const DisplayedLotVersionSchema = z.object({
  lot_version_id: z.string().uuid(), fingerprint: FingerprintSchema,
}).strict();
export const SemanticProfileSchema = z.object({
  lotReason: z.enum(["required", "optional", "undecided"]),
  correspondence: z.enum(["to_send", "sent", "undecided"]),
  signalClassification: z.enum(["unique", "separate_action", "undecided"]),
  semanticContractVersion: z.string().min(1),
}).strict();
export const RightsSchema = z.object({
  select: z.boolean(), changePipeline: z.boolean(), changeMarket: z.boolean(),
  discardPersonally: z.boolean(), moderateArchive: z.boolean(),
}).strict();
export const AvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true) }).strict(),
  z.object({ available: z.literal(false), reason: z.enum([
    "pending_lot_reason", "pending_correspondence", "pending_signal_classification",
    "business_closed", "target_unavailable", "capability_required",
  ]) }).strict(),
]);
export const OperationSchema = z.object({
  operation: z.string().min(1), scope: ScopeSchema,
  label: z.enum(["Favori", "Non retenu", "Sollicité", "À lettre", "Lettre envoyée",
    "En vente", "Pertinent", "À surveiller", "Non pertinent", "Écarter", "Restaurer"]),
  availability: AvailabilitySchema,
}).strict();

export const AskingPriceSchema = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((price) => /[1-9]/.test(price), "Price must be positive").nullable();
export const ListingUrlSchema = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password && !/\s/.test(value);
}, "Public HTTP(S) URL required").nullable();

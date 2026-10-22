/**
 * 6J scoped lot routes: shared contract, errors, and auth middleware.
 *
 * This module and its read/command routers stay unmounted in `app.ts`
 * until the protected 6K activation opens the destination.
 */
import type { Context } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import {
  FacetError,
  FacetHeadConflictError,
  FacetTargetVersionConflictError,
} from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import {
  WorkspaceError,
  WorkspaceRevisionConflictError,
} from "../services/workspaces/types.js";
import {
  LotHeadConflictError,
  LotVersionConflictError,
} from "../services/facets/lots/lot-target.js";

export const lotTargetSchema = z.object({
  type: z.literal("Lot"),
  authority: z.literal("lot_versions"),
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  canonicalId: z.string().min(1).max(512),
}).strict();

export const lotDisplayedVersionSchema = z.object({
  lot_version_id: z.string().uuid(),
  fingerprint: z.string().length(64).regex(/^[a-f0-9]{64}$/),
}).strict();

export const lotExpectedHeadId = z.string().uuid().nullable();
export const lotBasketId = z.string().min(1).max(256);
export const lotReasonCode = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
export const lotDeselectEntry = z.object(
  { basket_id: lotBasketId, expected_head_id: lotExpectedHeadId }).strict();
export const lotWorkspaceId = z.string().uuid();
export const lotMode = z.enum(["real", "simulation"]);

export const lotMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), basket_id: lotBasketId }).strict(),
  z.object({ action: z.literal("deselect"), basket_id: lotBasketId }).strict(),
  z.object({
    action: z.literal("discard"), reasonCode: lotReasonCode.optional(),
    deselect: z.array(lotDeselectEntry).max(8).optional(),
  }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
  z.object({ action: z.literal("set_pipeline"),
    status: z.enum(["sollicite", "lettre_envoyee"]) }).strict(),
  z.object({ action: z.literal("clear_pipeline") }).strict(),
  z.object({
    action: z.literal("set_market"), status: z.literal("en_vente"),
    asking_price: z.string().min(1).max(32).nullable(),
    listing_url: z.string().max(2048).nullable(),
  }).strict(),
  z.object({ action: z.literal("clear_market") }).strict(),
]);

export const lotSingleSchema = z.object({
  target: lotTargetSchema,
  displayed_version: lotDisplayedVersionSchema,
  expected_head_id: lotExpectedHeadId,
  mutation: lotMutationSchema,
}).strict();

export const lotBatchSchema = z.object({
  mode: lotMode,
  items: z.array(lotSingleSchema).min(1).max(500),
}).strict();

export const lotSingleBodySchema = lotSingleSchema.extend({ mode: lotMode });

export interface ScopedLotFacetsDeps {
  db: Database;
  auth?: { enabled: boolean };
}

export function toLotError(c: Context, error: unknown): Response {
  if (error instanceof LotHeadConflictError || error instanceof FacetHeadConflictError) {
    return c.json({ error: error.message, current: error.current }, error.status);
  }
  if (error instanceof LotVersionConflictError || error instanceof FacetTargetVersionConflictError) {
    return c.json({ error: error.message, current: error.current }, error.status);
  }
  if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
  if (error instanceof WorkspaceRevisionConflictError) {
    return c.json({ error: error.message, current: error.current }, error.status);
  }
  if (error instanceof WorkspaceError || error instanceof ScopeError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
}

import { z } from "zod";

/**
 * CIBLAGE plan (pipeline stage 1 of 3: ciblage → recueil → exploitation).
 *
 * A CiblagePlan is a PURE DECLARATION of WHAT to collect — which cities, which
 * source bindings (from the real `prioritySources` catalogue), and at which
 * cadence. It carries NO I/O: saving a plan never triggers a collection. A later
 * "recueil" execution lot consumes the plan and stamps its `id` onto every
 * collected `RawDocument` provenance (`ciblagePlanId`), so a raw document can be
 * traced back to the targeting decision that scheduled it.
 *
 * The three cadences mirror the ÉV7 "Automatisation" model:
 *   - `initial`           — first full sweep of a newly-targeted scope.
 *   - `recurrent`         — steady-state refresh on the source's natural rhythm.
 *   - `approfondissement` — a deeper, on-demand pass triggered by a finding.
 */
export const CiblageCadence = z.enum([
  "initial",
  "recurrent",
  "approfondissement",
]);
export type CiblageCadenceT = z.infer<typeof CiblageCadence>;

/** Human labels for the three cadences (UI display / nav). */
export const CIBLAGE_CADENCE_LABELS: Record<CiblageCadenceT, string> = {
  initial: "Initial",
  recurrent: "Récurrent",
  approfondissement: "Approfondissement",
};

/**
 * The full persisted plan. `id`, `createdAt` and `updatedAt` are assigned by the
 * persistence layer; the editable surface is `CiblagePlanInput` below.
 */
export const CiblagePlan = z.object({
  /** Stable plan id (slug derived from the label, store-unique). */
  id: z.string().min(1),
  /** Human label shown in the list + form. */
  label: z.string().trim().min(1).max(200),
  /** City slugs in scope (pilot cities: salaberry-de-valleyfield, beauharnois). */
  citySlugs: z.array(z.string().min(1)).default([]),
  /**
   * Source-binding ids selected from the REAL `prioritySources` catalogue
   * (`PrioritySourceBinding.sourceId`). No fabricated sources — the route
   * validates membership against `ALL_PRIORITY_SOURCE_BINDINGS`.
   */
  sourceBindingIds: z.array(z.string().min(1)).default([]),
  /** Collection rhythm (ÉV7 automation cadences). */
  cadence: CiblageCadence,
  /** Whether a later recueil run is allowed to consume this plan. */
  enabled: z.boolean().default(true),
  /** Free-text operator note. */
  notes: z.string().trim().max(2000).optional(),
  /** ISO creation time (assigned on create). */
  createdAt: z.string().min(4),
  /** ISO last-edit time (assigned on create + each edit). */
  updatedAt: z.string().min(4),
});
export type CiblagePlanT = z.infer<typeof CiblagePlan>;

/**
 * The user-editable surface of a plan (create payload). The store assigns
 * `id`/`createdAt`/`updatedAt`; the client never sets them.
 */
export const CiblagePlanInput = z.object({
  label: z.string().trim().min(1).max(200),
  citySlugs: z.array(z.string().min(1)).default([]),
  sourceBindingIds: z.array(z.string().min(1)).default([]),
  cadence: CiblageCadence,
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional(),
});
export type CiblagePlanInputT = z.infer<typeof CiblagePlanInput>;

/**
 * The patch surface for editing a plan (PATCH). Every field optional; the store
 * merges over the existing plan and re-stamps `updatedAt`. `label` cannot be
 * cleared to empty when present.
 */
export const CiblagePlanPatch = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  citySlugs: z.array(z.string().min(1)).optional(),
  sourceBindingIds: z.array(z.string().min(1)).optional(),
  cadence: CiblageCadence.optional(),
  enabled: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CiblagePlanPatchT = z.infer<typeof CiblagePlanPatch>;

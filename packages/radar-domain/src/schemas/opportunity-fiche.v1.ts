import { z } from "zod";
import { confidenceSchema, isoDateSchema } from "./common.js";

export const OPPORTUNITY_FICHE_SCHEMA_VERSION = "opportunity-fiche.v1" as const;

/** Recommended next action for an opportunity (PROCESS §2 étape 6). */
export const opportunityDecisionSchema = z.enum([
  "reject",
  "watch",
  "qualify_with_expert",
  "approach_owner",
  "acquisition_dossier",
]);

/**
 * Minimal opportunity fiche (PROCESS §4). Stored in
 * `opportunities.fiche` (jsonb). Mirrors the six blocks of the spec:
 * identity, signal, potential, constraints, market, action.
 */
export const opportunityFicheSchemaV1 = z.object({
  schemaVersion: z.literal(OPPORTUNITY_FICHE_SCHEMA_VERSION),
  identity: z.object({
    lotNumbers: z.array(z.string()).default([]),
    address: z.string().optional(),
    municipality: z.string(),
    owner: z.string().optional(),
    areaSqm: z.number().nonnegative().optional(),
    currentUse: z.string().optional(),
  }),
  signal: z.object({
    source: z.string(),
    date: isoDateSchema.optional(),
    excerpt: z.string().max(1000).optional(),
    confidence: confidenceSchema,
  }),
  potential: z.object({
    permittedUses: z.array(z.string()).default([]),
    density: z.string().optional(),
    assembly: z.string().optional(),
    buildableScenario: z.string().optional(),
  }),
  constraints: z.object({
    cptaq: z.boolean().default(false),
    flood: z.boolean().default(false),
    hydrography: z.boolean().default(false),
    servitudes: z.array(z.string()).default([]),
    notes: z.string().optional(),
  }),
  market: z.object({
    comparables: z.string().optional(),
    recentPermits: z.string().optional(),
    municipalValue: z.number().nonnegative().optional(),
    askingOrEstimatedPrice: z.number().nonnegative().optional(),
  }),
  action: z.object({
    decision: opportunityDecisionSchema,
    nextVerification: z.string().optional(),
    expertRequired: z.boolean().default(false),
    deadline: isoDateSchema.optional(),
  }),
});

export type OpportunityDecision = z.infer<typeof opportunityDecisionSchema>;
export type OpportunityFicheV1 = z.infer<typeof opportunityFicheSchemaV1>;

export const parseOpportunityFicheV1 = (input: unknown): OpportunityFicheV1 =>
  opportunityFicheSchemaV1.parse(input);
export const safeParseOpportunityFicheV1 = (input: unknown) =>
  opportunityFicheSchemaV1.safeParse(input);

import { z } from "zod";
import { contractInteger } from "../contracts/validation-number.js";
import {
  vivierEtapeSchema,
  vivierInstrumentSchema,
} from "../vivier/vivier-v2.js";

/**
 * Frozen query contract for lot I-0 (viewdev R2 section 3, as amended by owner).
 *
 * This file freezes the SHAPE only. No route, reader operation, or MCP tool
 * is wired here, so importing it changes no production behaviour. I-2 must
 * reproduce the golden outputs recorded against this shape exactly.
 *
 * Key amendments versus the API convergence R1 shape: `citySlug` is optional
 * (absent = every workspace-visible city) and the response always carries
 * `facets.byCity` counted on the same filter minus `citySlug`.
 */

/** Frozen transport paths (single spelling each; no alternative is routed). */
export const SIGNAL_QUERY_APP_ROUTE_PATH =
  "/api/v1/workspaces/:workspaceId/signal-facets/query" as const;
export const SIGNAL_QUERY_READER_OPERATION = "signals.query.v1" as const;
export const SIGNAL_QUERY_MCP_TOOL = "query_signals" as const;
export const SIGNAL_QUERY_CONTRACT_VERSION = "signal-query-v1" as const;

export const SIGNAL_QUERY_CITY_SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+$/);

const civilDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (day) => {
      const date = new Date(`${day}T00:00:00Z`);
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === day
      );
    },
    { message: "Expected a real civil date YYYY-MM-DD" },
  );

const foldedQuery = z
  .string()
  .min(1)
  .max(128);

export const SignalFilterV1 = z
  .object({
    citySlug: SIGNAL_QUERY_CITY_SLUG.optional(),
    requireZonage: z.boolean().optional(),
    requireResidentielEligible: z.boolean().optional(),
    requirePrecoce: z.boolean().optional(),
    legacyZmp: z
      .object({ z: z.boolean().optional(), m: z.boolean().optional(), p: z.boolean().optional() })
      .strict()
      .optional(),
    excludeAutomaticallyExcluded: z.boolean().optional(),
    instruments: z.array(vivierInstrumentSchema).max(7).optional(),
    stages: z.array(vivierEtapeSchema).max(7).optional(),
    regulatoryStatus: z.array(z.enum(["firm", "anticipation"])).max(2).optional(),
    dateFrom: civilDay.optional(),
    dateTo: civilDay.optional(),
    dateBasis: z.enum(["document", "scrap"]).default("document"),
    zoneCode: z.string().min(1).max(64).optional(),
    zoneMatch: z.enum(["attached", "attached-or-unattached"]).default("attached"),
    basket: z.enum(["all", "none", "pertinent", "a_surveiller"]).default("all"),
    archive: z.enum(["exclude", "include", "only"]).default("exclude"),
    personalHistory: z.enum(["any", "untouched", "has_history"]).default("any"),
    excludePiia: z.boolean().optional(),
    excludeDerogations: z.boolean().optional(),
    q: foldedQuery.optional(),
    sort: z.enum(["vivier_rank", "freshness_desc"]).default("freshness_desc"),
    limit: contractInteger().min(1).max(100).default(50),
    cursor: z.string().min(1).max(4096).optional(),
    include: z.array(z.enum(["facets", "membership"])).default(["facets"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.zoneCode !== undefined && value.citySlug === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["zoneCode"],
        message: "zoneCode requires citySlug",
      });
    }
    if (
      value.dateFrom !== undefined &&
      value.dateTo !== undefined &&
      value.dateFrom > value.dateTo
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "dateFrom must be <= dateTo",
      });
    }
  });

export type SignalFilterV1 = z.infer<typeof SignalFilterV1>;

/** Product default as a named example (never server semantics). */
export const SIGNAL_QUERY_PRODUCT_DEFAULT: SignalFilterV1 = {
  requireZonage: true,
  requireResidentielEligible: true,
  requirePrecoce: true,
  excludeAutomaticallyExcluded: true,
  excludePiia: true,
  excludeDerogations: true,
  dateBasis: "document",
  zoneMatch: "attached",
  basket: "all",
  archive: "exclude",
  personalHistory: "any",
  sort: "vivier_rank",
  limit: 50,
  include: ["facets"],
};

const count = contractInteger().nonnegative();

/** Per-city facet entry: matched count for the same filter minus citySlug. */
export const SignalByCityFacet = z
  .object({ citySlug: SIGNAL_QUERY_CITY_SLUG, matched: count })
  .strict();

export const SignalQueryFacetsV1 = z
  .object({
    basis: z.string().min(1),
    byCity: z.array(SignalByCityFacet).max(1000),
    byStage: z.record(z.string(), count).optional(),
    byInstrument: z.record(z.string(), count).optional(),
    byRegulatoryStatus: z.record(z.string(), count).optional(),
  })
  .strict();

export const SignalQueryItemV1 = z
  .object({
    citySlug: SIGNAL_QUERY_CITY_SLUG,
    target: z
      .object({
        citySlug: SIGNAL_QUERY_CITY_SLUG,
        type: z.enum(["Signal", "DesignationEvent"]),
        id: z.string().min(1).max(512),
      })
      .strict(),
    zoneCodes: z.array(z.string().min(1).max(64)).max(64),
    lotNos: z.array(z.string().min(1).max(64)).max(256),
  })
  .strict()
  .and(z.record(z.string(), z.unknown()));

export const SignalQueryMembershipV1 = z
  .object({
    orderedIds: z.array(z.string().min(1)).max(10000),
    zoneCodes: z.array(z.string().min(1).max(64)).max(1000),
    lotNos: z.array(z.string().min(1).max(64)).max(5000),
  })
  .strict();

export const SignalQueryResponseV1 = z
  .object({
    contractVersion: z.literal(SIGNAL_QUERY_CONTRACT_VERSION),
    snapshot: z.object({ kind: z.string().min(1) }).strict().and(z.record(z.string(), z.unknown())),
    counts: z.object({ matched: count }).strict().and(z.record(z.string(), z.unknown())),
    facets: SignalQueryFacetsV1,
    items: z.array(SignalQueryItemV1).max(100),
    membership: SignalQueryMembershipV1.optional(),
    page: z
      .object({
        limit: contractInteger().min(1).max(100),
        nextCursor: z.string().max(4096).nullable(),
        truncated: z.boolean(),
      })
      .strict()
      .refine((value) => value.truncated === (value.nextCursor !== null)),
  })
  .strict();

export type SignalQueryResponseV1 = z.infer<typeof SignalQueryResponseV1>;

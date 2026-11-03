import { z } from "zod";
import { contractInteger } from "../contracts/validation-number.js";
import { contractDateTime } from "../contracts/validation-datetime.js";
import {
  vivierEtapeSchema,
  vivierExclusionReasonSchema,
  vivierInstrumentSchema,
  vivierV2Schema,
} from "../vivier/vivier-v2.js";
import { vivierExcludedByReasonSchema } from "../vivier/counts.js";

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

/**
 * Coherence snapshot: the I-2 service stamps the population token and the
 * digest of the normalized filter so a cursor replayed after any filter
 * change (including adding/removing `citySlug`) is refused, never mixed.
 */
export const SignalQuerySnapshotV1 = z
  .object({
    kind: z.literal("signal-query-v1"),
    baseToken: z.string().min(1).max(256),
    queryDigest: z.string().min(1).max(256),
  })
  .strict();

/**
 * Declared-basis counts. Same invariant skeleton as `SignalCounts`
 * (`eligible = visible + discarded`, navigation identities, `matched` within
 * the navigation population) but the navigation basis is the single-pass
 * query service — not the basket search pipeline — so the basis literal is
 * new and frozen here.
 */
export const SignalQueryCountsV1 = z
  .object({
    unit: z.literal("distinct_targets"),
    eligible: count,
    visible: count,
    discarded: count,
    discardedByScope: z
      .object({ personalOnly: count, workspaceOnly: count, both: count })
      .strict(),
    navigation: z
      .object({
        basis: z.literal("single_pass_signal_query_v1"),
        population: count,
        pertinent: count,
        a_surveiller: count,
        selectedDistinct: count,
        selectionMemberships: count,
        unselected: count,
      })
      .strict(),
    matched: count,
  })
  .strict()
  .superRefine((value, context) => {
    const navigation = value.navigation;
    const discarded = value.discardedByScope;
    if (
      value.eligible !== value.visible + value.discarded ||
      value.discarded !==
        discarded.personalOnly + discarded.workspaceOnly + discarded.both ||
      navigation.selectionMemberships !==
        navigation.pertinent + navigation.a_surveiller ||
      navigation.population !==
        navigation.selectedDistinct + navigation.unselected ||
      navigation.selectedDistinct > navigation.selectionMemberships ||
      navigation.selectedDistinct > navigation.population ||
      navigation.selectedDistinct <
        Math.max(navigation.pertinent, navigation.a_surveiller) ||
      value.matched > navigation.population
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid distinct counts",
      });
    }
  });

/** Per-city facet entry: matched count for the same filter minus citySlug. */
export const SignalByCityFacet = z
  .object({ citySlug: SIGNAL_QUERY_CITY_SLUG, matched: count })
  .strict();

/**
 * Facets with declared bases. `byCity` is always present (same filter minus
 * `citySlug`); `byStage`/`byInstrument`/`byRegulatoryStatus` use closed
 * enum keys so no unknown dimension can slip through; `vivier` carries the
 * server classification block (`qualified`, `residentialUnknown`,
 * `excludedByReason`).
 */
export const SignalQueryFacetsV1 = z
  .object({
    basis: z.string().min(1),
    byCity: z.array(SignalByCityFacet).max(1000),
    byStage: z.record(vivierEtapeSchema, count),
    byInstrument: z.record(vivierInstrumentSchema, count),
    byRegulatoryStatus: z.record(z.enum(["firm", "anticipation"]), count),
    vivier: z
      .object({
        qualified: count,
        residentialUnknown: count,
        excludedByReason: vivierExcludedByReasonSchema,
      })
      .strict(),
  })
  .strict();

/** Strict document reference carried on a query card (civil dates only). */
export const SignalQueryDocRefV1 = z
  .object({
    docSha: z.string().min(1),
    title: z.string().max(1024).nullable(),
    publishedAt: civilDay.nullable(),
    fetchedAt: contractDateTime({ offset: true }).nullable(),
    excerpt: z.string().max(2000).nullable(),
  })
  .strict();

/**
 * Strict query card: the displayable signal, frozen field by field. Never
 * raw `props` — the server resolves attachments to `zoneCodes`/`lotNos` on
 * the item instead.
 */
export const SignalQueryCardV1 = z
  .object({
    label: z.string().max(1024),
    description: z.string().max(8000).nullable(),
    stage: vivierEtapeSchema,
    sourceStage: z.string().max(256).nullable(),
    regulatoryStatus: z.enum(["firm", "anticipation"]),
    freshness: z
      .object({
        day: civilDay.nullable(),
        basis: z.enum(["document", "scrap"]),
      })
      .strict(),
    automaticExclusionReason: vivierExclusionReasonSchema.nullable(),
    docRefs: z.array(SignalQueryDocRefV1).max(64),
    missingEvidence: z.array(
      z.enum([
        "description",
        "citation",
        "pdfLink",
        "documentDate",
        "page",
        "bbox",
      ]),
    ),
    truncatedFields: z.array(
      z.enum([
        "label",
        "description",
        "sourceStage",
        "docRefs",
        "docRefs.title",
        "docRefs.excerpt",
      ]),
    ),
  })
  .strict();

/** Strict per-item basket facets (server-projected, never inferred client-side). */
export const SignalQueryItemFacetsV1 = z
  .object({
    selection: z
      .object({
        pertinent: z.string().guid().nullable(),
        a_surveiller: z.string().guid().nullable(),
      })
      .strict(),
    archive: z
      .object({
        personal: z.boolean(),
        workspace: z.boolean(),
      })
      .strict(),
    personalHistoryState: z.enum(["untouched", "has_history"]),
    personalHidden: z.boolean(),
    workspaceHidden: z.boolean(),
    effectiveHidden: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.personalHidden !== value.archive.personal ||
      value.workspaceHidden !== value.archive.workspace ||
      value.effectiveHidden !==
        (value.personalHidden || value.workspaceHidden)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid signal facet projection",
      });
    }
  });

/**
 * Strict query item: city, native target, frozen card, server
 * classification, per-item facets, and server-resolved attachments.
 */
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
    card: SignalQueryCardV1,
    classification: vivierV2Schema,
    facets: SignalQueryItemFacetsV1,
    zoneCodes: z.array(z.string().min(1).max(64)).max(64),
    lotNos: z.array(z.string().min(1).max(64)).max(256),
  })
  .strict();

/**
 * Optional bounded membership block (owner decision D-C): ordered ids plus
 * zone/lot unions. Over-ceiling is a typed error, never silent truncation.
 * Ceilings are set from the I-0 volume measurements (see
 * `docs/spec/SPEC_SIGNAL_QUERY_V1.md` §6).
 */
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
    snapshot: SignalQuerySnapshotV1,
    counts: SignalQueryCountsV1,
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

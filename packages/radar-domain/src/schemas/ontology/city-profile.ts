import { z } from "zod";
import { RegulatoryStageKind } from "./relations.js";

/**
 * Multi-city variability (SPEC_ONTOLOGY §5). The ontology PROFILE and the
 * relational SCHEMA are stable across N cities; what varies lives in
 * `CityProfile` + a typed `SourceBinding[]` (§5.3) and in the per-city graphify
 * project. No hard-coded "Valleyfield" logic anywhere (§0.2).
 */

// ─────────────────────────────────────────────────────────────────────────────
// ZoningRegime — code scheme + density unit + grid format (§5.2).
// ─────────────────────────────────────────────────────────────────────────────
export const DensityUnit = z.enum(["log-ha", "logements", "cos", "ui-ha", "non-disponible"]);
export type DensityUnitT = z.infer<typeof DensityUnit>;
export const GridFormat = z.enum(["pdf-table", "html", "gis-vector", "non-disponible"]);
export type GridFormatT = z.infer<typeof GridFormat>;
export const ZoningRegime = z.object({
  codeScheme: z.object({
    /** Overrides the default QC zone regex (§2.2) for this city. */
    regex: z.string().min(1),
    /** Maps a code prefix to a coarse kind, e.g. { "H":"H", "Ha":"H", "Cv":"C" }. */
    prefixToKind: z.record(z.string()),
  }),
  densityUnit: DensityUnit,
  gridFormat: GridFormat,
});
export type ZoningRegimeT = z.infer<typeof ZoningRegime>;

// ─────────────────────────────────────────────────────────────────────────────
// DecisionProcess — referendum register, PPCMOI, CPTAQ variants, adoption stages.
// ─────────────────────────────────────────────────────────────────────────────
export const CptaqVariant = z.enum(["individuelle", "appui-municipal", "portee-collective"]);
export type CptaqVariantT = z.infer<typeof CptaqVariant>;
export const DecisionProcess = z.object({
  hasReferendumRegister: z.boolean(),
  ppcmoiEnabled: z.boolean(),
  cptaqVariants: z.array(CptaqVariant).default([]),
  adoptionStages: z.array(RegulatoryStageKind).default([]),
});
export type DecisionProcessT = z.infer<typeof DecisionProcess>;

// ─────────────────────────────────────────────────────────────────────────────
// SourceBinding[] — typed, one per channel; multiple channels per `kind` allowed
// (§5.3). Replaces the v1 monolithic `channels` object.
// ─────────────────────────────────────────────────────────────────────────────
export const SourceCapability = z.enum([
  "list",
  "fetch",
  "search",
  "pagination",
  "auth-required",
  "ocr-needed",
  "asr-needed",
]);
export type SourceCapabilityT = z.infer<typeof SourceCapability>;
export const SourceBindingKind = z.enum([
  "avis-public",
  "reglement",
  "ppcmoi",
  "proces-verbal",
  "grille-zonage",
  "plan-urbanisme",
  "role-evaluation",
  "cadastre",
  "adresses-qc",
  "cptaq",
  "bdzi",
  "grhq",
  "presse",
  "video",
]);
export type SourceBindingKindT = z.infer<typeof SourceBindingKind>;
export const SourceEngine = z.enum([
  "craft",
  "pg-solutions",
  "wordpress",
  "voila",
  "azimut",
  "gonet",
  "youtube",
  "rest",
  "file",
  "autre",
]);
export type SourceEngineT = z.infer<typeof SourceEngine>;
export const SourceBinding = z.object({
  /** Stable binding identifier. */
  sourceId: z.string().min(1),
  kind: SourceBindingKind,
  channel: z.object({
    engine: SourceEngine,
    url: z.string().url().nullable().default(null),
    selectors: z.record(z.unknown()).default({}),
  }),
  auth: z.enum(["none", "basic", "api-key", "session"]).default("none"),
  cadence: z.enum(["daily", "weekly", "monthly", "on-demand"]).default("weekly"),
  /** WP4 adapter id (per engine). */
  adapter: z.string().min(1),
  capabilities: z.array(SourceCapability).default([]),
  tier: z.enum(["A", "B", "C"]).default("B"),
  priority: z.number().int().default(0),
});
export type SourceBindingT = z.infer<typeof SourceBinding>;

// ─────────────────────────────────────────────────────────────────────────────
// CityProfile — one entry per city; adding a city = a CityProfile + SourceBinding[]
// + a graphify project (§5.4). The profile and schema do not change.
// ─────────────────────────────────────────────────────────────────────────────
export const CityProfile = z.object({
  slug: z.string().min(1),
  nomOfficiel: z.string().min(1),
  codeMamh: z.string().min(1), // "70052"
  dguidStatcan: z.string().nullable().default(null),
  mrcSlug: z.string().min(1), // Region is a node only in V2
  bbox: z.object({
    minLon: z.number(),
    minLat: z.number(),
    maxLon: z.number(),
    maxLat: z.number(),
  }),
  zoningRegime: ZoningRegime,
  decisionProcess: DecisionProcess,
  aliasOverrides: z.record(z.unknown()).default({}),
  sources: z.array(SourceBinding).default([]),
});
export type CityProfileT = z.infer<typeof CityProfile>;

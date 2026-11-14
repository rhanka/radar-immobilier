import { z } from "zod";
import { displayedVivierFiltreCount, facetedVivierFiltreCounts, mergeVivierFiltreCubes,
  type VivierFiltreCubesByClassement } from "../vivier/filtre-cube.js";

export const SIGNAL_METADATA_CLASSES = ["pertinent", "a_surveiller", "non_classe", "ecarte"] as const;
export type MetadataClass = typeof SIGNAL_METADATA_CLASSES[number];
const flag = z.enum(["0", "1"]).default("0").transform((v) => v === "1");
const civil = z.iso.date();
/** Explicit empty classes and inclusive civil dates; URL preferences stay outside this wire contract. */
export const signalMetadataFilterSchema = z.object({
  scope: z.literal("quebec").default("quebec"),
  dateFrom: civil.optional(), dateTo: civil.optional(),
  dateBasis: z.enum(["document", "scrap"]).default("document"),
  classes: z.string().default("pertinent,a_surveiller,non_classe")
    .refine((v) => v === "none" || v.split(",").every((c) => SIGNAL_METADATA_CLASSES.includes(c as MetadataClass)))
    .transform((v) => SIGNAL_METADATA_CLASSES.filter((c) => v.split(",").includes(c))),
  requireZonage: flag, requireResidentielEligible: flag, requirePrecoce: flag,
  excludePiia: flag, excludeDerogations: flag,
}).refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, "Reversed date window");
export type SignalMetadataFilter = z.infer<typeof signalMetadataFilterSchema>;

/** Shared exact reduction over SQL-grouped cells, never over cards. */
export function signalMetadataCounts(cubes: VivierFiltreCubesByClassement, filter: SignalMetadataFilter) {
  const axes = { z: filter.requireZonage, r: filter.requireResidentielEligible, p: filter.requirePrecoce };
  const exclusions = { piiaSansProjetResidentiel: filter.excludePiia, derogationsMineures: filter.excludeDerogations };
  const selected = mergeVivierFiltreCubes(filter.classes.map((c) => cubes[c]));
  return {
    matched: displayedVivierFiltreCount(selected, axes, exclusions),
    classCounts: Object.fromEntries(SIGNAL_METADATA_CLASSES.map((c) =>
      [c, displayedVivierFiltreCount(cubes[c], axes, exclusions)])) as Record<MetadataClass, number>,
    facetCounts: facetedVivierFiltreCounts(selected, axes, exclusions),
  };
}

export interface SignalMetadataCity extends ReturnType<typeof signalMetadataCounts> {
  citySlug: string;
  /** Date-scoped cells retain every class for local filter changes. At most 128 per city. */
  facetsByClass: VivierFiltreCubesByClassement;
}
export interface SignalMetadataResponse {
  contract: "metadata-v2";
  snapshot: string;
  totalMatched: number;
  classCounts: Record<MetadataClass, number>;
  facetCounts: ReturnType<typeof facetedVivierFiltreCounts>;
  cities: SignalMetadataCity[];
}

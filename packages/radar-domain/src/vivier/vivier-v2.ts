import { z } from "zod";

export const vivierClassificationSchema = z.enum(["oui", "non", "indetermine"]);
export type VivierClassification = z.infer<typeof vivierClassificationSchema>;

export const vivierEffetDensifiantSchema = z.enum([
  "densifie",
  "reduit",
  "stable",
  "inconnu",
]);
export type VivierEffetDensifiant = z.infer<typeof vivierEffetDensifiantSchema>;

export const vivierInstrumentSchema = z.enum([
  "rezonage",
  "ppcmoi",
  "piia",
  "derogation",
  "refonte",
  "plan_urbanisme",
  "autre",
]);
export type VivierInstrument = z.infer<typeof vivierInstrumentSchema>;

export const vivierEtapeSchema = z.enum([
  "avis_motion",
  "projet_reglement",
  "consultation_publique",
  "second_projet",
  "adoption",
  "entree_vigueur",
  "inconnu",
]);
export type VivierEtape = z.infer<typeof vivierEtapeSchema>;

export const vivierExclusionReasonSchema = z.enum([
  "non_residentiel_franc",
  "piia_non_pertinent",
  "hors_zonage",
  "derogation_hors_sujet",
]);
export type VivierExclusionReason = z.infer<typeof vivierExclusionReasonSchema>;

export const vivierConfidenceSchema = z.number().min(0).max(1);

export const vivierSignalSchema = z.object({
  valeur: vivierClassificationSchema,
  source: z.string().min(1),
  confiance: vivierConfidenceSchema,
});
export type VivierSignalClassification = z.infer<typeof vivierSignalSchema>;

export const vivierProvenanceSchema = z.object({
  extrait: z.string(),
  source: z.string().min(1).optional(),
});
export type VivierProvenance = z.infer<typeof vivierProvenanceSchema>;

export const vivierV2Schema = z.object({
  zonage: vivierSignalSchema,
  residentiel: vivierSignalSchema,
  effet_densifiant: vivierEffetDensifiantSchema.default("inconnu"),
  instrument: vivierInstrumentSchema,
  etape: vivierEtapeSchema,
  etapes_historique: z.array(vivierEtapeSchema).default([]),
  exclusion_reason: vivierExclusionReasonSchema.nullable().default(null),
  provenance: vivierProvenanceSchema.default({ extrait: "" }),
  confiance: vivierConfidenceSchema,
});
export type VivierV2 = z.infer<typeof vivierV2Schema>;
export type VivierV2Classification = VivierV2;

// Uppercase aliases keep the contract discoverable for callers using the
// domain's existing schema naming convention.
export const VivierV2Schema = vivierV2Schema;
export const VivierV2ClassificationSchema = vivierV2Schema;
export const VivierSignalSchema = vivierSignalSchema;
export const VivierEtapeSchema = vivierEtapeSchema;
export const VivierInstrumentSchema = vivierInstrumentSchema;
export const VivierExclusionReasonSchema = vivierExclusionReasonSchema;
export const VivierEffetDensifiantSchema = vivierEffetDensifiantSchema;

export interface VivierSortable {
  id: string;
  classification: VivierV2;
  fraicheur?: string | Date | null;
  freshness?: string | Date | null;
}

export type VivierComparable = VivierSortable | VivierV2;

export type VivierRankTuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
];

const bucketOrder = (classification: VivierV2): number => {
  if (classification.exclusion_reason !== null) return 2;
  if (
    classification.zonage.valeur === "oui" &&
    classification.residentiel.valeur === "oui"
  ) {
    return 0;
  }
  return 1;
};

const effectOrder: Record<VivierEffetDensifiant, number> = {
  densifie: 0,
  stable: 1,
  reduit: 2,
  inconnu: 3,
};

const stageOrder: Record<VivierEtape, number> = {
  avis_motion: 0,
  projet_reglement: 1,
  consultation_publique: 2,
  second_projet: 3,
  adoption: 4,
  entree_vigueur: 5,
  inconnu: 99,
};

const instrumentOrder: Record<VivierInstrument, number> = {
  rezonage: 0,
  ppcmoi: 1,
  piia: 2,
  derogation: 3,
  refonte: 4,
  plan_urbanisme: 5,
  autre: 6,
};

function evidenceRank(classification: VivierV2): number {
  const hasExcerpt = classification.provenance.extrait.trim().length > 0;
  const hasSource = classification.provenance.source !== undefined;
  if (hasExcerpt && hasSource) return 0;
  if (hasExcerpt) return 1;
  if (hasSource) return 2;
  return 3;
}

function freshnessRank(value: string | Date | null | undefined): number {
  if (value === null || value === undefined) return Number.MAX_SAFE_INTEGER;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? -timestamp : Number.MAX_SAFE_INTEGER;
}

function tuple(item: VivierSortable): VivierRankTuple {
  const { classification } = item;
  const knownEffect = classification.effet_densifiant !== "inconnu";
  return [
    bucketOrder(classification),
    knownEffect ? 0 : 1,
    knownEffect ? effectOrder[classification.effet_densifiant] : effectOrder.inconnu,
    knownEffect ? Math.round((1 - classification.confiance) * 1000) : 0,
    evidenceRank(classification),
    stageOrder[classification.etape],
    instrumentOrder[classification.instrument],
    freshnessRank(item.fraicheur ?? item.freshness),
    item.id,
  ];
}

function compareTuple(a: VivierRankTuple, b: VivierRankTuple): number {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index]!;
    if (left === right) continue;
    if (typeof left === "string" && typeof right === "string") return left < right ? -1 : 1;
    return (left as number) < (right as number) ? -1 : 1;
  }
  return 0;
}

function asSortable(value: VivierComparable): VivierSortable {
  if ("classification" in value) return value;
  return { id: "", classification: value };
}

export function compareVivier(a: VivierComparable, b: VivierComparable): number {
  const left = tuple(asSortable(a));
  const right = tuple(asSortable(b));
  return compareTuple(left, right);
}

export function rankReason(value: VivierComparable): string {
  const item = asSortable(value);
  const classification = item.classification;
  const bucket = bucketOrder(classification);
  const effect = classification.effet_densifiant;
  const effectConfidence = effect === "inconnu" ? "unknown" : classification.confiance.toFixed(3);
  return [
    `bucket=${bucket}`,
    `effect=${effect}`,
    `effectConfidence=${effectConfidence}`,
    `evidence=${evidenceRank(classification)}`,
    `stage=${classification.etape}`,
    `instrument=${classification.instrument}`,
    `freshness=${item.fraicheur ?? item.freshness ?? "unknown"}`,
    `stableKey=${item.id}`,
  ].join(";");
}

export function rankVivier<T extends VivierSortable>(items: readonly T[]): T[] {
  return [...items].sort(compareVivier);
}

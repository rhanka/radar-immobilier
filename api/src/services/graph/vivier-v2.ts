import {
  ZONAGE_CATEGORIES,
  classifyResidentielPertinence,
  deriveEtape,
  isMulti4Plus,
  isPrecoceSignal,
  isZonageSignal,
} from "./graph-store.js";
import {
  countVivierClassifications,
  vivierV2Schema,
  type VivierCounts,
  type VivierEtape,
  type VivierExclusionReason,
  type VivierInstrument,
  type VivierV2,
} from "@radar/domain";

export interface VivierSignalInput {
  id: string;
  type: string;
  category?: string | null;
  label?: string | null;
  description?: string | null;
  etape?: string | null;
  nbUnitesMax?: string | null;
  intensite?: string | null;
  props?: unknown;
  sourceRef?: string | null;
  fraicheur?: string | Date | null;
}

export interface VivierSignalClassification {
  signalId: string;
  classification: VivierV2;
  fraicheur: string | Date | null;
}

export interface VivierV2Computation {
  classifications: VivierSignalClassification[];
  counts: VivierCounts;
}

export type LegacySubsetKey =
  | ""
  | "z"
  | "m"
  | "p"
  | "z|m"
  | "z|p"
  | "m|p"
  | "z|m|p";

const LEGACY_SUBSET_KEYS: readonly LegacySubsetKey[] = [
  "",
  "z",
  "m",
  "p",
  "z|m",
  "z|p",
  "m|p",
  "z|m|p",
];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function firstString(records: readonly Record<string, unknown>[], keys: readonly string[]): string | null {
  for (const candidate of records) {
    for (const key of keys) {
      const value = stringValue(candidate[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function firstNumber(records: readonly Record<string, unknown>[], keys: readonly string[]): number | null {
  for (const candidate of records) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return null;
}

function fold(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function token(value: string | null | undefined): string | null {
  if (!value || value.trim() === "") return null;
  return fold(value.trim()).replace(/[ -]+/g, "_");
}

function graphRecords(signal: VivierSignalInput): Record<string, unknown>[] {
  const props = record(signal.props);
  const nested = record(props.properties);
  const refs = [props.refs, nested.refs]
    .filter(Array.isArray)
    .flatMap((value) => value!.map(record));
  return [...refs, nested, props];
}

function classificationFromResidentiel(
  category: string | null,
  label: string | null,
  description: string | null,
) {
  const pertinence = classifyResidentielPertinence(category, label, description);
  if (pertinence === "residentiel") {
    return { valeur: "oui" as const, source: "classifyResidentielPertinence", confiance: 0.9 };
  }
  if (pertinence === "non_residentiel") {
    return { valeur: "non" as const, source: "classifyResidentielPertinence", confiance: 0.9 };
  }
  return { valeur: "indetermine" as const, source: "classifyResidentielPertinence", confiance: 0 };
}

function classificationFromZonage(
  type: string,
  category: string | null,
  etapeAnnote: string | null,
) {
  const zonage = isZonageSignal(type, category, etapeAnnote);
  if (zonage) {
    const source = type === "DesignationEvent"
      ? "isZonageSignal:type"
      : category !== null && ZONAGE_CATEGORIES.includes(category)
        ? "isZonageSignal:category"
        : "isZonageSignal:etape";
    return { valeur: "oui" as const, source, confiance: 0.95 };
  }
  if (category === null && etapeAnnote === null) {
    return { valeur: "indetermine" as const, source: "isZonageSignal:missing", confiance: 0 };
  }
  return { valeur: "non" as const, source: "isZonageSignal:no_match", confiance: 0.8 };
}

const etapeFromRaw: Record<string, VivierEtape> = {
  avis_motion: "avis_motion",
  projet_reglement: "projet_reglement",
  consultation: "consultation_publique",
  consultation_publique: "consultation_publique",
  second_projet: "second_projet",
  adoption: "adoption",
  entree_vigueur: "entree_vigueur",
};

function toVivierEtape(value: string | null | undefined): VivierEtape | null {
  const normalized = token(value);
  return normalized === null ? null : etapeFromRaw[normalized] ?? null;
}

function derivedEtapes(
  label: string | null,
  description: string | null,
  etapeAnnote: string | null,
  history: readonly string[],
): VivierEtape[] {
  const values = new Set<VivierEtape>();
  const add = (value: VivierEtape | null) => {
    if (value !== null) values.add(value);
  };
  add(toVivierEtape(etapeAnnote));
  history.forEach((value) => add(toVivierEtape(value)));
  const derived = deriveEtape(label, description);
  add(toVivierEtape(derived));
  return [
    "avis_motion",
    "projet_reglement",
    "consultation_publique",
    "second_projet",
    "adoption",
    "entree_vigueur",
  ].filter((value): value is VivierEtape => values.has(value as VivierEtape));
}

function instrumentFromSignal(
  category: string | null,
  label: string | null,
  description: string | null,
  explicit: string | null,
): VivierInstrument {
  const candidate = token(explicit) ?? token(category);
  const text = fold(`${label ?? ""} ${description ?? ""}`);
  if (["rezonage", "modification_zonage", "changement_usage"].includes(candidate ?? "")) return "rezonage";
  if (candidate === "ppcmoi" || text.includes("ppcmoi") || text.includes("projet particulier")) return "ppcmoi";
  if (candidate === "piia" || text.includes("piia")) return "piia";
  if (candidate === "derogation" || candidate === "derogation_mineure" || text.includes("derogation")) return "derogation";
  if (candidate === "refonte" || text.includes("refonte")) return "refonte";
  if (candidate === "plan_urbanisme" || text.includes("plan d urbanisme")) return "plan_urbanisme";
  return "autre";
}

function effectFromSignal(records: readonly Record<string, unknown>[]) {
  const effect = firstString(records, ["effet_densifiant", "effetDensifiant"]);
  return effect === "densifie" || effect === "reduit" || effect === "stable" || effect === "inconnu"
    ? effect
    : "inconnu";
}

function exclusionFor(
  zonage: VivierV2["zonage"],
  residentiel: VivierV2["residentiel"],
  instrument: VivierInstrument,
): VivierExclusionReason | null {
  if (instrument === "piia" && residentiel.valeur === "non") return "piia_non_pertinent";
  if (instrument === "derogation" && residentiel.valeur === "non") return "derogation_hors_sujet";
  if (residentiel.valeur === "non") return "non_residentiel_franc";
  if (zonage.valeur === "non") return "hors_zonage";
  return null;
}

export function classifyVivierSignal(signal: VivierSignalInput): VivierV2 {
  const records = graphRecords(signal);
  const category = signal.category ?? firstString(records, ["category"]);
  const label = signal.label ?? firstString(records, ["label"]);
  const description = signal.description ?? firstString(records, ["description", "summary", "details"]);
  const etapeAnnote = signal.etape ?? firstString(records, ["etape"]);
  const history = records.flatMap((candidate) => {
    const values = candidate.etapes_historique ?? candidate.etapesHistorique;
    return Array.isArray(values)
      ? values.filter((value): value is string => typeof value === "string")
      : [];
  });
  const zonage = classificationFromZonage(signal.type, category, etapeAnnote);
  const residentiel = classificationFromResidentiel(category ?? etapeAnnote, label, description);
  const instrument = instrumentFromSignal(
    category,
    label,
    description,
    firstString(records, ["instrument"]),
  );
  const etapes = derivedEtapes(label, description, etapeAnnote, history);
  const provenance = {
    extrait: firstString(records, ["extrait", "excerpt", "citation", "quote", "text"]) ?? "",
    ...(signal.sourceRef ?? firstString(records, ["sourceRef", "source_ref", "rawRef", "raw_ref"])
      ? { source: signal.sourceRef ?? firstString(records, ["sourceRef", "source_ref", "rawRef", "raw_ref"])! }
      : {}),
  };
  const confidence = firstNumber(records, ["confiance", "confidence", "confidence_score"])
    ?? Math.min(zonage.confiance, residentiel.confiance);
  const classification = vivierV2Schema.parse({
    zonage,
    residentiel,
    effet_densifiant: effectFromSignal(records),
    instrument,
    etape: etapes.at(-1) ?? "inconnu",
    etapes_historique: etapes,
    exclusion_reason: exclusionFor(zonage, residentiel, instrument),
    provenance,
    confiance: Math.max(0, Math.min(1, confidence)),
  });
  return classification;
}

export function computeVivierV2(
  signals: readonly VivierSignalInput[],
): VivierV2Computation {
  const classifications = signals.map((signal) => ({
    signalId: signal.id,
    classification: classifyVivierSignal(signal),
    fraicheur: signal.fraicheur ?? null,
  }));
  return {
    classifications,
    counts: countVivierClassifications(classifications.map((entry) => entry.classification)),
  };
}

function emptyLegacyCounts(): Record<LegacySubsetKey, number> {
  return Object.fromEntries(LEGACY_SUBSET_KEYS.map((key) => [key, 0])) as Record<LegacySubsetKey, number>;
}

export function computeLegacySubsetCounts(
  signals: readonly VivierSignalInput[],
): Record<LegacySubsetKey, number> {
  const counts = emptyLegacyCounts();
  for (const signal of signals) {
    const category = signal.category ?? firstString(graphRecords(signal), ["category"]);
    const etape = signal.etape ?? firstString(graphRecords(signal), ["etape"]);
    const label = signal.label ?? firstString(graphRecords(signal), ["label"]) ?? "";
    const description = signal.description ?? firstString(graphRecords(signal), ["description"]) ?? null;
    const nbUnitesMax = signal.nbUnitesMax ?? firstString(graphRecords(signal), ["nb_unites_max"]);
    const intensite = signal.intensite ?? firstString(graphRecords(signal), ["intensite"]);
    const z = isZonageSignal(signal.type, category, etape);
    const m = isMulti4Plus(signal.type, nbUnitesMax, intensite);
    const p = isPrecoceSignal(etape, label, description);
    const flags: Record<"z" | "m" | "p", boolean> = { z, m, p };
    for (const key of LEGACY_SUBSET_KEYS) {
      if (key === "") {
        counts[key] += 1;
        continue;
      }
      const matches = key.split("|").every((flag) => flags[flag as "z" | "m" | "p"]);
      if (matches) counts[key] += 1;
    }
  }
  return counts;
}

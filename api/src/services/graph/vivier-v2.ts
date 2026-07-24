import {
  RESIDENTIEL_CATEGORIES,
  ZONAGE_CATEGORIES,
  classifyResidentielPertinence,
  deriveEtape,
  isMulti4Plus,
  isPrecoceSignal,
  isZonageSignal,
} from "./graph-store.js";
import {
  classifyBPrime,
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

export const LEGACY_ZMP_VERSION = "legacy-zmp-v1" as const;

export interface LegacyZmpMembership {
  version: typeof LEGACY_ZMP_VERSION;
  signalId: string;
  flags: Readonly<{ z: boolean; m: boolean; p: boolean }>;
}

export interface LegacyZmpProjection {
  version: typeof LEGACY_ZMP_VERSION;
  a: { count: number; signalIds: string[] };
}

export interface LegacyGraphNodeInput {
  id: string;
  type: string;
  label?: string | null;
  props?: unknown;
  sourceRef?: string | null;
}

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

const NON_ZONAGE_CATEGORIES = new Set([
  "acquisition_fonciere",
  "infrastructure",
  "vente_terrain",
  "vente_institutionnelle",
]);

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

/** Match PostgreSQL JSONB `->>` for the scalar fields used by legacy Z/M/P. */
function legacyJsonbText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
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

/** Reproduce the 8fe75cd legacy SQL projection: only props.properties fields. */
export function extractLegacyZmpInput(node: LegacyGraphNodeInput): VivierSignalInput {
  const properties = record(record(node.props).properties);
  return {
    id: node.id,
    type: node.type,
    category: legacyJsonbText(properties.category),
    label: node.label ?? null,
    description: legacyJsonbText(properties.description),
    etape: legacyJsonbText(properties.etape),
    nbUnitesMax: legacyJsonbText(properties.nb_unites_max),
    intensite: legacyJsonbText(properties.intensite),
    sourceRef: node.sourceRef ?? null,
  };
}

/**
 * Marqueurs résidentiels FORTS (label + description, normalisés). « residentiel »
 * et « densification » NUS en sont volontairement absents : ce sont des marqueurs
 * FAIBLES qui apparaissent dans « densification commerciale » (Rosemère) et « zone
 * résidentielle requalifiée en commerciale » (Saint-Charles-Borromée). Seul un
 * marqueur FORT garde un signal franchement commercial dans B (usage réellement
 * mixte avec du logement).
 */
const STRONG_RESIDENTIEL_MARKERS_RE =
  /\b(?:habitations?|logements?|multi[- ]?logements?|multifamilial(?:e)?s?|bifamilial(?:e)?s?|trifamilial(?:e)?s?|unifamilial(?:e)?s?|plurifamilial(?:e)?s?|duplex|triplex|quadruplex|plex|condominiums?|maison de chambres|immeuble (?:residentiel|locatif|a logements))\b/;

/** Marqueurs commerciaux/industriels francs (R3). */
const FRANC_COMMERCIAL_MARKERS_RE =
  /\b(?:commercial(?:e)?s?|centre commercial|industriel(?:le)?s?|parc industriel|zone industrielle)\b/;

/** Pôle commercial régional — raison d'exclusion nommée (R4). */
const REGIONAL_COMMERCIAL_POLE_RE = /\bpole commercial regional\b/;

/**
 * Catégories intrinsèquement résidentielles FORTES (densification exclue : faible).
 * Construit paresseusement : `graph-store` et `vivier-v2` sont en dépendance
 * circulaire, `RESIDENTIEL_CATEGORIES` n'est pas encore initialisé à l'évaluation
 * du module (seulement au premier appel de classification).
 */
let strongResidentielCategories: Set<string> | null = null;
function isStrongResidentielCategory(category: string): boolean {
  if (strongResidentielCategories === null) {
    strongResidentielCategories = new Set(
      RESIDENTIEL_CATEGORIES.filter((value) => value !== "densification"),
    );
  }
  return strongResidentielCategories.has(category);
}

/**
 * Pertinence résidentielle du chemin B′ SERVEUR, lue par la vue B (counts.ts →
 * `qualified` → `projectComposedVivierB`). Étend `classifyResidentielPertinence`
 * (inchangée, encore lue par l'axe r de A) avec les règles de recette B′ :
 *
 *  - R4 : un « pôle commercial régional » est disqualifié par raison nommée —
 *         rang, jamais porte — même s'il porte un marqueur résidentiel.
 *  - R3 : une densification / affectation COMMERCIALE ou INDUSTRIELLE franche SANS
 *         marqueur résidentiel FORT est non-résidentielle (sort Rosemère,
 *         Saint-Charles-Borromée).
 *  - R2 : une REFONTE complète est REPÊCHÉE (`oui`) au lieu de rester
 *         `indéterminée` (les 3× refontes 10/10). « Refonte détectée = rang,
 *         jamais porte » (SPEC_EVOL_FILTRAGE_VIVIER_v2).
 *
 * Ordre = R4 > R3 > pertinence explicite > R2 : une refonte franchement
 * commerciale reste exclue (R3 prime sur R2, cf. Rosemère).
 */
function classificationFromResidentiel(
  category: string | null,
  label: string | null,
  description: string | null,
  completeReform: boolean,
) {
  const text = fold(`${label ?? ""} ${description ?? ""}`);
  const hasStrongResidentiel =
    STRONG_RESIDENTIEL_MARKERS_RE.test(text) ||
    (category !== null && isStrongResidentielCategory(category));

  if (REGIONAL_COMMERCIAL_POLE_RE.test(text)) {
    return { valeur: "non" as const, source: "classifyBPrime:R4_pole_commercial_regional", confiance: 0.9 };
  }
  if (FRANC_COMMERCIAL_MARKERS_RE.test(text) && !hasStrongResidentiel) {
    return { valeur: "non" as const, source: "classifyBPrime:R3_commercial_franc", confiance: 0.9 };
  }

  const pertinence = classifyResidentielPertinence(category, label, description);
  if (pertinence === "residentiel") {
    return { valeur: "oui" as const, source: "classifyResidentielPertinence", confiance: 0.9 };
  }
  if (pertinence === "non_residentiel") {
    return { valeur: "non" as const, source: "classifyResidentielPertinence", confiance: 0.9 };
  }
  if (completeReform) {
    return { valeur: "oui" as const, source: "classifyBPrime:R2_refonte_complete", confiance: 0.85 };
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
  if (category !== null && NON_ZONAGE_CATEGORIES.has(category)) {
    return {
      valeur: "non" as const,
      source: "isZonageSignal:category_non_zonage",
      confiance: 0.95,
    };
  }
  if (etapeAnnote !== null && NON_ZONAGE_CATEGORIES.has(etapeAnnote)) {
    return {
      valeur: "non" as const,
      source: "isZonageSignal:etape_non_zonage",
      confiance: 0.95,
    };
  }
  return { valeur: "indetermine" as const, source: "isZonageSignal:no_positive_evidence", confiance: 0 };
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

/**
 * B′ adds a stricter residential exclusion without creating a second B
 * projection. Existing Vivier-v2 exclusions remain authoritative because they
 * retain their more specific reason; B′ only supplies the otherwise-missing
 * exclusion for a record that Vivier-v2 still considers eligible.
 */
function applyBPrimeExclusion(
  classification: VivierV2,
  signal: VivierSignalInput,
): VivierV2 {
  if (classification.exclusion_reason !== null) return classification;

  const bPrime = classifyBPrime({
    category: signal.category ?? null,
    label: signal.label ?? null,
    description: signal.description ?? null,
    etapeAnnotation: signal.etape ?? null,
    props: record(signal.props),
    sourceRef: signal.sourceRef ?? null,
  });
  if (bPrime.exclusionReason === null) return classification;

  return vivierV2Schema.parse({
    ...classification,
    residentiel: {
      valeur: "non",
      source: "classifyBPrime",
      confiance: 0.9,
    },
    // B's established wire contract has no B′-specific reason. Keep B′'s
    // detailed reason on the graph card and map its exclusion to B's existing
    // non-residential bucket, consumed by the projection and bulk counters.
    exclusion_reason: "non_residentiel_franc",
    confiance: Math.max(classification.confiance, 0.9),
  });
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
  const instrument = instrumentFromSignal(
    category,
    label,
    description,
    firstString(records, ["instrument"]),
  );
  // R2 — « refonte complète » détectée (instrument OU texte). Parité avec la
  // détection de classifyBPrime (une refonte portée par `category=rezonage` ne
  // remonte pas en instrument=refonte, d'où le repli texte).
  const foldedText = fold(`${label ?? ""} ${description ?? ""}`);
  const completeReform =
    instrument === "refonte" ||
    /\brefonte\b/.test(foldedText) ||
    /\brevision complete\b/.test(foldedText);
  const residentiel = classificationFromResidentiel(category ?? etapeAnnote, label, description, completeReform);
  const etapes = derivedEtapes(label, description, etapeAnnote, history);
  // R1 — l'étape ANNOTÉE fait autorité sur l'inférence texte : une annotation
  // valide (`projet_reglement`…) n'est jamais poussée plus tard par un mot-clé du
  // libellé (« Adoption des premiers projets… » → dérive Sutton vers `adoption`).
  const annotatedEtape = toVivierEtape(etapeAnnote);
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
    etape: annotatedEtape ?? etapes.at(-1) ?? "inconnu",
    etapes_historique: etapes,
    exclusion_reason: exclusionFor(zonage, residentiel, instrument),
    provenance,
    confiance: Math.max(0, Math.min(1, confidence)),
  });
  return applyBPrimeExclusion(classification, signal);
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

/** The immutable legacy A/T predicates, classified once for counts and IDs. */
export function classifyLegacyZmpSignal(signal: VivierSignalInput): LegacyZmpMembership {
  const category = signal.category ?? null;
  const etape = signal.etape ?? null;
  const label = signal.label ?? "";
  const description = signal.description ?? null;
  const nbUnitesMax = signal.nbUnitesMax ?? null;
  const intensite = signal.intensite ?? null;
  return {
    version: LEGACY_ZMP_VERSION,
    signalId: signal.id,
    flags: {
      z: isZonageSignal(signal.type, category, etape),
      m: isMulti4Plus(signal.type, nbUnitesMax, intensite),
      p: isPrecoceSignal(etape, label, description),
    },
  };
}

/**
 * Projection A (z∩m∩p) — la seule projection legacy encore servie.
 *
 * La projection `transition` (z∩p) a été retirée avec le mode « Transition
 * vers B » de l'UI : c'était la régression de prod corrigée par #375, et
 * B (vivier v2) la remplace. Aucun consommateur ne la lit plus.
 */
export function buildLegacyZmpProjection(
  memberships: readonly LegacyZmpMembership[],
): LegacyZmpProjection {
  const aIds = memberships
    .filter(({ flags }) => flags.z && flags.m && flags.p)
    .map(({ signalId }) => signalId);
  return {
    version: LEGACY_ZMP_VERSION,
    a: { count: aIds.length, signalIds: aIds },
  };
}

export function computeLegacySubsetCounts(
  signals: readonly VivierSignalInput[],
): Record<LegacySubsetKey, number> {
  const counts = emptyLegacyCounts();
  for (const signal of signals) {
    const flags = classifyLegacyZmpSignal(signal).flags;
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
